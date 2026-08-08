import { type FridayError, ok, type Result } from '@friday/contracts'
import { asc, eq, gt } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { computeIntegrityHash, computePayloadDigest, GENESIS_HASH } from '../event-hash.js'
import { chainSegments, type EventRow, events } from '../schema/events.js'
import { toHashable } from './event-mapping.js'

/**
 * Verifying the integrity chain.
 *
 * This is what `friday verify` runs, and it is how the milestone is proved:
 * the chain is recomputed from the bytes on disk, not from anything held in
 * memory, so a passing verification is a statement about the file.
 *
 * Reference: docs/01-bible/09-database-design.md
 */

export interface ChainVerification {
  /**
   * ★ The overall verdict: is this log trustworthy?
   *
   * True only when BOTH guarantees below hold. It stays the field a caller
   * reads when it wants one answer — a nightly check that parsed the split
   * fields and happened to look at the wrong one would report a tampered log
   * as fine, which is the one mistake this shape must not make possible.
   */
  readonly intact: boolean

  /**
   * ★ Guarantee one: the sequence is intact.
   *
   * Nothing was inserted, removed, or reordered. This holds even for events
   * whose content was deliberately removed, which is the property ADR-0028
   * exists to provide.
   */
  readonly sequenceIntact: boolean

  /**
   * ★ Guarantee two: every payload still present is the payload recorded.
   *
   * A compacted event is excluded by design — it says so about itself — and
   * counted separately below.
   */
  readonly contentIntact: boolean

  readonly eventsChecked: number
  readonly fromSeq: number
  readonly toSeq: number

  /**
   * The first sequence number that failed **either** check.
   *
   * The overall answer, for the same reason `intact` is: this is where a
   * restore has to start from, and a caller that read a more specific field
   * and got null on a damaged log would restore from the wrong place.
   */
  readonly brokenAtSeq: number | null

  /** Where the sequence broke specifically, if it did. */
  readonly sequenceBrokenAtSeq: number | null

  /** Where content stopped matching what was recorded, if it did. */
  readonly contentBrokenAtSeq: number | null

  /** How many events had their content deliberately removed. Not a fault. */
  readonly contentRemoved: number

  /** Ranges that left this database, and are therefore expected to be absent. */
  readonly archivedSegments: number

  /** Plain language, for someone who does not read code. */
  readonly reason: string | null
}

/**
 * Walks the chain, recomputing each hash from the stored bytes.
 *
 * Two things are checked, and the second is easy to forget: that every hash
 * matches, and that the sequence is gapless. A deleted row WOULD be caught by
 * the hash of the row after it — but the reported reason would be "hash
 * mismatch at 413" rather than "event 412 is missing", and those two send you
 * to very different places at two in the morning.
 *
 * @param input - The database, and where to start. Starting mid-chain reads
 *   the preceding event's hash first, so a partial check is still a real one.
 * @returns The verification result. A broken chain is a finding, not an
 *   error — the command succeeded; it is the log that has a problem.
 */
export function verifyChain(input: {
  db: BetterSQLite3Database
  fromSeq: number
}): Result<ChainVerification, FridayError> {
  const { db, fromSeq } = input

  const priorRow =
    fromSeq <= 1
      ? undefined
      : db
          .select({ integrityHash: events.integrityHash })
          .from(events)
          .where(eq(events.seq, fromSeq - 1))
          .get()

  const segments = db.select().from(chainSegments).orderBy(asc(chainSegments.fromSeq)).all()

  const rows = db
    .select()
    .from(events)
    .where(gt(events.seq, fromSeq - 1))
    .orderBy(asc(events.seq))
    .all()

  const walked = walk({
    rows,
    fromSeq,
    startingHash: priorRow?.integrityHash ?? GENESIS_HASH,
    sealedFrom: new Map(segments.map((segment) => [segment.fromSeq, segment])),
  })

  const archivedSegments = segments.length

  if (walked.break !== undefined) {
    return ok(
      broken(fromSeq, walked.toSeq, walked.checked, walked.break.atSeq, walked.break.reason, {
        contentRemoved: walked.contentRemoved,
        archivedSegments,
      }),
    )
  }

  const { contentBrokenAtSeq } = walked

  return ok({
    intact: contentBrokenAtSeq === null,
    sequenceIntact: true,
    contentIntact: contentBrokenAtSeq === null,
    eventsChecked: walked.checked,
    fromSeq,
    toSeq: walked.toSeq,
    brokenAtSeq: contentBrokenAtSeq,
    sequenceBrokenAtSeq: null,
    contentBrokenAtSeq,
    contentRemoved: walked.contentRemoved,
    archivedSegments,
    reason:
      contentBrokenAtSeq === null
        ? null
        : `event ${contentBrokenAtSeq} does not match the content that was recorded`,
  })
}

