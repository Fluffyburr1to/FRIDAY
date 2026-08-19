import { z } from 'zod'
import { ActionSchema, ResourceSchema } from './authorization.js'
import { PlanStepIdSchema } from './ids.js'

/**
 * How an agent invocation ends.
 *
 * ★ There are four outcomes and **`suspended` is the one that shapes the
 * architecture.** Chapter 11: *agents never wait for approval.* If an agent
 * blocked while the owner decided, a worker thread and an expensive model
 * context would be held open for what may be days, and the pressure to add a
 * timeout that proceeds anyway would be constant and eventually granted.
 *
 * Instead the agent returns *"I need this approved to continue"*, the thread
 * is destroyed, and **the plan** waits — as a row, at zero cost. The durability
 * lives in one place, and it is deliberately not the expensive place.
 *
 * `terminated` is the second load-bearing one. It is not a failure mode, it is
 * a response to an agent behaving outside its own declared envelope, and
 * keeping it distinct from `failed` is what lets a diagnostic fire on the
 * difference between "this went wrong" and "this went outside its bounds".
 *
 * Reference: docs/01-bible/11-agent-framework.md
 */

export const AGENT_OUTCOMES = ['completed', 'suspended', 'failed', 'terminated'] as const

export const AgentOutcomeKindSchema = z.enum(AGENT_OUTCOMES)
export type AgentOutcomeKind = z.infer<typeof AgentOutcomeKindSchema>

/**
 * Why an agent was stopped rather than allowed to finish.
 *
 * Every one of these means the agent asked for something outside what it
 * declared, or spent past what it was given. None of them is recoverable by
 * retrying the same invocation unchanged.
 */
export const TERMINATION_REASONS = [
  /** Requested a capability its manifest does not declare. */
  'capability_not_declared',

  /** Requested a connector its manifest does not declare. */
  'connector_not_declared',

  /** ★ Requested an action above its declared risk ceiling. */
  'risk_class_exceeded',

  /** Spent past its token, money, wall-clock, or tool-call ceiling. */
  'budget_exhausted',

  /** Returned output that did not match its schema, twice. */
  'output_invalid',

  /**
   * ★ Sent something the runtime could not read as a request at all.
   *
   * Distinct from `output_invalid`, which is a well-formed agent producing a
   * badly-shaped answer. This is the channel itself being misused — a
   * malformed message, or a request with no action in it. There is no retry:
   * an agent that cannot speak the protocol cannot be asked to try again in
   * it.
   */
  'protocol_violation',
] as const

export const TerminationReasonSchema = z.enum(TERMINATION_REASONS)
export type TerminationReason = z.infer<typeof TerminationReasonSchema>

/** What one invocation actually consumed. Recorded whatever the outcome. */
export const AgentSpendSchema = z.object({
  tokens: z.int().nonnegative(),
  cents: z.int().nonnegative(),
  durationMs: z.int().nonnegative(),
  toolCalls: z.int().nonnegative(),
})

export type AgentSpend = z.infer<typeof AgentSpendSchema>

/**
 * What the agent still needs before it can continue.
 *
 * Carried on a `suspended` outcome so the plan can request approval for the
 * exact action, and so a later invocation can resume with the prior context
 * restored from the plan record rather than from anything the agent kept.
 */
export const AgentSuspensionSchema = z.object({
  action: ActionSchema,
  resource: ResourceSchema,

  /** Which step this belongs to, so the approval attaches to the right one. */
  planStepId: PlanStepIdSchema.optional(),

  /** Plain language, shown on the approval screen. */
  because: z.string().min(1).max(1024),
})

export type AgentSuspension = z.infer<typeof AgentSuspensionSchema>

export const AgentInvocationResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('completed'),
    output: z.unknown(),
    spend: AgentSpendSchema,
  }),
  z.object({
    kind: z.literal('suspended'),
    suspension: AgentSuspensionSchema,
    spend: AgentSpendSchema,
  }),
  z.object({
    kind: z.literal('failed'),
    /** Why, in the owner's language. */
    because: z.string().min(1).max(1024),
    spend: AgentSpendSchema,
  }),
  z.object({
    kind: z.literal('terminated'),
    reason: TerminationReasonSchema,
    because: z.string().min(1).max(1024),
    spend: AgentSpendSchema,
  }),
])

/** How one agent invocation ended, and what it cost. */
export type AgentInvocationResult = z.infer<typeof AgentInvocationResultSchema>

/**
 * Whether an outcome means the agent was stopped for misbehaving.
 *
 * Distinct from failure on purpose: a failed agent may be retried, a
 * terminated one may not be retried unchanged, because whatever made it step
 * outside its envelope is still true.
 *
 * @param result - The invocation outcome.
 * @returns True when the runtime stopped it rather than it ending.
 */
export function wasTerminated(result: AgentInvocationResult): boolean {
  return result.kind === 'terminated'
}
