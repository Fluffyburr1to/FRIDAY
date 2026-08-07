import {
  type Actor,
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  ok,
  type PrincipalId,
  type Result,
  type Sensitivity,
  type Subject,
  uuidv7,
} from '@friday/contracts'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { encryptField } from '../crypto/field-encryption.js'
import type { KeyProvider } from '../crypto/key-provider.js'
import {
  computeIntegrityHash,
  GENESIS_HASH,
  type HashableEvent,
  serialisePayload,
} from '../event-hash.js'
import { events } from '../schema/events.js'
import { type ChainVerification, verifyChain } from './chain-verification.js'
import { decodeRows, toEvent } from './event-mapping.js'

/**
 * The event log.
 *
 * Simultaneously FRIDAY's message bus and her audit trail. They are the same
 * thing, which is why the audit trail cannot fall out of sync with reality:
 * writing the event *is* how the action happens.
 *
 * Reference: docs/01-bible/10-event-bus.md · Chapter 09
 */

/** What a caller hands to `append`. Position and hash are assigned here. */
export interface AppendableEvent {
  type: string
  occurredAt?: number | undefined
  actor: Actor
  principalId: PrincipalId
  subject?: Subject | undefined
  causationId?: string | undefined
  correlationId?: string | undefined
  traceId?: string | undefined
  payload: Record<string, unknown>
  payloadVersion?: number | undefined
  sensitivity: Sensitivity
}

export interface EventStoreOptions {
  db: BetterSQLite3Database
  keys: KeyProvider

  /** The Keychain reference for the key that encrypts `private` payloads. */
  fieldKeyReference: string
}

export interface EventStore {
  /**
   * Records an event.
   *
   * @param input - The event, and optionally the sync lane to run inside the
   *   same transaction.
   * @returns The recorded event, with its assigned sequence number and hash.
   */
  append(input: {
    event: AppendableEvent

    /**
     * The sync lane. Runs INSIDE the append transaction, after the row is
     * written and before it is committed.
     *
     * If it throws, the transaction rolls back and the event is not recorded
     * at all. That is deliberate: it is what guarantees the audit trail and
     * the system state can never disagree. A projection that could not be
     * updated means the event did not happen.
     */
    onRecorded?: (event: FridayEvent) => void
  }): Result<FridayEvent, FridayError>

  /** Events after `afterSeq`, oldest first. The tail and replay both use this. */
  readAfter(input: {
    afterSeq: number
    limit?: number | undefined
    principalId?: PrincipalId | undefined
  }): Result<FridayEvent[], FridayError>

  /**
   * Every event belonging to one root request, oldest first.
   *
   * This is what the audit trail is walked with. `correlationId` groups a
   * whole operation — an intent, the plan it produced, every step, every
   * decision — and reading them as one set is what lets "why did you do that?"
   * be answered from recorded fact rather than from a model's account of its
   * own past reasoning.
   */
  readByCorrelation(input: {
    correlationId: string
    principalId?: PrincipalId | undefined
  }): Result<FridayEvent[], FridayError>

  /** The most recent events, newest first. */
  readLatest(input: {
    limit: number
    principalId?: PrincipalId | undefined
  }): Result<FridayEvent[], FridayError>

  /** The highest sequence number, or 0 when the log is empty. */
  latestSeq(): number

  count(): number

  verifyChain(input?: { fromSeq?: number | undefined }): Result<ChainVerification, FridayError>
}

/** A page big enough for a terminal, small enough not to load a year at once. */
const DEFAULT_PAGE = 500

/**
 * Creates the event log's repository.
 *
 * @param options - The database, the key provider, and the field key reference.
 * @returns The event store.
 */
