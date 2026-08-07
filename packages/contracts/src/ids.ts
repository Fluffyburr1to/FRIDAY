import { randomBytes } from 'node:crypto'
import { z } from 'zod'

/**
 * Identifiers.
 *
 * Two decisions are recorded here because both will look arbitrary later.
 *
 * **UUIDv7 rather than v4.** A v7 identifier embeds its creation time in the
 * high bits, so ordering by ID approximates ordering by time. That keeps the
 * primary-key index on `events.id` from fragmenting the way random keys do,
 * and it makes an ID legible — you can tell roughly when an event happened
 * from the identifier alone, which matters when reading a log by eye.
 *
 * **The IDs are plain strings, not branded types.** Zod can brand them, and
 * branding would catch passing a plan ID where an approval ID belongs. It is
 * deliberately not used: most of FRIDAY's code is written by AI assistants
 * starting cold, brands force a cast at every database-row boundary, and casts
 * that are written reflexively are worse than the bug class they prevent.
 * Review trigger: if an ID-confusion bug ever reaches `main`, revisit this.
 *
 * Reference: docs/01-bible/09-database-design.md
 */

/** Any FRIDAY identifier: a UUIDv7 rendered in the canonical 8-4-4-4-12 form. */
export const UuidSchema = z.uuid()

export const EventIdSchema = UuidSchema
export const CorrelationIdSchema = UuidSchema
export const CausationIdSchema = UuidSchema
export const PlanIdSchema = UuidSchema
export const PlanStepIdSchema = UuidSchema

/**
 * Whose data a row concerns.
 *
 * Present on every event and every user-data row from the first migration.
 * Today there is exactly one value in this column. When a second person is
 * added, the isolation mechanism has already been exercised by every query
 * ever written — which is the entire point of paying for the column now.
 */
export const PrincipalIdSchema = z.string().min(1).max(128)

export type EventId = z.infer<typeof EventIdSchema>
export type CorrelationId = z.infer<typeof CorrelationIdSchema>
export type CausationId = z.infer<typeof CausationIdSchema>
export type PlanId = z.infer<typeof PlanIdSchema>
export type PlanStepId = z.infer<typeof PlanStepIdSchema>
export type PrincipalId = z.infer<typeof PrincipalIdSchema>

const UUID_VERSION_7 = 0x70
const UUID_VARIANT_RFC = 0x80
const TIMESTAMP_BYTES = 6
const MAX_TIMESTAMP_MS = 2 ** 48 - 1

/**
 * Generates a UUIDv7.
 *
 * Layout, per RFC 9562 §5.7: 48 bits of Unix milliseconds, 4 bits of version,
 * 12 bits of randomness, 2 bits of variant, 62 bits of randomness.
 *
 * Two IDs generated within the same millisecond are ordered arbitrarily
 * relative to each other. That is acceptable because the event log's gapless
 * `seq` column — not the ID — is the ordering authority for anything that
 * depends on order. The timestamp in the ID is for legibility and index
 * locality, and treating it as authoritative is a mistake worth naming here.
 *
 * @param now - Milliseconds since the Unix epoch. Injectable for tests only;
 *   production callers omit it.
 * @returns A canonical lowercase UUIDv7 string.
 * @throws If `now` is outside the 48-bit range the format can represent — a
 *   programmer error, not an operational failure.
 */
export function uuidv7(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIMESTAMP_MS) {
    throw new RangeError(`uuidv7: timestamp ${now} is outside the representable 48-bit range`)
  }

  const bytes = randomBytes(16)

  // Big-endian 48-bit timestamp in bytes 0–5.
  for (let i = TIMESTAMP_BYTES - 1; i >= 0; i -= 1) {
    bytes[i] = now % 256
    now = Math.floor(now / 256)
  }

  // Byte 6's high nibble is the version; byte 8's high bits are the variant.
  //
  // Read and written through Buffer's accessors rather than by index, because
  // `noUncheckedIndexedAccess` types `bytes[6]` as possibly undefined and the
  // usual answers to that — a non-null assertion, or a `?? 0` fallback — are
  // respectively banned and a branch no test can ever reach.
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | UUID_VERSION_7, 6)
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | UUID_VARIANT_RFC, 8)

  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * Reads the creation time back out of a UUIDv7.
 *
 * Useful when reading a log by eye or reconstructing a timeline from IDs
 * alone. Not a substitute for an event's `occurredAt`, which is the recorded
 * fact; this is derived from how the ID happened to be minted.
 *
 * @param id - A UUIDv7 string.
 * @returns Milliseconds since the Unix epoch, or `undefined` if `id` is not a
 *   well-formed version 7 UUID.
 */
export function timestampFromUuidv7(id: string): number | undefined {
  if (!UuidSchema.safeParse(id).success) return undefined

  const hex = id.replaceAll('-', '')
  if (hex[12] !== '7') return undefined

  return Number.parseInt(hex.slice(0, 12), 16)
}