/** What one pass over the rows found. */
interface Walked {
  readonly break: { atSeq: number; reason: string } | undefined
  readonly checked: number
  readonly toSeq: number
  readonly contentRemoved: number
  readonly contentBrokenAtSeq: number | null
}

/**
 * Walks the rows once, checking both guarantees.
 *
 * Stops at the first sequence break, because everything after it is
 * meaningless — the chain is a chain. A content failure does NOT stop the
 * walk: the sequence after it is still provable, and saying so is more useful
 * than refusing to look.
 */
function walk(input: {
  rows: readonly EventRow[]
  fromSeq: number
  startingHash: string
  sealedFrom: ReadonlyMap<number, { toSeq: number; finalHash: string }>
}): Walked {
  let previousHash = input.startingHash
  let expectedSeq = input.fromSeq
  let checked = 0
  let toSeq = input.fromSeq - 1
  let contentRemoved = 0
  let contentBrokenAtSeq: number | null = null

  const found = (atSeq: number, reason: string): Walked => ({
    break: { atSeq, reason },
    checked,
    toSeq,
    contentRemoved,
    contentBrokenAtSeq,
  })

  for (const row of input.rows) {
    if (row.seq !== expectedSeq) {
      const skipped = skipSealed({
        sealedFrom: input.sealedFrom,
        expectedSeq,
        nextSeq: row.seq,
      })

      if (skipped === undefined) return found(expectedSeq, `event ${expectedSeq} is missing`)

      previousHash = skipped.finalHash
      expectedSeq = skipped.resumeAt
    }

    if (computeIntegrityHash({ event: toHashable(row), previousHash }) !== row.integrityHash) {
      return found(row.seq, `event ${row.seq} does not match its own hash`)
    }

    // Guarantee two, checked independently. A compacted event is exempt and
    // says so about itself; anything else whose bytes no longer match the
    // digest recorded when they were written is corruption.
    if (row.compactedAt !== null) contentRemoved += 1
    else if (contentBrokenAtSeq === null && !contentMatches(row)) contentBrokenAtSeq = row.seq

    previousHash = row.integrityHash
    expectedSeq += 1
    toSeq = row.seq
    checked += 1
  }

  return { break: undefined, checked, toSeq, contentRemoved, contentBrokenAtSeq }
}

/** Whether a row's stored bytes still hash to the digest recorded for them. */
function contentMatches(row: { payload: string; payloadDigest: string }): boolean {
  return computePayloadDigest(row.payload) === row.payloadDigest
}

/**
 * Accounts for a gap with a sealed segment, if one covers it.
 *
 * @returns Where to resume and what hash to continue from, or undefined when
 *   the gap is not accounted for — which is a broken chain.
 */
function skipSealed(input: {
  sealedFrom: ReadonlyMap<number, { toSeq: number; finalHash: string }>
  expectedSeq: number
  nextSeq: number
}): { finalHash: string; resumeAt: number } | undefined {
  const segment = input.sealedFrom.get(input.expectedSeq)
  if (segment === undefined) return undefined
  if (segment.toSeq >= input.nextSeq) return undefined
  if (segment.toSeq + 1 !== input.nextSeq) return undefined

  return { finalHash: segment.finalHash, resumeAt: segment.toSeq + 1 }
}

function broken(
  fromSeq: number,
  toSeq: number,
  checked: number,
  brokenAtSeq: number,
  reason: string,
  counts: { contentRemoved: number; archivedSegments: number },
): ChainVerification {
  return {
    intact: false,
    sequenceIntact: false,
    contentIntact: true,
    eventsChecked: checked,
    fromSeq,
    toSeq,
    brokenAtSeq,
    sequenceBrokenAtSeq: brokenAtSeq,
    contentBrokenAtSeq: null,
    contentRemoved: counts.contentRemoved,
    archivedSegments: counts.archivedSegments,
    reason,
  }
}
