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

  verify(presentation: CapabilityPresentation): Result<Capability, CapabilityRejection>

  revoke(id: string, reason: string): Result<Capability, FridayError>

  /** Withdraws every capability a plan was holding. Returns how many. */
  revokeForPlan(planId: string, reason: string): number
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
      store.put(capability)

      return ok({
        token: `${CAPABILITY_TOKEN_PREFIX}.${capability.id}.${sign(capability.id)}`,
        capability,
      })
    },

    verify(presentation) {
      const found = resolve(presentation.token, sign, store)
      if (!found.ok) return found

      const capability = found.value

      // Ordering is deliberate, and it is about the audit trail rather than
      // about speed. Identity and scope are checked BEFORE expiry, so a token
      // replayed against the wrong resource is recorded as a scope mismatch
      // even if it had also expired. The reverse order would let a real attack
      // be filed as an ordinary lapsed permission.
      if (capability.issuedTo.id !== presentation.actor.id) {
        return err(
          reject('capability_actor_mismatch', 'A permission was presented by someone else.', {
            capabilityId: capability.id,
          }),
        )
      }

      if (
        capability.action !== presentation.action ||
        capability.resource !== presentation.resource
      ) {
        return err(
          reject(
            'capability_scope_mismatch',
            'A permission was used for something other than what it was issued for.',
            { capabilityId: capability.id, issuedFor: capability.action },
          ),
        )
      }

      if (capability.revokedAt !== null) {
        return err(
          reject('capability_revoked', 'That permission was withdrawn.', {
            capabilityId: capability.id,
          }),
        )
      }

      if (now() >= capability.expiresAt) {
        return err(
          reject('capability_expired', 'That permission has expired.', {
            capabilityId: capability.id,
          }),
        )
      }

      const { maxCalls } = capability.constraints
      if (maxCalls !== null && capability.uses >= maxCalls) {
        return err(
          reject('capability_exhausted', 'That permission has already been used up.', {
            capabilityId: capability.id,
            maxCalls,
          }),
        )
      }

      const used: Capability = { ...capability, uses: capability.uses + 1 }
      store.replace(used)

      return ok(used)
    },

    revoke(id, reason) {
      const capability = store.get(id)
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
      store.replace(revoked)

      return ok(revoked)
    },

    revokeForPlan(planId, reason) {
      const at = now()
      let count = 0

      for (const capability of store.listByPlan(planId)) {
        if (capability.revokedAt !== null) continue
        store.replace({ ...capability, revokedAt: at, revokedReason: reason })
        count += 1
      }

      return count
    },
  })
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
): Result<Capability, CapabilityRejection> {
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

  const capability = store.get(id)
  if (capability === undefined) {
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
    reason,
    error: fridayError({ code: 'CAPABILITY_INVALID', message, ...(detail ? { detail } : {}) }),
  }
}
