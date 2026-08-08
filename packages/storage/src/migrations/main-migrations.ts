import type { Migration } from './runner.js'

/**
 * `friday.db` — everything current.
 *
 * Plans and their steps at Milestone 1. Memory arrives at M5.
 * The tables are here now because a data model is the thing you cannot
 * cheaply change later: `principal_id` on every row and `idempotency_key` on
 * every step are both one column now and a security review later.
 *
 * ★ The Guardian's records are deliberately NOT here. They live in `events.db`
 * so that an approval and the event recording it commit in one transaction —
 * a transaction cannot span two SQLite files, and an approval that is answered
 * in one file and recorded in another has a crash window between them.
 * See docs/adr/0032-the-guardians-state-moves-into-the-event-log-database.md.
 *
 * Reference: docs/01-bible/09-database-design.md
 */
export const MAIN_MIGRATIONS: readonly Migration[] = [
  {
    id: '0001',
    name: 'plans and steps',
    sql: `
      CREATE TABLE plans (
        id             TEXT    PRIMARY KEY,
        principal_id   TEXT    NOT NULL,

        -- What the owner asked for, in their words. Not a paraphrase: the
        -- explanation of what FRIDAY did has to be traceable to what was
        -- actually said, not to how a model restated it.
        intent         TEXT    NOT NULL,

        status         TEXT    NOT NULL,
        correlation_id TEXT    NOT NULL,

        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        completed_at   INTEGER,

        -- ★ Budgets live on the plan, not globally. A runaway agent exhausts
        -- its own plan's budget and halts, without stopping anything else.
        budget_tokens  INTEGER,
        budget_cents   INTEGER,
        spent_tokens   INTEGER NOT NULL DEFAULT 0,
        spent_cents    INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE INDEX idx_plans_principal_status ON plans (principal_id, status, created_at);
      CREATE INDEX idx_plans_correlation      ON plans (correlation_id);

      CREATE TABLE plan_steps (
        id              TEXT    PRIMARY KEY,
        plan_id         TEXT    NOT NULL REFERENCES plans (id),
        principal_id    TEXT    NOT NULL,

        sequence        INTEGER NOT NULL,
        status          TEXT    NOT NULL,

        action_type     TEXT    NOT NULL,
        action_payload  TEXT    NOT NULL,

        -- Nothing reaches the Guardian unclassified.
        risk_class      TEXT    NOT NULL,

        approval_id     TEXT,
        agent_id        TEXT,

        result          TEXT,
        error           TEXT,

        started_at      INTEGER,
        completed_at    INTEGER,
        attempt         INTEGER NOT NULL DEFAULT 0,

        -- ★ Prevents the worst class of bug here: resuming after a crash
        -- between sending an email and recording that it was sent.
        idempotency_key TEXT    NOT NULL,

        UNIQUE (plan_id, sequence)
      ) STRICT;

      CREATE INDEX idx_plan_steps_plan      ON plan_steps (plan_id, sequence);
      CREATE INDEX idx_plan_steps_principal ON plan_steps (principal_id, status);
      CREATE UNIQUE INDEX idx_plan_steps_idempotency ON plan_steps (idempotency_key);
    `,
  },
]
