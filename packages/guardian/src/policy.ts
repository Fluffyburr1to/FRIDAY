import {
  ActionPatternSchema,
  ActorTypeSchema,
  isUnboundedScope,
  matchesAction,
  matchesResource,
  ResourcePatternSchema,
  RiskClassSchema,
} from '@friday/contracts'
import { z } from 'zod'

/**
 * A policy rule: declarative data, never code.
 *
 * Chapter 17's argument for this, which is the reason to resist the first
 * instinct to write `if` statements: policies expressed as data can be listed,
 * diffed, explained, and shown to the owner in plain language. When FRIDAY
 * says "I need approval because connector writes require it", she is naming an
 * actual rule they can go read. Policy scattered through conditionals cannot
 * be enumerated, cannot be audited, and cannot be explained truthfully — only
 * plausibly.
 *
 * **This file defines the shape. The rules themselves live in `policies/` and
 * belong to the owner.** FRIDAY's Engineering department may never modify
 * them, which is enforced in CODEOWNERS and in CI. A system that can change
 * the rules governing it is not governed.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · ADR-0025
 */

export const POLICY_EFFECTS = ['allow', 'deny', 'require_approval'] as const

export const PolicyEffectSchema = z.enum(POLICY_EFFECTS)

/** What a rule says should happen to the requests it matches. */
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>

export const PolicyConditionSchema = z
  .object({
    action: ActionPatternSchema.optional(),
    resource: ResourcePatternSchema.optional(),

    /**
     * `user`, `agent`, `system`, `schedule`.
     *
     * The distinction that carries the most weight in practice: the owner
     * acting directly and an agent acting on their behalf are different
     * actors, and a rule that cannot tell them apart either interrupts the
     * owner constantly or lets agents act unattended.
     */
    actorType: ActorTypeSchema.optional(),

    /** An exact actor, when a rule is about one specific agent or schedule. */
    actorId: z.string().min(1).max(256).optional(),
  })
  .refine(
    (condition) => condition.action !== undefined || condition.resource !== undefined,
    'a rule must name an action or a resource, or it matches everything',
  )

/** What a rule matches on. */
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>

export const PolicyExemptionSchema = z.object({
  /**
   * When true, the rule does not apply if a live standing grant covers the
   * request.
   *
   * Chapter 17 writes this as `{ matches: true, notExpired: true }`. Both
   * conditions are folded into one boolean here, because a grant that does not
   * match is not a grant that applies, and an expired one is not a grant at
   * all — carrying them as separate flags would let a policy file be written
   * that honours an expired grant, which nothing should ever be able to say.
   */
  standingGrant: z.boolean().optional(),
})

/** A rule-local escape. Never a global override — see ADR-0025. */
export type PolicyExemption = z.infer<typeof PolicyExemptionSchema>

export const PolicySchema = z
  .object({
    /** Stable, kebab-case, and quoted in explanations. Renaming one is a lie. */
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'policy ids are kebab-case'),

    /**
     * One line, in the owner's language, shown whenever this rule decides
     * something. Required: a rule that cannot be explained cannot be applied.
     */
    description: z.string().min(1).max(512),

    effect: PolicyEffectSchema,

    /**
     * ★ The risk class this rule assigns to what it matches.
     *
     * This is the "static policy table" Chapter 19 refers to. There is no
     * separate table and no model involved: risk arrives only from a rule the
     * owner wrote. A confused or injected model cannot classify a wire
     * transfer as harmless because it is never consulted.
     */
    riskClass: RiskClassSchema,

    when: PolicyConditionSchema,
    unless: PolicyExemptionSchema.optional(),
  })
  .superRefine((policy, ctx) => {
    const action = policy.when.action ?? '*'
    const resource = policy.when.resource ?? '*'

    // Narrowing by actor counts. "Anything the owner does themselves" is a
    // legitimate rule with a wildcard action — Article III governs what FRIDAY
    // does unattended, not what the owner does at the keyboard — so the check
    // is for a rule with no constraint of any kind rather than for a wildcard.
    const constrainedByActor =
      policy.when.actorType !== undefined || policy.when.actorId !== undefined

    // Deny may be unbounded: "refuse everything" is a coherent posture and it
    // is the safe direction. A permissive rule that matches everything is not.
    // It is the single edit that would switch the system off, and writing it
    // should require saying which actions, or for whom.
    if (policy.effect !== 'deny' && !constrainedByActor && isUnboundedScope(action, resource)) {
      ctx.addIssue({
        code: 'custom',
        path: ['when'],
        message: `the ${policy.effect} rule "${policy.id}" matches every action on every resource`,
      })
    }
  })

/** One rule from `policies/`. */
export type Policy = z.infer<typeof PolicySchema>

/**
 * Whether a rule's `when` clause covers a request.
 *
 * Every stated condition must hold; an omitted condition is not a constraint.
 * `when: { action: 'connector.*.write' }` is a statement about the action and
 * says nothing about who is asking.
 *
 * @param policy - The rule being tested.
 * @param request - The action, resource, and actor under consideration.
 * @returns True when the rule applies to this request.
 */
export function policyMatches(
  policy: Policy,
  request: { action: string; resource: string; actorType: string; actorId: string },
): boolean {
  const { when } = policy

  if (when.action !== undefined && !matchesAction(when.action, request.action)) return false
  if (when.resource !== undefined && !matchesResource(when.resource, request.resource)) return false
  if (when.actorType !== undefined && when.actorType !== request.actorType) return false
  if (when.actorId !== undefined && when.actorId !== request.actorId) return false

  return true
}
