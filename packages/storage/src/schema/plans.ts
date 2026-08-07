import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * The Drizzle description of the plan tables in `friday.db`.
 *
 * A plan is a row, not a running function. That is what lets it survive a
 * restart, wait days in `awaiting_approval`, and resume exactly where it
 * stopped — and it is the reason Article III's approval requirement is
 * practical rather than theoretical.
 *
 * Reference: docs/01-bible/09-database-design.md
 */
export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    principalId: text('principal_id').notNull(),
    intent: text('intent').notNull(),
    status: text('status').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
    budgetTokens: integer('budget_tokens'),
    budgetCents: integer('budget_cents'),
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
    sequence: integer('sequence').notNull(),
    status: text('status').notNull(),
    actionType: text('action_type').notNull(),
    actionPayload: text('action_payload').notNull(),
    riskClass: text('risk_class').notNull(),
    approvalId: text('approval_id'),
    agentId: text('agent_id'),
    result: text('result'),
    error: text('error'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    attempt: integer('attempt').notNull().default(0),
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
