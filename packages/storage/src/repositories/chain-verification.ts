import { type FridayError, ok, type Result } from '@friday/contracts'
import { asc, eq, gt } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { computeIntegrityHash, GENESIS_HASH } from '../event-hash.js'
import { events } from '../schema/events.js'
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
  readonly intact: boolean
  readonly eventsChecked: number
  readonly fromSeq: number
  readonly toSeq: number

  /** The first sequence number where the chain broke, if it did. */
  readonly brokenAtSeq: number | null

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

  let previousHash = priorRow?.integrityHash ?? GENESIS_HASH
  let expectedSeq = fromSeq
  let checked = 0
  let toSeq = fromSeq - 1

  const rows = db
    .select()
    .from(events)
    .where(gt(events.seq, fromSeq - 1))
    .orderBy(asc(events.seq))
    .all()

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return ok(broken(fromSeq, toSeq, checked, expectedSeq, `event ${expectedSeq} is missing`))
    }

    if (computeIntegrityHash({ event: toHashable(row), previousHash }) !== row.integrityHash) {
      return ok(
        broken(fromSeq, toSeq, checked, row.seq, `event ${row.seq} does not match its own hash`),
      )
    }

    previousHash = row.integrityHash
    expectedSeq += 1
    toSeq = row.seq
    checked += 1
  }

  return ok({
    intact: true,
    eventsChecked: checked,
    fromSeq,
    toSeq,
    brokenAtSeq: null,
    reason: null,
  })
}

function broken(
  fromSeq: number,
  toSeq: number,
  checked: number,
  brokenAtSeq: number,
  reason: string,
): ChainVerification {
  return { intact: false, eventsChecked: checked, fromSeq, toSeq, brokenAtSeq, reason }
}
