import { z } from 'zod'
import { CorrelationIdSchema, PlanIdSchema, PlanStepIdSchema, PrincipalIdSchema } from './ids.js'

/**
 * Plans — durable, resumable work.
 *
 * The single most consequential property of this shape: **a plan is a row, not
 * a running function.** Because it is data, it survives a restart, it can wait
 * days in `awaiting_approval`, it can be inspected mid-flight, and it can be
 * resumed exactly where it stopped.
 *
 * Article III's approval requirement is only practical because waiting costs
 * nothing. If a plan were a call stack, "block until the owner approves" would
 * mean holding a process open for three days, and the pressure to add a
 * timeout that proceeds anyway would be constant.
 *
 * The plan *engine* arrives at M3. The shapes are here at M1 because storage
 * needs the tables, and because a data model is the thing you cannot cheaply
 * change later.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 11
 */

export const PLAN_STATUSES = [
  'draft',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const

export const PlanStatusSchema = z.enum(PLAN_STATUSES)
export type PlanStatus = z.infer<typeof PlanStatusSchema>

export const PLAN_STEP_STATUSES = [
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'skipped',
] as const

export const PlanStepStatusSchema = z.enum(PLAN_STEP_STATUSES)
export type PlanStepStatus = z.infer<typeof PlanStepStatusSchema>

/**
 * Risk classes, ascending.
 *
 * `self_modification` is separate from `critical` rather than folded into it
 * because it carries restrictions no other class does — Chapter 08 forbids
 * approving one from a mobile client, and Chapter 19 caps how long a standing
 * grant covering one may live. A single "critical" bucket would lose that.
 */
export const RISK_CLASSES = ['low', 'medium', 'high', 'critical', 'self_modification'] as const

export const RiskClassSchema = z.enum(RISK_CLASSES)
export type RiskClass = z.infer<typeof RiskClassSchema>

const TimestampSchema = z.int().nonnegative()

/** Cost ceilings live on the plan, so a runaway agent exhausts its own budget. */
const BudgetSchema = z.object({
  budgetTokens: z.int().nonnegative().nullable(),
  budgetCents: z.int().nonnegative().nullable(),
  spentTokens: z.int().nonnegative(),
  spentCents: z.int().nonnegative(),
})

export const PlanSchema = z
  .object({
    id: PlanIdSchema,
    principalId: PrincipalIdSchema,

    /** What the owner asked for, in their words. Not a paraphrase. */
    intent: z.string().min(1).max(4096),

    status: PlanStatusSchema,
    correlationId: CorrelationIdSchema,

    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.nullable(),
  })
  .extend(BudgetSchema.shape)

/** A unit of work FRIDAY has undertaken. */
export type Plan = z.infer<typeof PlanSchema>

export const PlanStepSchema = z.object({
  id: PlanStepIdSchema,
  planId: PlanIdSchema,
  principalId: PrincipalIdSchema,

  /** Position within the plan, from 1. Gapless. */
  sequence: z.int().positive(),

  status: PlanStepStatusSchema,

  /** What this step does, e.g. `calendar.event.create`. */
  actionType: z.string().min(1).max(128),
  actionPayload: z.record(z.string(), z.unknown()),

  riskClass: RiskClassSchema,

  /** Set once the Guardian requires approval. Resolved at M2. */
  approvalId: z.string().min(1).max(128).nullable(),

  /** Which agent ran it. Null until an agent picks it up. */
  agentId: z.string().min(1).max(256).nullable(),

  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),

  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),

  /** Retries so far. The step is the unit of retry, not the plan. */
  attempt: z.int().nonnegative(),

  /**
   * ★ Prevents the worst class of bug in this system. If FRIDAY crashes
   * between sending an email and recording that she sent it, resuming must not
   * send it twice. Every external action carries a key derived from the step,
   * and connectors deduplicate on it.
   */
  idempotencyKey: z.string().min(1).max(256),
})

/** One step of a plan. */
export type PlanStep = z.infer<typeof PlanStepSchema>

/** Statuses from which a plan will do no further work. */
export const TERMINAL_PLAN_STATUSES: readonly PlanStatus[] = ['completed', 'failed', 'cancelled']

/**
 * Whether a plan has finished, however it finished.
 *
 * @param status - The plan's current status.
 * @returns True when no further work will happen on this plan.
 */
export function isTerminalPlanStatus(status: PlanStatus): boolean {
  return TERMINAL_PLAN_STATUSES.includes(status)
}
