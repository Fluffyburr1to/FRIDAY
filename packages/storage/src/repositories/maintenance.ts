import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import type { Connection } from '../connection.js'

/**
 * The one path permitted to change the event log.
 *
 * Everything else in this package appends and reads. This file exists because
 * Chapter 10 requires compaction and the audit package requires redaction, and
 * both change rows that are otherwise immutable.
 *
 * ★ **The append-only triggers are never dropped.** They consult a maintenance
 * window, and every operation here opens it, does one specific thing, and
 * closes it — inside a single transaction, so a crash rolls the window shut
 * along with whatever it permitted. There is no code path that leaves the log
 * writable.
 *
 * What this cannot do, by construction: change any field the integrity chain
 * covers. It replaces payload bytes and sets the columns that record the
 * replacement. The chain still verifies afterwards, and the content check
 * reports the removal — which is the entire point of ADR-0028.
 *
 * Reference: docs/01-bible/10-event-bus.md · ADR-0028
 */

/** What a compaction did. */
export interface CompactionOutcome {
  readonly compacted: number
  readonly bytesReclaimed: number
}

/** A range that has left the live log. */
export interface SealedSegment {
  readonly fromSeq: number
  readonly toSeq: number
  readonly finalHash: string
  readonly eventCount: number
  readonly sealedAt: number
  readonly archivePath: string | null
}

/** The privileged operations. */
export interface Maintenance {
  /**
   * Replaces payloads with a tombstone, keeping everything the chain covers.
   *
   * @param input - Which events, and why. The reason is stored on each row and
   *   shown to the owner, so it has to be in their language.
   * @returns How many were compacted and roughly how much was reclaimed.
   */
  compact(input: {
    eventIds: readonly string[]
    reason: string
    now?: number | undefined
  }): Result<CompactionOutcome, FridayError>

  /** Every sealed segment, oldest first. */
  segments(): Result<readonly SealedSegment[], FridayError>

  /**
   * Seals a range and removes it from the live log.
   *
   * **The caller must have written and verified the archive first.** This does
   * the irreversible half, and it does it last on purpose.
   *
   * @param input - The range, where its archive was written, and the clock.
   * @returns The sealed segment.
   */
  sealAndRemove(input: {
    fromSeq: number
    toSeq: number
    archivePath: string
    now?: number | undefined
  }): Result<SealedSegment, FridayError>
}

/** The tombstone a compacted payload is replaced with. */
export const TOMBSTONE = '{"compacted":true}'

interface EventRowLite {
  seq: number
  payload: string
  compacted_at: number | null
}

/**
 * Creates the maintenance repository.
 *
 * @param db - The `events.db` connection. Raw rather than through Drizzle,
 *   because these statements run inside a hand-managed window and the SQL
 *   should be readable in full at the point it is authorised.
 * @returns The privileged operations.
 */
export function createMaintenance(db: Connection): Maintenance {
  /**
   * Runs work with the window open, and closes it whatever happens.
   *
   * The whole thing is one transaction: if `work` throws, the rollback takes
   * the open window with it. There is no state in which the log is writable
   * and nobody is inside this function.
   */
  function withWindow<T>(reason: string, work: () => T): Result<T, FridayError> {
    try {
      return ok(
        db.transaction(() => {
          db.prepare(
            'UPDATE maintenance_window SET open = 1, reason = ?, opened_at = ? WHERE id = 1',
          ).run(reason, Date.now())

          try {
            return work()
          } finally {
            db.prepare(
              'UPDATE maintenance_window SET open = 0, reason = NULL, opened_at = NULL WHERE id = 1',
            ).run()
          }
        })(),
      )
    } catch (cause) {
      return err(
        fridayError({
          code: 'STORAGE_WRITE_FAILED',
          message: `FRIDAY could not ${reason}, and nothing was changed.`,
          cause,
        }),
      )
    }
  }

  return {
    compact({ eventIds, reason, now }) {
      if (eventIds.length === 0) return ok({ compacted: 0, bytesReclaimed: 0 })

      const at = now ?? Date.now()

      return withWindow('compact old events', () => {
        const read = db.prepare('SELECT seq, payload, compacted_at FROM events WHERE id = ?')
        const write = db.prepare(
          'UPDATE events SET payload = ?, compacted_at = ?, compaction_reason = ? WHERE id = ?',
        )

        let compacted = 0
        let bytesReclaimed = 0

        for (const id of eventIds) {
          const row = read.get(id) as EventRowLite | undefined

          // Already compacted, or gone. Skipped rather than treated as an
          // error: a sweep that runs twice must be safe, and the second run
          // finding nothing to do is the normal case.
          if (row === undefined || row.compacted_at !== null) continue

          bytesReclaimed += Math.max(0, row.payload.length - TOMBSTONE.length)
          write.run(TOMBSTONE, at, reason, id)
          compacted += 1
        }

        return { compacted, bytesReclaimed }
      })
    },

    segments() {
      try {
        const rows = db
          .prepare('SELECT * FROM chain_segments ORDER BY from_seq ASC')
          .all() as Array<{
          from_seq: number
          to_seq: number
          final_hash: string
          event_count: number
          sealed_at: number
          archive_path: string | null
        }>

        return ok(
          rows.map((row) => ({
            fromSeq: row.from_seq,
            toSeq: row.to_seq,
            finalHash: row.final_hash,
            eventCount: row.event_count,
            sealedAt: row.sealed_at,
            archivePath: row.archive_path,
          })),
        )
      } catch (cause) {
        return err(
          fridayError({
            code: 'STORAGE_UNAVAILABLE',
            message: 'FRIDAY could not read which stretches of the log have been archived.',
            cause,
          }),
        )
      }
    },

    sealAndRemove({ fromSeq, toSeq, archivePath, now }) {
      const at = now ?? Date.now()

      return withWindow('archive a stretch of the log', () => {
        const last = db.prepare('SELECT integrity_hash FROM events WHERE seq = ?').get(toSeq) as
          | { integrity_hash: string }
          | undefined

        if (last === undefined) {
          throw new Error(`event ${toSeq} is not in the log, so the range cannot be sealed`)
        }

        const counted = db
          .prepare('SELECT COUNT(*) AS total FROM events WHERE seq >= ? AND seq <= ?')
          .get(fromSeq, toSeq) as { total: number }

        // ★ The seal is written BEFORE the rows are removed. If the delete
        // fails, the transaction takes the seal with it; if the seal could not
        // be written, nothing is deleted. The one ordering that cannot leave a
        // gap nothing accounts for.
        db.prepare(
          `INSERT INTO chain_segments (from_seq, to_seq, final_hash, event_count, sealed_at, archive_path)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(fromSeq, toSeq, last.integrity_hash, counted.total, at, archivePath)

        db.prepare('DELETE FROM events WHERE seq >= ? AND seq <= ?').run(fromSeq, toSeq)

        return {
          fromSeq,
          toSeq,
          finalHash: last.integrity_hash,
          eventCount: counted.total,
          sealedAt: at,
          archivePath,
        }
      })
    },
  }
}
