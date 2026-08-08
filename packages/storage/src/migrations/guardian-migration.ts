import type { Migration } from './runner.js'

/**
 * Milestone 2's tables in `friday.db`: the Guardian's memory.
 *
 * These are what make Article III practical rather than theoretical. An
 * approval request is a row, so it survives a restart and can wait days for an
 * answer — and the cost of waiting is zero, which is what removes the pressure
 * to add a timeout that proceeds anyway.
 *
 * Every table carries `principal_id` and every query filters on it, for the
 * same reason the M1 tables do: one column now versus a security audit later.
 *
 * Reference: docs/01-bible/19-approval-system.md · Chapter 17 · Chapter 09
 */
export const GUARDIAN_MIGRATION: Migration = {
  id: '0002',
  name: 'approvals, standing grants, capabilities, and decisions',
  sql: `
    -- ── Approval requests ────────────────────────────────────────────────
    --
    -- The explanation columns are NOT NULL because Chapter 19 forbids asking
    -- the owner about something FRIDAY cannot explain. The Zod schema refuses
    -- an incomplete request; this refuses one that got past it.
    CREATE TABLE approvals (
      id                TEXT    PRIMARY KEY,
      principal_id      TEXT    NOT NULL,

      title             TEXT    NOT NULL,
      risk_class        TEXT    NOT NULL,

      explanation_what  TEXT    NOT NULL,
      explanation_why   TEXT    NOT NULL,

      -- Recorded and shown, never used to decide. Chapter 19 rejects
      -- confidence-based auto-approval: an injected model is often highly
      -- confident, so tying authority to self-reported certainty would bypass
      -- the human in exactly the cases that most need one.
      confidence        REAL    NOT NULL,

      risks             TEXT    NOT NULL,
      alternatives      TEXT    NOT NULL,

      -- ★ The actual artifact, from a connector's dry run. You approve the
      -- email that will be sent, not a summary of it.
      preview_kind      TEXT    NOT NULL,
      preview_content   TEXT    NOT NULL,

      reversible          INTEGER NOT NULL,
      data_leaves_device  INTEGER NOT NULL,
      data_categories     TEXT    NOT NULL,
      estimated_cost_cents INTEGER,

      actor_type        TEXT    NOT NULL,
      actor_id          TEXT    NOT NULL,
      action            TEXT    NOT NULL,
      resource          TEXT    NOT NULL,

      plan_id           TEXT,
      plan_step_id      TEXT,
      correlation_id    TEXT,
      decision_id       TEXT    NOT NULL,

      required_auth     TEXT    NOT NULL,

      created_at        INTEGER NOT NULL,

      -- ★ Requests expire rather than accumulating into a backlog nobody
      -- faces. Reaching this without an answer means denied.
      expires_at        INTEGER NOT NULL,

      status            TEXT    NOT NULL,
      responded_at      INTEGER,
      responded_via     TEXT,
      response_reason   TEXT
    ) STRICT;

    -- The dashboard's "needs you" panel, and the expiry sweep, are both this
    -- query. Article III depends on the owner noticing.
    CREATE INDEX idx_approvals_pending  ON approvals (status, expires_at);
    CREATE INDEX idx_approvals_principal ON approvals (principal_id, status, created_at);
    CREATE INDEX idx_approvals_decision ON approvals (decision_id);

    -- ── Standing grants ──────────────────────────────────────────────────
    --
    -- expires_at is NOT NULL, which is ADR-0012 expressed in the schema:
    -- there is no way to write a perpetual grant down.
    CREATE TABLE standing_grants (
      id                    TEXT    PRIMARY KEY,
      principal_id          TEXT    NOT NULL,

      action_pattern        TEXT    NOT NULL,
      resource_pattern      TEXT    NOT NULL,
      risk_class            TEXT    NOT NULL,

      -- True for a standing denial. "Never ask me about this again" is a
      -- boundary, and a system that cannot record boundaries keeps asking.
      negative              INTEGER NOT NULL DEFAULT 0,

      max_amount_cents      INTEGER,
      max_per_day           INTEGER,
      time_window           TEXT,
      requires_dry_run_match INTEGER NOT NULL DEFAULT 0,

      -- The owner's own words, shown back to them when the grant is applied.
      reason                TEXT    NOT NULL,

      created_at            INTEGER NOT NULL,
      expires_at            INTEGER NOT NULL,

      max_uses              INTEGER,
      uses                  INTEGER NOT NULL DEFAULT 0,
      revoked_at            INTEGER
    ) STRICT;

    CREATE INDEX idx_grants_principal ON standing_grants (principal_id, expires_at);

    -- ── Capabilities ─────────────────────────────────────────────────────
    --
    -- The token is a signed handle to one of these rows and carries no claims
    -- of its own, which is what makes revocation instant and max_calls
    -- enforceable. See ADR-0026.
    CREATE TABLE capabilities (
      id              TEXT    PRIMARY KEY,
      principal_id    TEXT    NOT NULL,

      issued_to_type  TEXT    NOT NULL,
      issued_to_id    TEXT    NOT NULL,

      -- ★ The work that justified issuing it. This is what makes "why does
      -- this agent hold permission to read contacts?" answerable from data.
      plan_id         TEXT,
      plan_step_id    TEXT,

      -- Exactly one action on exactly one resource. Never a pattern.
      action          TEXT    NOT NULL,
      resource        TEXT    NOT NULL,

      max_calls       INTEGER,
      max_amount_cents INTEGER,

      issued_at       INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      uses            INTEGER NOT NULL DEFAULT 0,

      revoked_at      INTEGER,
      revoked_reason  TEXT
    ) STRICT;

    CREATE INDEX idx_capabilities_plan     ON capabilities (plan_id, issued_at);
    CREATE INDEX idx_capabilities_expiry   ON capabilities (expires_at);

    -- ── Guardian decisions ───────────────────────────────────────────────
    --
    -- Every answer, kept. Article II: a decision nobody can look up is not
    -- observable, and authorization is the one subsystem where "trust me, it
    -- was checked" is worth nothing.
    CREATE TABLE guardian_decisions (
      id                TEXT    PRIMARY KEY,
      principal_id      TEXT    NOT NULL,

      decision          TEXT    NOT NULL,
      reason            TEXT    NOT NULL,
      risk_class        TEXT    NOT NULL,

      -- Every rule that matched, not only the deciding one. ADR-0025.
      matched_policies  TEXT    NOT NULL,

      approval_id       TEXT,
      standing_grant_id TEXT,
      capability_id     TEXT,

      -- One line, in the owner's language, composed at decision time from
      -- recorded fact — never afterwards by asking a model what it thought.
      summary           TEXT    NOT NULL,

      actor_type        TEXT    NOT NULL,
      actor_id          TEXT    NOT NULL,
      action            TEXT    NOT NULL,
      resource          TEXT    NOT NULL,

      plan_id           TEXT,
      plan_step_id      TEXT,
      correlation_id    TEXT,

      decided_at        INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX idx_decisions_principal ON guardian_decisions (principal_id, decided_at);
    CREATE INDEX idx_decisions_plan      ON guardian_decisions (plan_id, decided_at);
  `,
}
