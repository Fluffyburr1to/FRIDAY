import {
  type Actor,
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  ok,
  type Result,
  type Sensitivity,
} from '@friday/contracts'
import { decryptField } from '../crypto/field-encryption.js'
import type { KeyProvider } from '../crypto/key-provider.js'
import type { HashableEvent } from '../event-hash.js'
import type { EventRow } from '../schema/events.js'

/**
 * Translating between the flat table row and the nested event shape.
 *
 * The row is flat because SQLite columns are, and the event is nested because
 * `actor.type` reads better than `actorType` everywhere else in the system.
 * Keeping the translation in one file means there is one place to look when
 * they disagree — and they will, the first time a column is added.
 */

/** The row's own columns, which include exactly what the hash covers. */
export function toHashable(row: EventRow): HashableEvent {
  return { ...row }
}

/** The marker a compacted payload is replaced with. */
export const TOMBSTONE = { compacted: true } as const

/**
 * Builds the nested event, with an empty payload.
 *
 * The payload is filled in by the caller, because whether it needs decrypting
 * depends on where the event came from — a freshly appended one already has
 * its plaintext to hand, and a read one does not.
 */
export function toEvent(hashable: HashableEvent, integrityHash: string): FridayEvent {
  return {
    seq: hashable.seq,
    id: hashable.id,
    type: hashable.type,
    occurredAt: hashable.occurredAt,
    recordedAt: hashable.recordedAt,
    actor: { type: hashable.actorType as Actor['type'], id: hashable.actorId },
    principalId: hashable.principalId,
    ...(hashable.subjectType !== null && hashable.subjectId !== null
      ? { subject: { type: hashable.subjectType, id: hashable.subjectId } }
      : {}),
    ...(hashable.causationId !== null ? { causationId: hashable.causationId } : {}),
    ...(hashable.correlationId !== null ? { correlationId: hashable.correlationId } : {}),
    ...(hashable.traceId !== null ? { traceId: hashable.traceId } : {}),
    payload: {},
    payloadVersion: hashable.payloadVersion,
    sensitivity: hashable.sensitivity as Sensitivity,
    integrityHash,
  }
}

/**
 * Decodes rows into events, decrypting `private` payloads on the way.
 *
 * Fails the whole read rather than returning partial results. A read that
 * quietly omits the events it could not decrypt would make the audit trail
 * look complete while having a hole in it, which is the one thing it must
 * never do.
 *
 * @param input - The rows, the key provider, and the field key reference.
 * @returns The decoded events, or the first decoding failure.
 */
export function decodeRows(input: {
  rows: readonly EventRow[]
  keys: KeyProvider
  fieldKeyReference: string
}): Result<FridayEvent[], FridayError> {
  const decoded: FridayEvent[] = []

  for (const row of input.rows) {
    const payload = decodePayload({
      row,
      keys: input.keys,
      fieldKeyReference: input.fieldKeyReference,
    })
    if (!payload.ok) return payload

    decoded.push({ ...toEvent(toHashable(row), row.integrityHash), payload: payload.value })
  }

  return ok(decoded)
}

function decodePayload(input: {
  row: EventRow
  keys: KeyProvider
  fieldKeyReference: string
}): Result<Record<string, unknown>, FridayError> {
  const { row, keys, fieldKeyReference } = input

  const plaintext =
    row.sensitivity === 'private'
      ? decryptField({ stored: row.payload, keyReference: fieldKeyReference, keys })
      : ok(row.payload)

  if (!plaintext.ok) return plaintext

  try {
    return ok(JSON.parse(plaintext.value) as Record<string, unknown>)
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_UNAVAILABLE',
        message: `The payload of event ${row.seq} could not be read.`,
        detail: { seq: row.seq, type: row.type },
        cause,
      }),
    )
  }
}
