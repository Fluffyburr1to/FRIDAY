import {
  err,
  type FridayError,
  fridayError,
  type GrantConstraints,
  isGrantLive,
  matchesAction,
  matchesResource,
  ok,
  type Result,
  type RiskClass,
  type StandingGrant,
  StandingGrantSchema,
  uuidv7,
} from '@friday/contracts'
import type { GrantStore } from './grant-store.js'
import { RISK_RANK } from './risk.js'

/**
 * Standing grants in force.
 *
 * The shape enforces Chapter 19's rules about what a grant may *be* — it must
 * expire, it may not wildcard both sides, and it may not cover `critical` or
 * `self_modification`. This file enforces the rules about when one *applies*,
 * which is the half where the mistakes are quieter.
 *
 * The rule that carries the most weight: a grant names the risk class it may
 * satisfy, and it stops applying if the action is later reclassified above it.
 * Reclassifying upward is how the owner tightens things, and a grant that
 * ignored the new class would silently undo the tightening.
 *
 * Reference: docs/01-bible/19-approval-system.md · ADR-0012
 */

/** Why a grant did not cover a request, when one nearly did. */
export type GrantOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'applies'; readonly grant: StandingGrant }
  | { readonly kind: 'denied'; readonly grant: StandingGrant }
  | { readonly kind: 'insufficient'; readonly grant: StandingGrant }

/** What a grant is checked against. */
export interface GrantQuery {
  readonly principalId: string
  readonly action: string
  readonly resource: string
  readonly riskClass: RiskClass

  /** The amount the action would spend, when it spends. */
  readonly amountCents?: number | undefined
}

/** What the owner says when they give standing permission. */
export interface NewGrant {
  readonly principalId: string
  readonly actionPattern: string
  readonly resourcePattern: string
  readonly riskClass: RiskClass
  readonly reason: string
  readonly expiresAt: number
  readonly negative?: boolean | undefined
  readonly maxUses?: number | undefined
  readonly constraints?: Partial<GrantConstraints> | undefined
}

/** Creates, applies, and withdraws standing grants. */
export interface GrantRegistry {
  create(input: NewGrant): Result<StandingGrant, FridayError>

  /**
   * Finds what the owner's standing permissions say about a request.
   *
   * Read-only. Nothing is counted until `use` is called, so the Guardian can
   * ask this question during evaluation without a rejected request consuming
   * somebody's grant.
   */
  find(query: GrantQuery): GrantOutcome

  /** Counts one use against a grant, after the action was actually permitted. */
  use(id: string): Result<StandingGrant, FridayError>

  revoke(id: string, at?: number): Result<StandingGrant, FridayError>

  /** Every grant for a principal, including lapsed ones, for the renewal review. */
  list(principalId: string): readonly StandingGrant[]
}

/**
 * Builds a grant registry.
 *
 * @param options - The store and a clock.
 * @returns A registry.
 */
export function createGrantRegistry(options: {
  store: GrantStore
  now?: () => number
}): GrantRegistry {
  const now = options.now ?? Date.now
  const { store } = options

  return {
    create(input) {
      const createdAt = now()

      const parsed = StandingGrantSchema.safeParse({
        id: uuidv7(createdAt),
        principalId: input.principalId,
        actionPattern: input.actionPattern,
        resourcePattern: input.resourcePattern,
        riskClass: input.riskClass,
        negative: input.negative ?? false,
        constraints: {
          maxAmountCents: input.constraints?.maxAmountCents ?? null,
          maxPerDay: input.constraints?.maxPerDay ?? null,
          timeWindow: input.constraints?.timeWindow ?? null,
          requiresDryRunMatch: input.constraints?.requiresDryRunMatch ?? false,
        },
        reason: input.reason,
        createdAt,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses ?? null,
        uses: 0,
        revokedAt: null,
      })

      if (!parsed.success) {
        return err(
          fridayError({
            code: 'GRANT_INVALID',
            message:
              'That standing permission is not one FRIDAY can hold. ' +
              'Every one has to end, has to name something specific, and can never cover ' +
              'money or FRIDAY changing her own code.',
            detail: { issues: parsed.error.issues },
          }),
        )
      }

      store.put(parsed.data)
      return ok(parsed.data)
    },

    find(query) {
      const at = now()
      const candidates = store
        .listByPrincipal(query.principalId)
        .filter((grant) => isGrantLive(grant, at) && covers(grant, query))

      // A standing denial wins over any permission, and it is checked first.
      // "Never suggest scheduling anything on Fridays" is a boundary, and a
      // boundary that could be outvoted by a permission is not one.
      const denial = candidates.find((grant) => grant.negative)
      if (denial !== undefined) return { kind: 'denied', grant: denial }

      const positives = candidates.filter((grant) => !grant.negative)

      const applies = positives.find(
        (grant) =>
          RISK_RANK[grant.riskClass] >= RISK_RANK[query.riskClass] &&
          withinConstraints(grant, query),
      )
      if (applies !== undefined) return { kind: 'applies', grant: applies }

      // A grant that matched the action and resource but not the class or the
      // limits is reported rather than ignored. "Your permission does not
      // stretch this far" is a different sentence from "you gave no permission",
      // and the owner needs to be able to tell them apart.
      const near = positives[0]
      return near === undefined ? { kind: 'none' } : { kind: 'insufficient', grant: near }
    },

    use(id) {
      const grant = store.get(id)
      if (grant === undefined) {
        return err(
          fridayError({
            code: 'NOT_FOUND',
            message: 'There is no standing permission with that identifier.',
            detail: { grantId: id },
          }),
        )
      }

      const used: StandingGrant = { ...grant, uses: grant.uses + 1 }
      store.replace(used)
      return ok(used)
    },

    revoke(id, at) {
      const grant = store.get(id)
      if (grant === undefined) {
        return err(
          fridayError({
            code: 'NOT_FOUND',
            message: 'There is no standing permission with that identifier to withdraw.',
            detail: { grantId: id },
          }),
        )
      }

      if (grant.revokedAt !== null) return ok(grant)

      const revoked: StandingGrant = { ...grant, revokedAt: at ?? now() }
      store.replace(revoked)
      return ok(revoked)
    },

    list(principalId) {
      return store.listByPrincipal(principalId)
    },
  }
}

/** Whether a grant is about this action on this resource at all. */
function covers(grant: StandingGrant, query: GrantQuery): boolean {
  return (
    matchesAction(grant.actionPattern, query.action) &&
    matchesResource(grant.resourcePattern, query.resource)
  )
}

/**
 * Whether the limits the owner attached to a grant are satisfied.
 *
 * `maxPerDay` and `timeWindow` are deliberately **not** checked here and are
 * not yet enforced anywhere. Both need state this package does not have — a
 * per-day count needs the day's usage history, and a wall-clock window needs
 * the owner's timezone rather than the process's. Enforcing them badly would
 * be worse than not offering them, so a grant carrying either is accepted,
 * stored, and shown, and the limit does nothing until the plan engine at M3
 * supplies what it needs. This is called out in the milestone notes rather
 * than left for someone to discover.
 */
function withinConstraints(grant: StandingGrant, query: GrantQuery): boolean {
  const { maxAmountCents } = grant.constraints
  if (maxAmountCents === null) return true

  // An action that spends without saying how much is not covered by a grant
  // with a spending ceiling. Silence is not zero.
  if (query.amountCents === undefined) return false

  return query.amountCents <= maxAmountCents
}
