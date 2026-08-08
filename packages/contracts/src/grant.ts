import { z } from 'zod'
import { ActionPatternSchema, isUnboundedScope, ResourcePatternSchema } from './authorization.js'
import { PrincipalIdSchema, UuidSchema } from './ids.js'
import { type RiskClass, RiskClassSchema } from './plan.js'

/**
 * Standing grants — Article III's own escape clause, heavily constrained.
 *
 * *"...unless the user has intentionally granted permission in advance."* This
 * is the mechanism that makes strict approval livable, and it is also the one
 * most likely to erode the whole system if designed carelessly. Chapter 19
 * gives five rules; four of them are enforced by this file and the fifth
 * (grants are reviewed rather than auto-renewed) belongs to the workflow.
 *
 * A grant may also be **negative** — a standing denial. "Never suggest
 * scheduling anything on Fridays" is a boundary, and a system that cannot
 * record boundaries will keep asking. Article IX.
 *
 * Reference: docs/01-bible/19-approval-system.md · ADR-0012
 */

const TimestampSchema = z.int().nonnegative()

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * ★ How long a grant may live, by the risk class it covers.
 *
 * Chapter 19: `medium` 90 days, `high` 30 days, `critical` never fully
 * granted. `low` actions are auto-approved and never need a grant, so a grant
 * covering one is a mistake rather than a permission.
 *
 * **`self_modification` is not grantable, and the Bible does not say so.**
 * Chapter 19's lifetime table names only the other classes. The strict reading
 * is taken deliberately: a standing grant covering `self_modification` would
 * mean FRIDAY merging her own changes without being asked, which ADR-0014
 * forbids in as many words. Being stricter than the Bible is reversible with
 * one line here; being more permissive would have to be discovered.
 */
export const GRANT_MAX_LIFETIME_MS: Readonly<Record<RiskClass, number | null>> = {
  low: null,
  medium: 90 * DAY_MS,
  high: 30 * DAY_MS,
  critical: null,
  self_modification: null,
}

/**
 * Whether a risk class can be covered by a standing grant at all.
 *
 * @param riskClass - The class the grant would cover.
 * @returns True when a grant of that class may exist.
 */
export function isGrantableRiskClass(riskClass: RiskClass): boolean {
  return GRANT_MAX_LIFETIME_MS[riskClass] !== null
}

export const GrantConstraintsSchema = z.object({
  /** A ceiling on money. Null means the grant covers nothing that spends. */
  maxAmountCents: z.int().nonnegative().nullable(),

  /** How many times a day the grant may apply. Null means uncapped. */
  maxPerDay: z.int().positive().nullable(),

  /**
   * Local wall-clock window, `HH:MM-HH:MM`, in which the grant applies.
   *
   * "You may post to the team channel during working hours" is a narrower and
   * more honest permission than "you may post to the team channel".
   */
  timeWindow: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'time windows are HH:MM-HH:MM')
    .nullable(),

  /**
   * Whether the action's dry run must match what was approved before the grant
   * applies. Set for anything where the artifact is the thing being consented
   * to, such as a recurring message.
   */
  requiresDryRunMatch: z.boolean(),
})

/** Limits that narrow what a grant covers. */
export type GrantConstraints = z.infer<typeof GrantConstraintsSchema>

export const StandingGrantSchema = z
  .object({
    id: UuidSchema,
    principalId: PrincipalIdSchema,

    actionPattern: ActionPatternSchema,
    resourcePattern: ResourcePatternSchema,

    /**
     * The highest risk class this grant may satisfy.
     *
     * A grant is written against a class, not merely against a pattern, so
     * that an action later reclassified upward stops being covered rather than
     * silently continuing to be. Reclassification is how the owner tightens
     * things, and a grant that ignored it would quietly undo the tightening.
     */
    riskClass: RiskClassSchema,

    /** True for a standing denial: never ask again, and never do it. */
    negative: z.boolean(),

    constraints: GrantConstraintsSchema,

    /** Plain language, in the owner's terms, shown when the grant is applied. */
    reason: z.string().min(1).max(1024),

    createdAt: TimestampSchema,

    /** ★ MANDATORY. No perpetual grants exist. ADR-0012. */
    expiresAt: TimestampSchema,

    maxUses: z.int().positive().nullable(),
    uses: z.int().nonnegative(),

    revokedAt: TimestampSchema.nullable(),
  })
  .superRefine((grant, ctx) => {
    if (grant.expiresAt <= grant.createdAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'a standing grant must expire after it was created',
      })
    }

    // Rule 2: "FRIDAY can do anything" is not a grant, it is an abdication.
    // A negative grant is exempt: "never do anything without asking" is a
    // coherent boundary, and it errs in the safe direction.
    if (!grant.negative && isUnboundedScope(grant.actionPattern, grant.resourcePattern)) {
      ctx.addIssue({
        code: 'custom',
        path: ['actionPattern'],
        message: 'a grant cannot use * for both the action and the resource',
      })
    }

    // Rule 1, and Chapter 19's first absolute rule. A negative grant may cover
    // any class — refusing to pre-authorise something is never the dangerous
    // direction.
    const maxLifetime = GRANT_MAX_LIFETIME_MS[grant.riskClass]

    if (!grant.negative && maxLifetime === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['riskClass'],
        message: `${grant.riskClass} actions cannot be covered by a standing grant`,
      })
    }

    if (
      !grant.negative &&
      maxLifetime !== null &&
      grant.expiresAt - grant.createdAt > maxLifetime
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: `a ${grant.riskClass} grant may not last longer than ${maxLifetime / DAY_MS} days`,
      })
    }

    if (grant.maxUses !== null && grant.uses > grant.maxUses) {
      ctx.addIssue({
        code: 'custom',
        path: ['uses'],
        message: 'a grant cannot have been used more times than it permits',
      })
    }
  })

/** Permission the owner gave in advance, with an end date they chose. */
export type StandingGrant = z.infer<typeof StandingGrantSchema>

/**
 * Whether a grant is still in force, ignoring what it covers.
 *
 * Scope and constraint checks are separate and produce separate recorded
 * reasons, so that "your grant expired" and "your grant does not cover this"
 * are never confused in an explanation.
 *
 * @param grant - The stored record.
 * @param now - Milliseconds since the epoch.
 * @returns True when the grant is unrevoked, unexpired, and unspent.
 */
export function isGrantLive(
  grant: Pick<StandingGrant, 'expiresAt' | 'revokedAt' | 'uses' | 'maxUses'>,
  now: number,
): boolean {
  if (grant.revokedAt !== null) return false
  if (now >= grant.expiresAt) return false
  if (grant.maxUses !== null && grant.uses >= grant.maxUses) return false

  return true
}
