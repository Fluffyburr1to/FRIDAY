import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The Drizzle description of `events.db`.
 *
 * Deliberately a second description of the same shape the migrations create.
 * Drizzle Kit could generate one from the other, and is not used here: the
 * migrations are hand-written SQL because they contain triggers and a STRICT
 * table, neither of which round-trips cleanly through a schema generator, and
 * a migration nobody can read is a migration nobody can review.
 *
 * The two are kept honest by a test that opens a migrated database and selects
 * every column through Drizzle. A column added to one and not the other fails
 * there rather than at runtime.
 *
 * Reference: docs/01-bible/09-database-design.md
 */
export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey(),
    id: text('id').notNull().unique(),
    type: text('type').notNull(),
    occurredAt: integer('occurred_at').notNull(),
    recordedAt: integer('recorded_at').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    principalId: text('principal_id').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    causationId: text('causation_id'),
    correlationId: text('correlation_id'),
    traceId: text('trace_id'),
    payload: text('payload').notNull(),

    /** ★ What the chain covers. SHA-256 of the payload as first written. */
    payloadDigest: text('payload_digest').notNull(),

    payloadVersion: integer('payload_version').notNull(),
    sensitivity: text('sensitivity').notNull(),
    integrityHash: text('integrity_hash').notNull(),

    /** Set when the payload was deliberately removed. Null for a live event. */
    compactedAt: integer('compacted_at'),
    compactionReason: text('compaction_reason'),
  },
  (table) => [
    index('idx_events_type').on(table.type, table.seq),
    index('idx_events_correlation').on(table.correlationId, table.seq),
    index('idx_events_causation').on(table.causationId),
    index('idx_events_principal').on(table.principalId, table.seq),
    index('idx_events_occurred').on(table.occurredAt),
  ],
)

/**
 * Ranges that have left `events.db`, and the hash they ended on.
 *
 * A chain cannot span a gap. Rather than pretending otherwise, an archived
 * range is sealed here and the live chain continues from its final hash — so a
 * gap that is accounted for reads as "archived" and one that is not still
 * reads as broken. ADR-0028.
 */
export const chainSegments = sqliteTable('chain_segments', {
  fromSeq: integer('from_seq').primaryKey(),
  toSeq: integer('to_seq').notNull(),

  /** The integrity hash of the last event in the range. */
  finalHash: text('final_hash').notNull(),

  eventCount: integer('event_count').notNull(),
  sealedAt: integer('sealed_at').notNull(),

  /** Where the events went. Null while they are still local. */
  archivePath: text('archive_path'),
})

/**
 * The one narrow exemption to append-only.
 *
 * The triggers on `events` are not dropped to allow compaction; they consult
 * this row instead. Opening the window, doing the work, and closing it happen
 * inside a single transaction, so a crash rolls the window shut along with
 * everything it permitted.
 */
export const maintenanceWindow = sqliteTable('maintenance_window', {
  id: integer('id').primaryKey(),
  open: integer('open').notNull(),
  reason: text('reason'),
  openedAt: integer('opened_at'),
})

export const subscriberCheckpoints = sqliteTable('subscriber_checkpoints', {
  subscriberId: text('subscriber_id').primaryKey(),
  lastAckedSeq: integer('last_acked_seq').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const deadLetters = sqliteTable('dead_letters', {
  id: text('id').primaryKey(),
  subscriberId: text('subscriber_id').notNull(),
  eventSeq: integer('event_seq').notNull(),
  attempts: integer('attempts').notNull(),
  error: text('error').notNull(),
  failedAt: integer('failed_at').notNull(),
})

/** A row exactly as it sits in the table, before any decoding. */
export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert
