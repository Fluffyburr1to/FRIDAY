import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  type Actor,
  CAPABILITY_TOKEN_PREFIX,
  CAPABILITY_TOKEN_REGEX,
  type Capability,
  type CapabilityConstraints,
  CapabilitySchema,
  type DecisionReason,
  err,
  type FridayError,
  fridayError,
  MAX_CAPABILITY_LIFETIME_MS,
  ok,
  type Result,
  uuidv7,
} from '@friday/contracts'
import type { CapabilityStore } from './capability-store.js'

/**
 * Issuing and verifying capability tokens.
 *
 * A token is `fct_v1.<id>.<signature>` and carries nothing else. Every claim
 * lives in the store, which is what makes revocation instant and call budgets
 * enforceable — ADR-0026, and the reason Chapter 17 rejects JWTs.
 *
 * The signature is defence in depth, not the primary control. **The store
 * lookup is the real gate.** That is written down here so nobody later
 * optimises the lookup away and leaves an HMAC holding the whole system up.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md
 */

/** The Keychain entry the signing key lives under. */
export const CAPABILITY_KEY_REFERENCE = 'capability-signing-key'

/** Default life of a capability. Well inside the fifteen-minute ceiling. */
export const DEFAULT_CAPABILITY_LIFETIME_MS = 5 * 60 * 1000

/**
 * Where the signing key comes from.
 *
 * Structurally identical to `packages/storage`'s `KeyProvider`, and declared
 * here rather than imported so the Guardian does not depend on the storage
 * package. The same provider instance satisfies both.
 */
export interface CapabilityKeyProvider {
  getKey(reference: string): Result<Buffer, FridayError>
}

/** Why a token was refused, in a form the Guardian records verbatim. */
export interface CapabilityRejection {
  readonly kind: 'rejected'
  readonly reason: Extract<
    DecisionReason,
    | 'capability_actor_mismatch'
    | 'capability_exhausted'
    | 'capability_expired'
    | 'capability_forged'
    | 'capability_malformed'
    | 'capability_revoked'
    | 'capability_scope_mismatch'
    | 'capability_unknown'
  >
  readonly error: FridayError
}

/**
 * The Guardian could not tell whether a token is valid.
 *
 * ★ Not a rejection. "This token is not valid" and "I could not tell" are
 * different answers, and only the first belongs in a decision record — a
 * storage failure recorded as a refusal would look, forever after, like the
 * owner's rules having refused something they were never consulted about.
 *
 * See ADR-0027.
 */
export interface CapabilityUnavailable {
  readonly kind: 'unavailable'
  readonly error: FridayError
}

/** Either the token is bad, or the Guardian could not reach its own records. */
export type CapabilityFailure = CapabilityRejection | CapabilityUnavailable

/** What a caller must say to be issued a capability. */
export interface CapabilityRequest {
  readonly principalId: string
  readonly issuedTo: Actor
  readonly action: string
  readonly resource: string
  readonly planId?: string | undefined
  readonly planStepId?: string | undefined
  readonly constraints?: Partial<CapabilityConstraints> | undefined

  /** Capped at fifteen minutes regardless of what is asked for. */
  readonly lifetimeMs?: number | undefined
}

/** What a caller presents when it wants to act. */
export interface CapabilityPresentation {
  readonly token: string
  readonly actor: Actor
  readonly action: string
  readonly resource: string
}

/** Issues, verifies, and withdraws capabilities. */
export interface CapabilityIssuer {
  issue(
    request: CapabilityRequest,
  ): Result<{ readonly token: string; readonly capability: Capability }, FridayError>

  verify(presentation: CapabilityPresentation): Result<Capability, CapabilityFailure>

  revoke(id: string, reason: string): Result<Capability, FridayError>

  /** Withdraws every capability a plan was holding. Returns how many. */
  revokeForPlan(planId: string, reason: string): Result<number, FridayError>
}

/**
 * Builds an issuer.
 *
 * @param options - The store, the key provider, and a clock.
 * @returns An issuer, or the reason the signing key could not be read.
 */
export function createCapabilityIssuer(options: {
  store: CapabilityStore
  keys: CapabilityKeyProvider
  now?: () => number
}): Result<CapabilityIssuer, FridayError> {
  // Read once, at construction. A key that cannot be read is a condition
  // FRIDAY reports at startup rather than discovering on the first action she
  // was about to take.
  const key = options.keys.getKey(CAPABILITY_KEY_REFERENCE)
  if (!key.ok) return err(key.error)

  const signingKey = key.value
  const now = options.now ?? Date.now
  const { store } = options

  const sign = (id: string): string =>
    createHmac('sha256', signingKey).update(`${CAPABILITY_TOKEN_PREFIX}.${id}`).digest('base64url')

  return ok({
    issue(request) {
      const issuedAt = now()
      const lifetime = Math.min(
        request.lifetimeMs ?? DEFAULT_CAPABILITY_LIFETIME_MS,
        MAX_CAPABILITY_LIFETIME_MS,
      )

      const parsed = CapabilitySchema.safeParse({
        id: uuidv7(issuedAt),
        principalId: request.principalId,
        issuedTo: request.issuedTo,
        planId: request.planId ?? null,
        planStepId: request.planStepId ?? null,
        action: request.action,
        resource: request.resource,
        constraints: {
          maxCalls: request.constraints?.maxCalls ?? null,
          maxAmountCents: request.constraints?.maxAmountCents ?? null,
        },
        issuedAt,
        expiresAt: issuedAt + lifetime,
        uses: 0,
        revokedAt: null,
        revokedReason: null,
      })

      if (!parsed.success) {
        return err(
          fridayError({
            code: 'CAPABILITY_INVALID',
            message: 'FRIDAY tried to issue a permission that does not describe one thing clearly.',
            detail: { issues: parsed.error.issues },
          }),
        )
      }

      const capability = parsed.data

      const written = store.put(capability)
      if (!written.ok) return err(written.error)

      return ok({
        token: `${CAPABILITY_TOKEN_PREFIX}.${capability.id}.${sign(capability.id)}`,
        capability,
      })
    },

    verify(presentation) {
      const found = resolve(presentation.token, sign, store)
      if (!found.ok) return found

      const capability = found.value

      const refusal = checkUsable(capability, presentation, now())
      if (refusal !== null) return err(refusal)

      const used: Capability = { ...capability, uses: capability.uses + 1 }

      // A use that could not be counted must not be treated as permitted. A
      // token with a budget of five that silently never counts is a token with
      // no budget at all.
      const counted = store.replace(used)
      if (!counted.ok) return err(unavailable(counted.error))

      return ok(used)
    },

    revoke(id, reason) {
      const found = store.get(id)
      if (!found.ok) return err(found.error)

      const capability = found.value
      if (capability === undefined) {
        return err(
          fridayError({
            code: 'NOT_FOUND',
            message: 'There is no permission with that identifier to withdraw.',
            detail: { capabilityId: id },
          }),
        )
      }

      // Revoking an already-revoked capability keeps the first revocation. The
      // original reason and time are what the audit trail needs; overwriting
      // them with a later sweep would lose why it was withdrawn.
      if (capability.revokedAt !== null) return ok(capability)

      const revoked: Capability = { ...capability, revokedAt: now(), revokedReason: reason }

      const written = store.replace(revoked)
      if (!written.ok) return err(written.error)

      return ok(revoked)
    },

    revokeForPlan(planId, reason) {
      const held = store.listByPlan(planId)
      if (!held.ok) return err(held.error)

      const at = now()
      let count = 0

      for (const capability of held.value) {
        if (capability.revokedAt !== null) continue

        const written = store.replace({ ...capability, revokedAt: at, revokedReason: reason })
        if (!written.ok) return err(written.error)

        count += 1
      }

      return ok(count)
    },
  })
}

