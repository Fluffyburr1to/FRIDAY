import { CHAIN_DIGEST_MIGRATION } from './chain-digest-migration.js'
import { GUARDIAN_MIGRATION } from './guardian-migration.js'
import type { Migration } from './runner.js'

/**
 * `events.db` — the immutable event log, and the Guardian's records.
 *
 * Its own file because its requirements are opposite to everything else's: it
 * is append-only, write-heavy, grows forever, and is irreplaceable. Keeping it
 * apart means archiving old events cannot disturb live data, and continuous
 * backup does not have to carry gigabytes of disposable cache.
 *
 * ★ The Guardian's four tables are here despite being mutable, and that is the
 * one exception to the paragraph above. They are the only state that must be
 * written in the same transaction as the event describing it: an approval
 * answered in `friday.db` and recorded in `events.db` can crash between the
 * two, leaving either an authorized action with no audit record or a log
 * asserting an approval the state denies. A transaction cannot span two SQLite
 * files, and `ATTACH` does not close the gap under WAL. One file makes the two
 * writes one write.
 *
 * The append-only discipline survives as a rule about the `events` table
 * rather than about the file — `EventStore` cannot update it, and
 * `maintenance` remains the only path permitted to.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 10 ·
 * docs/adr/0032-the-guardians-state-moves-into-the-event-log-database.md
 */
export const EVENTS_MIGRATIONS: readonly Migration[] = [
  {
    id: '0001',
    name: 'the event log',
    sql: `
      CREATE TABLE events (
        -- ★ Assigned explicitly inside the append transaction rather than by
        -- AUTOINCREMENT. Gapless is a stronger promise than monotonic, and it
        -- is what lets a subscriber resume from "everything after 412" and
        -- know that nothing between 412 and where it restarts was skipped.
        seq             INTEGER PRIMARY KEY,

        id              TEXT    NOT NULL UNIQUE,
        type            TEXT    NOT NULL,
        occurred_at     INTEGER NOT NULL,
        recorded_at     INTEGER NOT NULL,

        actor_type      TEXT    NOT NULL,
        actor_id        TEXT    NOT NULL,

        -- ★ The multi-user seam. Every event names whose data it concerns.
        principal_id    TEXT    NOT NULL,

        subject_type    TEXT,
        subject_id      TEXT,

        -- ★ Together these make "why?" answerable from recorded fact.
        causation_id    TEXT,
        correlation_id  TEXT,
        trace_id        TEXT,

        -- The exact bytes that were hashed. Stored as written, never
        -- re-serialised, because re-serialising is how a chain breaks for a
        -- reason nobody can find.
        payload         TEXT    NOT NULL,
        payload_version INTEGER NOT NULL,

        sensitivity     TEXT    NOT NULL,

        -- SHA-256 over the previous hash and this row's canonical form.
        integrity_hash  TEXT    NOT NULL
      ) STRICT;

      -- ★ Immutability enforced by the database, not by code review.
      --
      -- Note for whoever implements 'friday forget': redaction replaces a
      -- payload with a tombstone, which is an UPDATE, and these triggers will
      -- refuse it. That is correct. Redaction needs its own deliberately
      -- privileged, separately audited path — it must not be enabled by
      -- loosening these.
      CREATE TRIGGER events_are_append_only_update
        BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;

      CREATE TRIGGER events_are_append_only_delete
        BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;

      CREATE INDEX idx_events_type          ON events (type, seq);
      CREATE INDEX idx_events_correlation   ON events (correlation_id, seq);
      CREATE INDEX idx_events_causation     ON events (causation_id);
      CREATE INDEX idx_events_principal     ON events (principal_id, seq);
      CREATE INDEX idx_events_occurred      ON events (occurred_at);

      -- Where each async subscriber has acknowledged up to. On restart it
      -- resumes from here, which is what makes at-least-once delivery hold
      -- across a crash rather than only in the happy path.
      CREATE TABLE subscriber_checkpoints (
        subscriber_id  TEXT    PRIMARY KEY,
        last_acked_seq INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      ) STRICT;

      -- A subscriber that failed every retry. Kept rather than dropped: the
      -- event still happened, and losing the record of a failed delivery is
      -- how a system quietly stops doing something nobody notices.
      CREATE TABLE dead_letters (
        id            TEXT    PRIMARY KEY,
        subscriber_id TEXT    NOT NULL,
        event_seq     INTEGER NOT NULL,
        attempts      INTEGER NOT NULL,
        error         TEXT    NOT NULL,
        failed_at     INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_dead_letters_subscriber ON dead_letters (subscriber_id, failed_at);
    `,
  },
  CHAIN_DIGEST_MIGRATION,
  GUARDIAN_MIGRATION,
]
