import { z } from 'zod'
import { CorrelationIdSchema, PlanIdSchema, PlanStepIdSchema, PrincipalIdSchema } from './ids.js'
import { IntentSchema } from './intent.js'

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
 * ★ These shapes were laid down at M1, ahead of the engine, and were a subset
 * of what Chapter 12 specifies. They were completed at M5 before any Chief of
 * Staff code was written, while the tables were still empty everywhere — see
 * ADR-0045, which records why that window mattered and why it does not reopen.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 11 · Chapter 12 ·
 *            docs/adr/0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md
 */

/**
 * ★ `awaiting_plan_approval` and `awaiting_approval` are different states and
 * must never be merged.
 *
 * `awaiting_plan_approval` — **nothing has run.** The owner is approving the
 * *shape* of the work before it starts. Chapter 12 requires this because a
 * sequence of individually-low-risk steps can be collectively consequential:
 * reading mail is low risk, summarising it is low risk, sending the summary
 * somewhere is where it matters — and by then five steps have already run.
 *
 * `awaiting_approval` — **steps have run** and one of them needs the owner.
 *
 * The dashboard has to be able to tell him which of the two he is looking at,
 * because "may I begin?" and "may I continue?" are not the same question.
 */
export const PLAN_STATUSES = [
  'draft',
  'awaiting_plan_approval',
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
 * What happens when a step fails — decided at planning time, not improvised.
 *
 * Article VII asks for predictable, understandable failure. Deciding the
 * behaviour *before* the failure is how that stops being an aspiration.
 *
 * There is deliberately **no default**. A planner that did not decide has
 * produced an invalid plan, and the friction is the mechanism (ADR-0045 §5).
 */
export const STEP_FAILURE_ACTIONS = ['retry', 'skip', 'abort', 'ask_user', 'alternate'] as const

export const StepFailureActionSchema = z.enum(STEP_FAILURE_ACTIONS)
export type StepFailureAction = z.infer<typeof StepFailureActionSchema>

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

  /**
   * Wall-clock ceiling in milliseconds. Chapter 12's third budget dimension.
   *
   * Nullable because a plan waiting on the owner must not die of old age —
   * Article III's "survive waiting days" is worth more than a deadline, and a
   * deadline that expires an approved-and-waiting plan would silently convert
   * patience into failure.
   */
  budgetDeadlineMs: z.int().nonnegative().nullable(),

  spentTokens: z.int().nonnegative(),
  spentCents: z.int().nonnegative(),
})

export const PlanSchema = z
  .object({
    id: PlanIdSchema,
    principalId: PrincipalIdSchema,

    /**
     * ★ What the owner said, verbatim. Not a paraphrase, and never rewritten.
     *
     * ADR-0045 §1 binds this: the structured `intent` beside it is what routing
     * reads, and this is what an explanation quotes. Dropping either one is a
     * change to that decision, not a simplification of it.
     */
    utterance: z.string().min(1).max(4096),

    /** What FRIDAY understood it to mean. An interpretation, labelled as one. */
    intent: IntentSchema,

    /**
     * Why this decomposition, in plain language, written for someone who does
     * not read code.
     *
     * Required. Chapter 12 shows it to the owner, and a plan that cannot say
     * why it broke the work up this way cannot be approved meaningfully —
     * which would make plan-level approval ceremonial, which is the failure
     * Article III exists against.
     */
    rationale: z.string().min(1).max(4096),

    /**
     * What FRIDAY did, composed on completion from recorded events.
     *
     * ★ A cache of a derivation, never a source. If this disagrees with the
     * events, the events are right — Chapter 12 composes it deterministically
     * (responsibility 5) precisely so it can be recomputed and checked.
     */
    explanation: z.string().max(16_384).nullable(),

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

  /**
   * Position within the plan, from 1. Gapless.
   *
   * ★ **Presentation order only.** Until M5 this was the execution order; it is
   * now `dependsOn` that decides what runs when, and this is what the owner
   * reads down the page. The demotion is written down here because a reader
   * meeting `ORDER BY sequence` would otherwise reasonably conclude it still
   * means what it used to (ADR-0045 §4).
   */
  sequence: z.int().positive(),

  /**
   * ★ The execution order: steps that must finish before this one starts.
   *
   * This is what makes a plan a graph rather than a list, and it is not an
   * optimisation. Chapter 12's own example — "prepare me for Thursday's
   * meeting" — is three independent lookups; sequentially it is three times
   * slower for no reason.
   *
   * Every id must belong to the same plan, and the graph must be acyclic.
   * Both are enforced at plan validation: a cycle is a rejected plan, never a
   * hung executor.
   */
  dependsOn: z.array(PlanStepIdSchema).max(20),

  /**
   * What this step does, in plain language.
   *
   * Required. It is what the owner reads when approving, and a step that
   * cannot describe itself cannot be approved meaningfully.
   */
  description: z.string().min(1).max(1024),

  status: PlanStepStatusSchema,

  /** What this step does, e.g. `calendar.event.create`. */
  actionType: z.string().min(1).max(128),
  actionPayload: z.record(z.string(), z.unknown()),

  /**
   * Which department owns this step.
   *
   * Known at planning time because routing is a deterministic capability
   * lookup (Chapter 12, responsibility 3). `agentId` below stays nullable
   * because *which agent picks it up* is a runtime fact, and these are
   * different questions.
   */
  department: z.string().min(1).max(128),

  /**
   * ★ Assigned by the **Guardian**, never by the planner.
   *
   * The planner proposes an `actionType` and a payload; the Guardian
   * classifies them from a static table. This is a small rule with a large
   * consequence: if the planner assigned risk, a confused or manipulated model
   * could mark a money transfer low-risk. It cannot, because it is not asked.
   *
   * It is restated on the field because a data model is exactly where it would
   * erode — a planner-writable `riskClass` looks harmless in a diff.
   */
  riskClass: RiskClassSchema,

  /** What to do if this step fails. Declared at planning time; no default. */
  onFailure: StepFailureActionSchema,

  /** Set once the Guardian requires approval. */
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

/** Statuses in which a plan is waiting on the owner rather than on itself. */
const AWAITING_STATUSES: readonly PlanStatus[] = ['awaiting_plan_approval', 'awaiting_approval']

/**
 * Whether a plan is blocked on the owner.
 *
 * Both waiting states answer yes, because the dashboard's question — *does
 * this need me?* — does not distinguish them. What needs it is the wording of
 * the ask, and that reads `status` directly.
 *
 * @param status - The plan's current status.
 * @returns True when only the owner can move this plan forward.
 */
export function isAwaitingOwner(status: PlanStatus): boolean {
  return AWAITING_STATUSES.includes(status)
}
