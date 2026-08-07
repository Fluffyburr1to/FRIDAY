import { z } from 'zod'
import { ActorSchema } from './actor.js'
import { ActionSchema, ResourceSchema } from './authorization.js'
import {
  CorrelationIdSchema,
  PlanIdSchema,
  PlanStepIdSchema,
  PrincipalIdSchema,
  UuidSchema,
} from './ids.js'
import { RiskClassSchema } from './plan.js'

/**
 * The question put to the Guardian, and the answer it gives.
 *
 * Nothing else in FRIDAY may produce a `GuardianDecision`. That is the whole
 * content of ADR-0005: two authorities eventually disagree, and the
 * disagreement is the security hole.
 * The shape lives in `contracts` so that callers can *read* a decision without
 * importing the Guardian — which is what keeps everything else from being
 * tempted to compute one.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · Chapter 19
 */

/**
 * The three answers, and the only three.
 *
 * Written lowercase to match every other enum in this package, though the
 * Bible renders them in capitals in prose. `needs_approval` is not a soft
 * denial: it means the action is permitted *once the owner says so*, and the
 * plan suspends rather than fails.
 */
export const DECISIONS = ['allow', 'deny', 'needs_approval'] as const

export const DecisionSchema = z.enum(DECISIONS)

/** What the Guardian concluded. */
export type Decision = z.infer<typeof DecisionSchema>

/**
 * Why the Guardian concluded it — a closed set, for the same reason error
 * codes are closed.
 *
 * These are the machine-readable half of an explanation. The plain-language
 * half is composed from them, and keeping the set closed is what lets that
 * composition be exhaustive rather than falling back on "denied for an
 * unspecified reason", which is the sentence that erodes trust fastest.
 *
 * The capability reasons are deliberately fine-grained. A signature that fails
 * to verify means someone *constructed* a token, which is a different incident
 * from replaying a real one that has expired, and an audit trail that collapses
 * both into `capability_invalid` cannot tell the owner which happened.
 */
export const DECISION_REASONS = [
  // ── Layer 1: authentication ─────────────────────────────────────────────
  'actor_unknown',

  // ── Layer 2: capability ─────────────────────────────────────────────────
  'capability_required',
  'capability_malformed',
  'capability_forged',
  'capability_unknown',
  'capability_expired',
  'capability_revoked',
  'capability_exhausted',
  'capability_scope_mismatch',
  'capability_actor_mismatch',
  'capability_valid',

  // ── Layer 3: policy ─────────────────────────────────────────────────────
  'no_policy_matched',
  'policy_denied',
  'policy_allowed',

  // ── Layer 4: risk and approval ──────────────────────────────────────────
  'approval_required',
  'standing_grant_applied',
  'standing_grant_denied',
  'standing_grant_insufficient',
] as const

export const DecisionReasonSchema = z.enum(DECISION_REASONS)

/** The specific ground for a decision. */
export type DecisionReason = z.infer<typeof DecisionReasonSchema>

const TimestampSchema = z.int().nonnegative()

export const AuthorizationRequestSchema = z.object({
  /** Who is asking. Never "FRIDAY" — always the specific agent or schedule. */
  actor: ActorSchema,

  /** Whose data this concerns. */
  principalId: PrincipalIdSchema,

  action: ActionSchema,
  resource: ResourceSchema,

  /**
   * The capability token authorising this exact step, when one was issued.
   *
   * Optional in the *shape* rather than in the *rules*: policy decides whether
   * a given actor type may act without one. The owner acting directly through
   * the CLI holds no capability and needs none; an agent always does.
   */
  capability: z.string().min(1).max(512).optional(),

  /** The work this request belongs to. Absent for actions outside a plan. */
  planId: PlanIdSchema.optional(),
  planStepId: PlanStepIdSchema.optional(),

  /** Ties the decision to the originating request in the audit trail. */
  correlationId: CorrelationIdSchema.optional(),

  /**
   * Facts about the request that policy may match on — an amount in cents, a
   * recipient domain, whether a dry run was performed.
   *
   * Supplied by the caller and therefore **not trusted to classify risk**.
   * Chapter 19's anti-manipulation rule holds: context may narrow a decision
   * toward stricter, never toward more permissive, and the risk class comes
   * from the policy table regardless of what is in here.
   */
  context: z.record(z.string(), z.unknown()).optional(),
})

/** A question for the Guardian: may this actor do this, to this, right now? */
export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>

export const GuardianDecisionSchema = z.object({
  id: UuidSchema,

  decision: DecisionSchema,
  reason: DecisionReasonSchema,

  /** ★ Never assigned by an agent or a model. Chapter 19's absolute rule. */
  riskClass: RiskClassSchema,

  /**
   * ★ Every policy rule that matched, not only the deciding one.
   *
   * ADR-0025 evaluates the whole set and takes the strictest outcome, so the
   * honest answer to "why?" is usually more than one rule. Recording only the
   * decisive rule would be true and would still mislead the owner about how
   * much of their policy set was engaged.
   */
  matchedPolicies: z.array(z.string().min(1).max(128)).max(64),

  /** Set when the decision was `needs_approval` and a request was raised. */
  approvalId: UuidSchema.nullable(),

  /** Set when a standing grant satisfied what would otherwise have been asked. */
  standingGrantId: UuidSchema.nullable(),

  /** Set when a capability was presented and verified. */
  capabilityId: UuidSchema.nullable(),

  /**
   * One line, for the owner, composed from the reason and the matched rules.
   *
   * Article II: a decision the owner cannot read is not observable. This is
   * generated from recorded fact at decision time, never by asking a model
   * afterwards what it was thinking.
   */
  summary: z.string().min(1).max(1024),

  /** Echoed so a decision is self-contained in the log. */
  actor: ActorSchema,
  principalId: PrincipalIdSchema,
  action: ActionSchema,
  resource: ResourceSchema,
  planId: PlanIdSchema.nullable(),
  planStepId: PlanStepIdSchema.nullable(),
  correlationId: CorrelationIdSchema.nullable(),

  decidedAt: TimestampSchema,
})

/** The Guardian's answer, recorded whole. */
export type GuardianDecision = z.infer<typeof GuardianDecisionSchema>

/**
 * Whether a decision permits the action to proceed now.
 *
 * Exists so callers write `if (!permits(decision))` rather than
 * `if (decision.decision !== 'allow')`. The two are identical today; the helper
 * is what keeps them identical if a fourth decision is ever added, instead of
 * leaving a scatter of comparisons that each have to be found and re-reasoned.
 *
 * @param decision - The Guardian's answer.
 * @returns True only for `allow`. `needs_approval` is not permission.
 */
export function permits(decision: Pick<GuardianDecision, 'decision'>): boolean {
  return decision.decision === 'allow'
}
