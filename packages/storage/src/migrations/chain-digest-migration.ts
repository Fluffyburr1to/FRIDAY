import type { Connection } from '../connection.js'
import { computeIntegrityHash, computePayloadDigest, GENESIS_HASH } from '../event-hash.js'
import type { Migration } from './runner.js'

/**
 * Moving the integrity chain onto a payload digest. ADR-0028.
 *
 * ★ **This migration rewrites every hash in the log**, and it is the last time
 * that happens wholesale. It is the operation the chain exists to make
 * detectable, so it is done deliberately, once, inside one transaction, with a
 * snapshot taken first by the runner — and it records what it did.
 *
 * The order below is the whole of the care:
 *
 *   1. Replace the append-only triggers with ones that consult a maintenance
 *      window, so the exemption is narrow and visible rather than a period
 *      with no protection at all.
 *   2. Rebuild `events` with the new columns. SQLite cannot add a NOT NULL
 *      column to an existing table, and a nullable digest would mean every
 *      later reader has to handle a case that should be impossible.
 *   3. Recompute, in JavaScript, because SQLite has no SHA-256.
 *
 * Reference: docs/adr/0028-the-chain-covers-a-payload-digest-and-is-segmented.md
 */

/** The row shape this migration reads out of the old table. */
interface OldRow {
  seq: number
  id: string
  type: string
  occurred_at: number
  recorded_at: number
  actor_type: string
  actor_id: string
  principal_id: string
  subject_type: string | null
  subject_id: string | null
  causation_id: string | null
  correlation_id: string | null
  trace_id: string | null
  payload: string
  payload_version: number
  sensitivity: string
}

const SCHEMA = `
  -- The old table is renamed rather than dropped, so the copy reads from a
  -- table that still exists and a failure anywhere leaves the original intact.
  DROP TRIGGER events_are_append_only_update;
  DROP TRIGGER events_are_append_only_delete;

  ALTER TABLE events RENAME TO events_pre_digest;

  CREATE TABLE events (
    seq             INTEGER PRIMARY KEY,
    id              TEXT    NOT NULL UNIQUE,
    type            TEXT    NOT NULL,
    occurred_at     INTEGER NOT NULL,
    recorded_at     INTEGER NOT NULL,
    actor_type      TEXT    NOT NULL,
    actor_id        TEXT    NOT NULL,
    principal_id    TEXT    NOT NULL,
    subject_type    TEXT,
    subject_id      TEXT,
    causation_id    TEXT,
    correlation_id  TEXT,
    trace_id        TEXT,

    -- The bytes. Replaced by a tombstone when content is deliberately removed.
    payload         TEXT    NOT NULL,

    -- ★ What the chain covers: SHA-256 of the payload as FIRST written.
    -- Survives compaction, which is the entire point — it is what lets
    -- "the content was removed" stay provable rather than looking like
    -- corruption.
    payload_digest  TEXT    NOT NULL,

    payload_version INTEGER NOT NULL,
    sensitivity     TEXT    NOT NULL,
    integrity_hash  TEXT    NOT NULL,

    -- Null for a live event. Set, with a reason, when the payload was removed.
    compacted_at    INTEGER,
    compaction_reason TEXT
  ) STRICT;

  -- One row, which the triggers consult. Closed.
  CREATE TABLE maintenance_window (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    open      INTEGER NOT NULL DEFAULT 0,
    reason    TEXT,
    opened_at INTEGER
  ) STRICT;

  INSERT INTO maintenance_window (id, open) VALUES (1, 0);

  CREATE TABLE chain_segments (
    from_seq     INTEGER PRIMARY KEY,
    to_seq       INTEGER NOT NULL,
    final_hash   TEXT    NOT NULL,
    event_count  INTEGER NOT NULL,
    sealed_at    INTEGER NOT NULL,
    archive_path TEXT
  ) STRICT;
`

const RESTORE = `
  DROP TABLE events_pre_digest;

  CREATE INDEX idx_events_type        ON events (type, seq);
  CREATE INDEX idx_events_correlation ON events (correlation_id, seq);
  CREATE INDEX idx_events_causation   ON events (causation_id);
  CREATE INDEX idx_events_principal   ON events (principal_id, seq);
  CREATE INDEX idx_events_occurred    ON events (occurred_at);

  -- ★ Still append-only. The exemption is one row in one table, and opening it
  -- is a deliberate act inside a transaction that closes it again.
  --
  -- This replaces the M1 triggers rather than loosening them: outside a
  -- maintenance window the behaviour is identical, and the note in migration
  -- 0001 asking for redaction to have "its own deliberately privileged,
  -- separately audited path" is what this is.
  CREATE TRIGGER events_are_append_only_update
    BEFORE UPDATE ON events
    WHEN (SELECT open FROM maintenance_window WHERE id = 1) = 0
    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;

  CREATE TRIGGER events_are_append_only_delete
    BEFORE DELETE ON events
    WHEN (SELECT open FROM maintenance_window WHERE id = 1) = 0
    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;
`

export const CHAIN_DIGEST_MIGRATION: Migration = {
  id: '0002',
  name: 'the chain covers a payload digest',
  sql: SCHEMA,

  run(connection: Connection) {
    const rows = connection
      .prepare('SELECT * FROM events_pre_digest ORDER BY seq ASC')
      .all() as OldRow[]

    const insert = connection.prepare(`
      INSERT INTO events (
        seq, id, type, occurred_at, recorded_at, actor_type, actor_id,
        principal_id, subject_type, subject_id, causation_id, correlation_id,
        trace_id, payload, payload_digest, payload_version, sensitivity,
        integrity_hash, compacted_at, compaction_reason)
      VALUES (@seq, @id, @type, @occurredAt, @recordedAt, @actorType, @actorId,
              @principalId, @subjectType, @subjectId, @causationId, @correlationId,
              @traceId, @payload, @payloadDigest, @payloadVersion, @sensitivity,
              @integrityHash, NULL, NULL)`)

    let previousHash = GENESIS_HASH

    for (const row of rows) {
      const payloadDigest = computePayloadDigest(row.payload)

      const integrityHash = computeIntegrityHash({
        previousHash,
        event: {
          seq: row.seq,
          id: row.id,
          type: row.type,
          occurredAt: row.occurred_at,
          recordedAt: row.recorded_at,
          actorType: row.actor_type,
          actorId: row.actor_id,
          principalId: row.principal_id,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          causationId: row.causation_id,
          correlationId: row.correlation_id,
          traceId: row.trace_id,
          payloadDigest,
          payloadVersion: row.payload_version,
          sensitivity: row.sensitivity,
        },
      })

      insert.run({
        seq: row.seq,
        id: row.id,
        type: row.type,
        occurredAt: row.occurred_at,
        recordedAt: row.recorded_at,
        actorType: row.actor_type,
        actorId: row.actor_id,
        principalId: row.principal_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        causationId: row.causation_id,
        correlationId: row.correlation_id,
        traceId: row.trace_id,
        payload: row.payload,
        payloadDigest,
        payloadVersion: row.payload_version,
        sensitivity: row.sensitivity,
        integrityHash,
      })

      previousHash = integrityHash
    }

    connection.exec(RESTORE)
  },
}
