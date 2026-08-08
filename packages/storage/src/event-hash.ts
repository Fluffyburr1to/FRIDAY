import { createHash } from 'node:crypto'

/**
 * The integrity chain.
 *
 * Each event's hash covers the previous event's hash, so altering or deleting
 * a historical event breaks every hash after it. This is not protection
 * against an attacker with write access — they could recompute the chain from
 * the tampered point forward. It reliably detects corruption, accidental
 * modification, and buggy code writing where it should not, and for an audit
 * trail the Constitution depends on, "we would know if it changed" is a
 * meaningful property.
 *
 * ── The rule that makes this work ───────────────────────────────────────────
 *
 * **The hash covers a digest of the bytes that were stored, computed once,
 * when they were written.** It is never re-derived from a parsed object.
 * Anything else — re-serialising, re-encoding a number — means the chain can
 * break because a JSON serialiser changed its key order in a minor release,
 * which is a failure nobody would ever diagnose.
 *
 * That is also why the canonical form is a positional array rather than an
 * object: an array has no key order to depend on.
 *
 * ── Why a digest rather than the bytes (ADR-0028) ───────────────────────────
 *
 * Hashing the payload bytes directly made two things Chapter 10 requires
 * impossible: compaction, which rewrites payloads, and redaction, which
 * removes them. Under this form the chain proves the *sequence* is intact
 * while a separate check proves each *payload* still matches what was
 * recorded — so deliberately removing content fails the second on purpose and
 * passes the first, which is the difference between "this was redacted" and
 * "this log is corrupt".
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 10
 */

/** What the first event's hash is chained to. */
export const GENESIS_HASH = '0'.repeat(64)

/** Exactly the fields that are hashed, in exactly this order. */
export interface HashableEvent {
  readonly seq: number
  readonly id: string
  readonly type: string
  readonly occurredAt: number
  readonly recordedAt: number
  readonly actorType: string
  readonly actorId: string
  readonly principalId: string
  readonly subjectType: string | null
  readonly subjectId: string | null
  readonly causationId: string | null
  readonly correlationId: string | null
  readonly traceId: string | null

  /**
   * SHA-256 of the payload bytes as they were written.
   *
   * Computed inside the append transaction and never recomputed from a parsed
   * object. This is what the chain covers; the bytes themselves are checked
   * against it separately.
   */
  readonly payloadDigest: string
  readonly payloadVersion: number
  readonly sensitivity: string
}

/**
 * Renders an event's canonical form.
 *
 * Positional, and every field included. Adding a field to the event table
 * without adding it here would leave that field outside the chain — it could
 * then be changed without detection, which is the one failure mode this whole
 * mechanism exists to prevent.
 *
 * @param event - The event, with its payload as stored.
 * @returns A deterministic string.
 */
export function canonicalise(event: HashableEvent): string {
  return JSON.stringify([
    event.seq,
    event.id,
    event.type,
    event.occurredAt,
    event.recordedAt,
    event.actorType,
    event.actorId,
    event.principalId,
    event.subjectType,
    event.subjectId,
    event.causationId,
    event.correlationId,
    event.traceId,
    event.payloadDigest,
    event.payloadVersion,
    event.sensitivity,
  ])
}

/**
 * Computes an event's integrity hash.
 *
 * @param input - The event and the hash of the one before it.
 * @returns Lowercase SHA-256 hex.
 */
export function computeIntegrityHash(input: {
  event: HashableEvent
  previousHash: string
}): string {
  return createHash('sha256')
    .update(input.previousHash)
    .update('\n')
    .update(canonicalise(input.event))
    .digest('hex')
}

/**
 * Digests the payload bytes.
 *
 * @param payload - The serialised payload, exactly as stored.
 * @returns Lowercase SHA-256 hex.
 */
export function computePayloadDigest(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Serialises a payload deterministically.
 *
 * Keys are sorted at every level, so two structurally equal payloads always
 * produce the same bytes regardless of the order the object was built in. The
 * result is what gets stored AND what gets hashed — they are the same string,
 * which is the property the chain depends on.
 *
 * @param payload - The validated payload object.
 * @returns A stable JSON string.
 */
export function serialisePayload(payload: unknown): string {
  return JSON.stringify(sortKeys(payload))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)

  if (typeof value !== 'object' || value === null) return value

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key])
  }
  return sorted
}
