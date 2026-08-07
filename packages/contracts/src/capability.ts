import { z } from 'zod'
import { ActorSchema } from './actor.js'
import { ActionSchema, ResourceSchema } from './authorization.js'
import { PlanIdSchema, PlanStepIdSchema, PrincipalIdSchema, UuidSchema } from './ids.js'

/**
 * Capability tokens — a single-use ticket, not an identity.
 *
 * The property the whole design exists for: **an agent captured by prompt
 * injection cannot exceed what its current step required.** It holds a ticket
 * to read one namespace for the next few minutes. That is all it can ever do
 * with that ticket, no matter what it has been talked into believing about
 * itself.
 *
 * A token is an opaque handle, `fct_v1.<id>.<signature>`, carrying no claims —
 * every field below lives in the Guardian's store, which is what makes instant
 * revocation and call budgets possible. That decision, and the self-contained
 * alternative it rejects, is ADR-0026.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md
 */

const TimestampSchema = z.int().nonnegative()

/** The prefix and version marker every token carries. */
export const CAPABILITY_TOKEN_PREFIX = 'fct_v1'

/**
 * `fct_v1.<uuid>.<base64url signature>`.
 *
 * Matched before anything is looked up, so a malformed value is rejected
 * without touching storage — and so a value that never looked like a token is
 * distinguishable in the audit trail from one that did.
 */
export const CAPABILITY_TOKEN_REGEX =
  /^fct_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/

export const CapabilityTokenSchema = z
  .string()
  .regex(CAPABILITY_TOKEN_REGEX, 'capability tokens are fct_v1.<id>.<signature>')

/** The opaque value handed to an agent. */
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>

/**
 * The longest a capability may live: fifteen minutes.
 *
 * Chapter 17 says "minutes, not hours" and does not give a number, so one is
 * fixed here rather than left to each caller — a ceiling that every caller
 * chooses for itself is not a ceiling. Fifteen minutes is long enough for a
 * step that waits on a slow external API and short enough that a leaked token
 * found in a log tomorrow is worthless.
 */
export const MAX_CAPABILITY_LIFETIME_MS = 15 * 60 * 1000

export const CapabilityConstraintsSchema = z.object({
  /**
   * How many times the token may be used. Null means once per issuance is not
   * enforced by count — the expiry is the only bound.
   *
   * Counting is why capabilities are stateful at all: a token that carries its
   * own claims cannot count its own uses.
   */
  maxCalls: z.int().positive().nullable(),

  /** A ceiling on anything the action spends, when it spends. */
  maxAmountCents: z.int().nonnegative().nullable(),
})

/** Limits that travel with a capability. */
export type CapabilityConstraints = z.infer<typeof CapabilityConstraintsSchema>

export const CapabilitySchema = z
  .object({
    id: UuidSchema,
    principalId: PrincipalIdSchema,

    /** ★ The specific actor. `agent:communications/draft-email`, never "FRIDAY". */
    issuedTo: ActorSchema,

    /**
     * ★ The work that justified issuing it.
     *
     * A capability exists because a plan step required it. Recording which step
     * is what makes "why does this agent hold permission to read contacts?"
     * answerable from data.
     */
    planId: PlanIdSchema.nullable(),
    planStepId: PlanStepIdSchema.nullable(),

    /**
     * ★ Exactly one action on exactly one resource. Never a pattern.
     *
     * Patterns belong in policies and standing grants, which are written by the
     * owner. A wildcard capability would restore the ambient authority that
     * ADR-0006 removed, and it would do so at the layer with the least review.
     */
    action: ActionSchema,
    resource: ResourceSchema,

    constraints: CapabilityConstraintsSchema,

    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,

    /** Incremented on every successful verification. */
    uses: z.int().nonnegative(),

    /** Set the instant the owner, or the kernel, withdraws it. */
    revokedAt: TimestampSchema.nullable(),
    revokedReason: z.string().min(1).max(512).nullable(),
  })
  .superRefine((capability, ctx) => {
    if (capability.expiresAt <= capability.issuedAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'a capability must expire after it was issued',
      })
    }

    if (capability.expiresAt - capability.issuedAt > MAX_CAPABILITY_LIFETIME_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'a capability may not live longer than fifteen minutes',
      })
    }

    if (capability.revokedAt === null && capability.revokedReason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['revokedReason'],
        message: 'a capability that was never revoked cannot carry a revocation reason',
      })
    }

    if (
      capability.constraints.maxCalls !== null &&
      capability.uses > capability.constraints.maxCalls
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['uses'],
        message: 'a capability cannot have been used more times than it permits',
      })
    }
  })

/** A capability as it exists in the Guardian's store. */
export type Capability = z.infer<typeof CapabilitySchema>

/**
 * Whether a capability record still has life in it, ignoring scope.
 *
 * Scope matching is a separate question and a separate recorded reason: a token
 * presented for the wrong resource is a *bug or an attack*, while an expired
 * one is ordinary. Collapsing the two would lose that distinction in the audit
 * trail.
 *
 * @param capability - The stored record.
 * @param now - Milliseconds since the epoch.
 * @returns True when the capability is unrevoked, unexpired, and unspent.
 */
export function isCapabilityLive(
  capability: Pick<Capability, 'expiresAt' | 'revokedAt' | 'uses' | 'constraints'>,
  now: number,
): boolean {
  if (capability.revokedAt !== null) return false
  if (now >= capability.expiresAt) return false

  const { maxCalls } = capability.constraints
  if (maxCalls !== null && capability.uses >= maxCalls) return false

  return true
}