/**
 * Every reason a real, findable capability still may not be used.
 *
 * Ordering is deliberate, and it is about the audit trail rather than about
 * speed. Identity and scope are checked BEFORE expiry, so a token replayed
 * against the wrong resource is recorded as a scope mismatch even if it had
 * also expired. The reverse order would let a real attack be filed as an
 * ordinary lapsed permission.
 *
 * @param capability - The stored record.
 * @param presentation - What it is being presented for.
 * @param at - Milliseconds since the epoch.
 * @returns The rejection, or null when the capability may be used.
 */
function checkUsable(
  capability: Capability,
  presentation: CapabilityPresentation,
  at: number,
): CapabilityRejection | null {
  if (capability.issuedTo.id !== presentation.actor.id) {
    return reject('capability_actor_mismatch', 'A permission was presented by someone else.', {
      capabilityId: capability.id,
    })
  }

  if (capability.action !== presentation.action || capability.resource !== presentation.resource) {
    return reject(
      'capability_scope_mismatch',
      'A permission was used for something other than what it was issued for.',
      { capabilityId: capability.id, issuedFor: capability.action },
    )
  }

  if (capability.revokedAt !== null) {
    return reject('capability_revoked', 'That permission was withdrawn.', {
      capabilityId: capability.id,
    })
  }

  if (at >= capability.expiresAt) {
    return reject('capability_expired', 'That permission has expired.', {
      capabilityId: capability.id,
    })
  }

  const { maxCalls } = capability.constraints
  if (maxCalls !== null && capability.uses >= maxCalls) {
    return reject('capability_exhausted', 'That permission has already been used up.', {
      capabilityId: capability.id,
      maxCalls,
    })
  }

  return null
}

/**
 * Turns a token value into the record it points at.
 *
 * Split out because the three ways this can fail — it never looked like a
 * token, it was constructed by someone without the key, it names nothing —
 * are three different incidents, and the caller records them separately.
 */
function resolve(
  token: string,
  sign: (id: string) => string,
  store: CapabilityStore,
): Result<Capability, CapabilityFailure> {
  if (!CAPABILITY_TOKEN_REGEX.test(token)) {
    return err(reject('capability_malformed', 'That is not a permission slip FRIDAY issued.'))
  }

  const [, id = '', signature = ''] = token.split('.')
  const expected = sign(id)

  // Lengths are equal by construction — the pattern above fixes the signature
  // at 43 base64url characters — so this is a genuine constant-time compare
  // rather than one that leaks through a length check.
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return err(
      reject('capability_forged', 'A permission slip was presented that FRIDAY did not issue.', {
        capabilityId: id,
      }),
    )
  }

  const found = store.get(id)
  if (!found.ok) return err(unavailable(found.error))

  const capability = found.value
  if (capability === undefined) {
    // Deliberately distinct from the unavailable branch above. A lookup that
    // finds nothing is close to an alarm — a token nobody issued — and one
    // that could not run at all is an operational fault. Conflating them would
    // hide an attack behind a disk problem.
    return err(
      reject('capability_unknown', 'That permission is not one FRIDAY has a record of.', {
        capabilityId: id,
      }),
    )
  }

  return ok(capability)
}

/**
 * Builds a rejection.
 *
 * The token value is never placed in the error. A refused token is still a
 * credential until it expires, and an error object ends up in a log line.
 */
function reject(
  reason: CapabilityRejection['reason'],
  message: string,
  detail?: Record<string, unknown>,
): CapabilityRejection {
  return {
    kind: 'rejected',
    reason,
    error: fridayError({ code: 'CAPABILITY_INVALID', message, ...(detail ? { detail } : {}) }),
  }
}

/** Wraps a storage failure as an inability to decide, never as a refusal. */
function unavailable(error: FridayError): CapabilityUnavailable {
  return { kind: 'unavailable', error }
}
