import type { Connection } from '../connection.js'
import type { Migration } from './runner.js'

/**
 * `friday.db` — everything current.
 *
 * Plans and their steps at Milestone 1. Memory arrives at M7.
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

  {
    id: '0002',
    name: 'the plan record, completed to Chapter 12',

    // ★ No `sql`. The whole migration lives in `run` for one reason: the runner
    // executes `sql` first and `run` second, and the emptiness assertion below
    // has to happen BEFORE anything is dropped. An assertion that fires after
    // the drop is not a guard, it is a post-mortem.
    run: completeThePlanRecord,
  },
]

/**
 * Rebuilds `plans` and `plan_steps` at the shape Chapter 12 specifies.
 *
 * The M1 tables were laid down ahead of the engine and were a subset of the
 * design: no structured intent, no rationale, no plan-level approval state, no
 * dependency graph, no per-step description, department, or failure action,
 * and no explanation. ADR-0045 completes them, and does it here rather than as
 * a chain of `ALTER TABLE`s because SQLite cannot add a `NOT NULL` column
 * without a default — and inventing defaults for `rationale`, `description`,
 * and `on_failure` would write exactly the meaningless placeholders that
 * ADR-0045 §2 and §5 exist to forbid.
 *
 * ★ **This drops tables, so it proves they are empty first, and refuses
 * otherwise.** That is a binding owner condition (ADR-0045 §7), not an
 * implementation preference. There is no flag that relaxes it. On a machine
 * with plans, the correct behaviour is to stop with the data intact and the
 * schema unchanged — the runner's transaction rolls the whole thing back, and
 * a refusal there is the success case, not a bug to work around.
 *
 * @param connection - The `friday.db` handle, inside the migration transaction.
 */
function completeThePlanRecord(connection: Connection): void {
  refuseIfNotEmpty(connection, 'plans')
  refuseIfNotEmpty(connection, 'plan_steps')

  connection.exec(`
    DROP INDEX IF EXISTS idx_plan_steps_idempotency;
    DROP INDEX IF EXISTS idx_plan_steps_principal;
    DROP INDEX IF EXISTS idx_plan_steps_plan;
    DROP INDEX IF EXISTS idx_plans_correlation;
    DROP INDEX IF EXISTS idx_plans_principal_status;

    -- Steps first: they carry the foreign key into plans.
    DROP TABLE plan_steps;
    DROP TABLE plans;

    CREATE TABLE plans (
      id                 TEXT    PRIMARY KEY,
      principal_id       TEXT    NOT NULL,

      -- ★ Two fields, and neither substitutes for the other. The explanation
      -- of what FRIDAY did has to quote what was actually said, not how a
      -- model restated it — so the words are kept verbatim beside the reading
      -- of them. Dropping either is a change to ADR-0045 §1.
      utterance          TEXT    NOT NULL,
      intent             TEXT    NOT NULL,

      -- Why this decomposition, in plain language. Required, because a plan
      -- that cannot say why it split the work up cannot be approved
      -- meaningfully — and an approval nobody can evaluate is ceremony.
      rationale          TEXT    NOT NULL,

      -- Composed from recorded events when the plan finishes. A cache of a
      -- derivation: if it ever disagrees with the events, the events are right.
      explanation        TEXT,

      status             TEXT    NOT NULL,
      correlation_id     TEXT    NOT NULL,

      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      completed_at       INTEGER,

      -- ★ Budgets live on the plan, not globally. A runaway agent exhausts
      -- its own plan's budget and halts, without stopping anything else.
      budget_tokens      INTEGER,
      budget_cents       INTEGER,

      -- Nullable on purpose: a plan waiting for the owner must not die of old
      -- age. Article III's "survive waiting days" outranks a deadline.
      budget_deadline_ms INTEGER,

      spent_tokens       INTEGER NOT NULL DEFAULT 0,
      spent_cents        INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE INDEX idx_plans_principal_status ON plans (principal_id, status, created_at);
    CREATE INDEX idx_plans_correlation      ON plans (correlation_id);

    CREATE TABLE plan_steps (
      id              TEXT    PRIMARY KEY,
      plan_id         TEXT    NOT NULL REFERENCES plans (id),
      principal_id    TEXT    NOT NULL,

      -- ★ Presentation order ONLY. Until this migration it was the execution
      -- order; that is now depends_on. The index below still exists because
      -- reading a plan down the page is a real query — it is no longer what
      -- the executor consults.
      sequence        INTEGER NOT NULL,

      -- The execution order, as a JSON array of step ids in this same plan.
      -- Independent steps run concurrently; the graph is validated acyclic
      -- before a plan exists, so a cycle is a rejected plan and never a hung
      -- executor.
      depends_on      TEXT    NOT NULL,

      -- What this step does, for the owner to read when approving it.
      description     TEXT    NOT NULL,

      status          TEXT    NOT NULL,

      action_type     TEXT    NOT NULL,
      action_payload  TEXT    NOT NULL,

      -- Known at planning time: routing is a deterministic capability lookup.
      -- agent_id below stays nullable because which agent picks the step up is
      -- a runtime fact, and those are different questions.
      department      TEXT    NOT NULL,

      -- ★ Set by the Guardian, never by the planner. The planner proposes an
      -- action; the Guardian classifies it from a static table. If the planner
      -- assigned risk, a manipulated model could mark a transfer low-risk.
      risk_class      TEXT    NOT NULL,

      -- Declared at planning time, with no default: a planner that did not
      -- decide has produced an invalid plan, and that friction is the point.
      on_failure      TEXT    NOT NULL,

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
  `)
}

interface CountRow {
  n: number
}

/**
 * Throws unless the named table holds no rows.
 *
 * ★ Executable, not documentary. A comment asserting the tables are empty is
 * precisely what ADR-0045 §7 forbids, because the claim it makes is the one
 * thing standing between this migration and someone's plans.
 *
 * Throwing here aborts the runner's transaction, so the tables and their
 * contents survive exactly as they were and the schema is left alone.
 *
 * @param connection - The open database.
 * @param table - `plans` or `plan_steps`.
 */
function refuseIfNotEmpty(connection: Connection, table: 'plans' | 'plan_steps'): void {
  const row = connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as CountRow | undefined
  const count = row?.n ?? 0

  if (count > 0) {
    throw new Error(
      `Migration 0002 refused to run: ${table} holds ${count} row(s), and this migration ` +
        'rebuilds that table from empty.\n\n' +
        '  It was written on the evidence that nothing in FRIDAY had ever created a plan, ' +
        'which was true of every machine when it was written (ADR-0045).\n' +
        '  On this machine it is not true, so the premise is wrong here and nothing has ' +
        'been changed — your plans and the current schema are exactly as they were.\n\n' +
        '  This needs a migration that preserves the existing rows. Do not delete them to ' +
        'get past this message.',
    )
  }
}
