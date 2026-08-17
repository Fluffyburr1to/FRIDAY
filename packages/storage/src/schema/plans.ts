import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * The Drizzle description of the plan tables in `friday.db`.
 *
 * A plan is a row, not a running function. That is what lets it survive a
 * restart, wait days in `awaiting_approval`, and resume exactly where it
 * stopped — and it is the reason Article III's approval requirement is
 * practical rather than theoretical.
 *
 * ★ Completed to Chapter 12 at M5, before the engine was built, while these
 * tables were still empty on every machine. See ADR-0045.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 12
 */
export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    principalId: text('principal_id').notNull(),

    /** What the owner said, verbatim. Never rewritten. */
    utterance: text('utterance').notNull(),

    /** The structured interpretation, as JSON. An interpretation, not the ask. */
    intent: text('intent').notNull(),

    /** Why this decomposition, in plain language. Shown before approval. */
    rationale: text('rationale').notNull(),

    /** Composed from events on completion. A cache of a derivation. */
    explanation: text('explanation'),

    status: text('status').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
    budgetTokens: integer('budget_tokens'),
    budgetCents: integer('budget_cents'),
    budgetDeadlineMs: integer('budget_deadline_ms'),
    spentTokens: integer('spent_tokens').notNull().default(0),
    spentCents: integer('spent_cents').notNull().default(0),
  },
  (table) => [
    index('idx_plans_principal_status').on(table.principalId, table.status, table.createdAt),
    index('idx_plans_correlation').on(table.correlationId),
  ],
)

export const planSteps = sqliteTable(
  'plan_steps',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    principalId: text('principal_id').notNull(),

    /** Presentation order. **Not** the execution order — that is `depends_on`. */
    sequence: integer('sequence').notNull(),

    /** The execution order: step ids, as JSON, that must finish before this one. */
    dependsOn: text('depends_on').notNull(),

    /** What this step does, for the owner to read when approving. */
    description: text('description').notNull(),

    status: text('status').notNull(),
    actionType: text('action_type').notNull(),
    actionPayload: text('action_payload').notNull(),

    /** Which department owns it. Known at planning time; routing is deterministic. */
    department: text('department').notNull(),

    /** Nothing reaches the Guardian unclassified — and the Guardian sets this. */
    riskClass: text('risk_class').notNull(),

    /** Declared at planning time. No default: not deciding is an invalid plan. */
    onFailure: text('on_failure').notNull(),

    approvalId: text('approval_id'),
    agentId: text('agent_id'),

    result: text('result'),
    error: text('error'),

    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    attempt: integer('attempt').notNull().default(0),

    /**
     * ★ Prevents the worst class of bug here: resuming after a crash between
     * sending an email and recording that it was sent.
     */
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (table) => [
    unique('idx_plan_steps_idempotency').on(table.idempotencyKey),
    index('idx_plan_steps_plan').on(table.planId, table.sequence),
    index('idx_plan_steps_principal').on(table.principalId, table.status),
  ],
)

export type PlanRow = typeof plans.$inferSelect
export type PlanStepRow = typeof planSteps.$inferSelect
