import { err, type FridayError, fridayError, ok, type Result, uuidv7 } from '@friday/contracts'
import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { deadLetters, subscriberCheckpoints } from '../schema/events.js'

/**
 * Where each async subscriber has got to, and what it gave up on.
 *
 * This is what makes at-least-once delivery survive a crash. On restart, a
 * subscriber resumes from its last acknowledged sequence number rather than
 * from wherever the log happens to be — so events published while it was down
 * are delivered, and events it had already handled may be delivered again.
 *
 * That "may be delivered again" is a hard requirement on every handler:
 * processing the same event twice must produce the same result as processing
 * it once. Exactly-once delivery is famously impossible to guarantee and
 * expensive to approximate; idempotent handlers are the honest alternative.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

export interface DeadLetter {
  readonly id: string
  readonly subscriberId: string
  readonly eventSeq: number
  readonly attempts: number
  readonly error: string
  readonly failedAt: number
}

export interface CheckpointStore {
  /**
   * Where a subscriber has acknowledged up to.
   *
   * @param subscriberId - The subscriber's stable name.
   * @returns The last acknowledged sequence number, or 0 for one that has
   *   never run. Zero means "start from the beginning", which is correct for a
   *   newly added subscriber that needs to see the history.
   */
  lastAcked(subscriberId: string): number

  /** Records progress. Called after a handler returns, never before. */
  acknowledge(input: { subscriberId: string; seq: number }): Result<void, FridayError>

  /** Every checkpoint, for `friday status`. */
  list(): readonly { subscriberId: string; lastAckedSeq: number; updatedAt: number }[]

  /**
   * Records a delivery that failed every retry.
   *
   * Kept rather than dropped. The event still happened, and losing the record
   * of a failed delivery is how a system quietly stops doing something that
   * nobody notices for a month.
   */
  deadLetter(input: {
    subscriberId: string
    eventSeq: number
    attempts: number
    error: string
  }): Result<void, FridayError>

  listDeadLetters(input?: { subscriberId?: string | undefined }): readonly DeadLetter[]

  countDeadLetters(): number
}

/**
 * Creates the checkpoint and dead-letter repository.
 *
 * @param db - The `events.db` handle.
 * @returns The store.
 */
export function createCheckpointStore(db: BetterSQLite3Database): CheckpointStore {
  return {
    lastAcked(subscriberId) {
      const row = db
        .select({ lastAckedSeq: subscriberCheckpoints.lastAckedSeq })
        .from(subscriberCheckpoints)
        .where(eq(subscriberCheckpoints.subscriberId, subscriberId))
        .get()

      return row?.lastAckedSeq ?? 0
    },

    acknowledge({ subscriberId, seq }) {
      try {
        db.insert(subscriberCheckpoints)
          .values({ subscriberId, lastAckedSeq: seq, updatedAt: Date.now() })
          .onConflictDoUpdate({
            target: subscriberCheckpoints.subscriberId,
            set: { lastAckedSeq: seq, updatedAt: Date.now() },
          })
          .run()

        return ok(undefined)
      } catch (cause) {
        return err(
          fridayError({
            code: 'STORAGE_WRITE_FAILED',
            message: `Could not record progress for the subscriber "${subscriberId}".`,
            detail: { subscriberId, seq },
            cause,
          }),
        )
      }
    },

    list() {
      return db
        .select()
        .from(subscriberCheckpoints)
        .orderBy(asc(subscriberCheckpoints.subscriberId))
        .all()
    },

    deadLetter({ subscriberId, eventSeq, attempts, error }) {
      try {
        db.insert(deadLetters)
          .values({ id: uuidv7(), subscriberId, eventSeq, attempts, error, failedAt: Date.now() })
          .run()

        return ok(undefined)
      } catch (cause) {
        return err(
          fridayError({
            code: 'STORAGE_WRITE_FAILED',
            message: `Could not record a dead-lettered event for "${subscriberId}".`,
            detail: { subscriberId, eventSeq },
            cause,
          }),
        )
      }
    },

    listDeadLetters(input) {
      const subscriberId = input?.subscriberId

      return subscriberId === undefined
        ? db.select().from(deadLetters).orderBy(asc(deadLetters.failedAt)).all()
        : db
            .select()
            .from(deadLetters)
            .where(eq(deadLetters.subscriberId, subscriberId))
            .orderBy(asc(deadLetters.failedAt))
            .all()
    },

    countDeadLetters() {
      return db.select({ id: deadLetters.id }).from(deadLetters).all().length
    },
  }
}