export function createEventStore(options: EventStoreOptions): EventStore {
  const { db, keys, fieldKeyReference } = options

  function tail(): { seq: number; hash: string } {
    const row = db
      .select({ seq: events.seq, integrityHash: events.integrityHash })
      .from(events)
      .orderBy(desc(events.seq))
      .limit(1)
      .get()

    return row === undefined
      ? { seq: 0, hash: GENESIS_HASH }
      : { seq: row.seq, hash: row.integrityHash }
  }

  return {
    append({ event, onRecorded }) {
      const stored = prepareStoredPayload({ event, keys, fieldKeyReference })
      if (!stored.ok) return stored

      try {
        const recorded = db.transaction((tx): FridayEvent => {
          const previous = tail()
          const hashable = buildHashable({ event, seq: previous.seq + 1, payload: stored.value })

          const integrityHash = computeIntegrityHash({
            event: hashable,
            previousHash: previous.hash,
          })

          tx.insert(events)
            .values({ ...hashable, integrityHash })
            .run()

          const written: FridayEvent = {
            ...toEvent(hashable, integrityHash),
            payload: event.payload,
          }

          // The sync lane. A throw here rolls the insert back with it.
          onRecorded?.(written)

          return written
        })

        return ok(recorded)
      } catch (cause) {
        // ★ Chapter 10's most important line: if FRIDAY cannot write the audit
        // trail, she stops. An unrecorded action is worse than no action, so
        // this is reported to the publisher rather than swallowed.
        return err(
          fridayError({
            code: 'EVENT_LOG_UNWRITABLE',
            message:
              `FRIDAY could not record a ${event.type} event, so it did not happen. ` +
              'She does not act when she cannot record.',
            detail: { type: event.type },
            cause,
          }),
        )
      }
    },

    readAfter({ afterSeq, limit, principalId }) {
      // ★ The principal filter is applied INSIDE the query, never to the
      // results. Filtering afterwards lets a caller infer the existence of
      // records it may not see from a count.
      const condition =
        principalId === undefined
          ? gt(events.seq, afterSeq)
          : and(gt(events.seq, afterSeq), eq(events.principalId, principalId))

      const rows = db
        .select()
        .from(events)
        .where(condition)
        .orderBy(asc(events.seq))
        .limit(limit ?? DEFAULT_PAGE)
        .all()

      return decodeRows({ rows, keys, fieldKeyReference })
    },

    readByCorrelation({ correlationId, principalId }) {
      const condition =
        principalId === undefined
          ? eq(events.correlationId, correlationId)
          : and(eq(events.correlationId, correlationId), eq(events.principalId, principalId))

      const rows = db.select().from(events).where(condition).orderBy(asc(events.seq)).all()

      return decodeRows({ rows, keys, fieldKeyReference })
    },

    readLatest({ limit, principalId }) {
      const rows =
        principalId === undefined
          ? db.select().from(events).orderBy(desc(events.seq)).limit(limit).all()
          : db
              .select()
              .from(events)
              .where(eq(events.principalId, principalId))
              .orderBy(desc(events.seq))
              .limit(limit)
              .all()

      return decodeRows({ rows, keys, fieldKeyReference })
    },

    latestSeq() {
      return tail().seq
    },

    count() {
      return db.select({ total: sql<number>`count(*)` }).from(events).get()?.total ?? 0
    },

    verifyChain(input) {
      return verifyChain({ db, fromSeq: input?.fromSeq ?? 1 })
    },
  }
}

/**
 * Serialises the payload and encrypts it when the event is `private`.
 *
 * ★ `secret` is refused rather than encrypted. Chapter 09: secret data never
 * reaches the database at all — it lives in the Keychain, and events carry
 * references to it. An event claiming to carry a secret value is a bug at the
 * publisher, and encrypting it here would put it in the log forever.
 */
function prepareStoredPayload(input: {
  event: AppendableEvent
  keys: KeyProvider
  fieldKeyReference: string
}): Result<string, FridayError> {
  const { event, keys, fieldKeyReference } = input

  if (event.sensitivity === 'secret') {
    return err(
      fridayError({
        code: 'STORAGE_WRITE_FAILED',
        message:
          'An event claimed to carry secret content. Secrets live in the Keychain; events ' +
          'carry references to them, never the values.',
        detail: { type: event.type },
      }),
    )
  }

  const serialised = serialisePayload(event.payload)

  return event.sensitivity === 'private'
    ? encryptField({ plaintext: serialised, keyReference: fieldKeyReference, keys })
    : ok(serialised)
}

function buildHashable(input: {
  event: AppendableEvent
  seq: number
  payload: string
}): HashableEvent {
  const { event, seq, payload } = input
  const now = Date.now()

  return {
    seq,
    id: uuidv7(),
    type: event.type,
    occurredAt: event.occurredAt ?? now,
    recordedAt: now,
    actorType: event.actor.type,
    actorId: event.actor.id,
    principalId: event.principalId,
    subjectType: event.subject?.type ?? null,
    subjectId: event.subject?.id ?? null,
    causationId: event.causationId ?? null,
    correlationId: event.correlationId ?? null,
    traceId: event.traceId ?? null,
    payload,
    payloadVersion: event.payloadVersion ?? 1,
    sensitivity: event.sensitivity,
  }
}

export type { ChainVerification }
