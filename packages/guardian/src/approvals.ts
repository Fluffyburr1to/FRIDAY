import {
  type Actor,
  type ApprovalRequest,
  ApprovalRequestSchema,
  type Explanation,
  err,
  type FridayError,
  fridayError,
  type Impact,
  isTerminalApprovalStatus,
  ok,
  type Preview,
  type RequiredAuth,
  type ResponseSurface,
  type Result,
  type RiskClass,
  uuidv7,
} from '@friday/contracts'
import type { ApprovalStore } from './approval-store.js'

/**
 * Asking the owner, and accepting their answer.
 *
 * Three of Chapter 19's eight "must never happen" properties are enforced
 * here, and each is a single early return that would be easy to delete:
 *
 * - A request with an incomplete explanation is never created.
 * - A `self_modification` is never approved from a phone.
 * - **A timeout is never an approval.** An unanswered request expires, and
 *   expiry is a denial. If the notification system was broken and the owner
 *   never saw it, the action does not happen.
 *
 * Reference: docs/01-bible/19-approval-system.md
 */

/**
 * How long a request waits before it lapses.
 *
 * Chapter 19 requires that requests expire and does not say when, so a number
 * is fixed here. Seven days is chosen against the wrong failure: expiry loses
 * work the owner would have approved, and a request that lapses while they are
 * away for a week is the version of this that teaches them not to rely on it.
 * Short enough that a backlog cannot build; long enough to survive a holiday.
 */
export const DEFAULT_APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/** How recently the owner must have proved it is them. Chapter 17. */
export const STEP_UP_WINDOW_MS = 60_000

/**
 * What a risk class demands of the person answering.
 *
 * Chapter 17's step-up table. `medium` and below need nothing beyond being at
 * an unlocked device; `high` needs a live biometric; `critical` and
 * `self_modification` need a passkey, because an unlocked laptop left
 * unattended for five minutes is the realistic threat and a session
 * established this morning does not answer it.
 *
 * @param riskClass - The class of the action being approved.
 * @returns What the response must carry.
 */
export function requiredAuthFor(riskClass: RiskClass): RequiredAuth {
  if (riskClass === 'low' || riskClass === 'medium') return 'none'
  if (riskClass === 'high') return 'biometric'
  return 'passkey'
}

/** Everything an agent must supply to be allowed to interrupt the owner. */
export interface ApprovalRequestInput {
  readonly principalId: string
  readonly title: string
  readonly riskClass: RiskClass
  readonly explanation: Explanation
  readonly preview: Preview
  readonly impact: Impact
  readonly actor: Actor
  readonly action: string
  readonly resource: string
  readonly decisionId: string
  readonly planId?: string | undefined
  readonly planStepId?: string | undefined
  readonly correlationId?: string | undefined
  readonly lifetimeMs?: number | undefined
}

/** The owner's answer. */
export interface ApprovalResponse {
  readonly approvalId: string
  readonly decision: 'approve' | 'decline'
  readonly via: ResponseSurface
  readonly reason?: string | undefined

  /**
   * When the owner last proved it is them. Required for anything above
   * `medium`, and it must be within the last minute.
   */
  readonly authenticatedAt?: number | undefined
}

/** Raises approval requests and records answers. */
export interface ApprovalRegistry {
  request(input: ApprovalRequestInput): Result<ApprovalRequest, FridayError>

  respond(response: ApprovalResponse): Result<ApprovalRequest, FridayError>

  /**
   * Lapses every request that has run out of time.
   *
   * Called on a timer and at startup. Startup matters: a request that expired
   * while FRIDAY was not running must be settled before anything reads it as
   * still pending.
   */
  sweepExpired(): readonly ApprovalRequest[]

  pending(principalId: string): readonly ApprovalRequest[]

  get(id: string): ApprovalRequest | undefined
}

/**
 * Builds an approval registry.
 *
 * @param options - The store and a clock.
 * @returns A registry.
 */
export function createApprovalRegistry(options: {
  store: ApprovalStore
  now?: () => number
}): ApprovalRegistry {
  const now = options.now ?? Date.now
  const { store } = options

  const registry: ApprovalRegistry = {
    request(input) {
      const createdAt = now()

      const parsed = ApprovalRequestSchema.safeParse({
        id: uuidv7(createdAt),
        principalId: input.principalId,
        title: input.title,
        riskClass: input.riskClass,
        explanation: input.explanation,
        preview: input.preview,
        impact: input.impact,
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        planId: input.planId ?? null,
        planStepId: input.planStepId ?? null,
        correlationId: input.correlationId ?? null,
        decisionId: input.decisionId,
        requiredAuth: requiredAuthFor(input.riskClass),
        createdAt,
        expiresAt: createdAt + (input.lifetimeMs ?? DEFAULT_APPROVAL_LIFETIME_MS),
        status: 'pending',
        respondedAt: null,
        respondedVia: null,
        responseReason: null,
      })

      if (!parsed.success) {
        // Chapter 19: you cannot be asked to approve something FRIDAY cannot
        // explain. An agent that failed to say what it is about to do, why,
        // what could go wrong, and what else it considered fails here, before
        // the owner is interrupted rather than after.
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message:
              'FRIDAY tried to ask you about something she could not fully explain, ' +
              'so she did not ask. Nothing was done.',
            detail: { issues: parsed.error.issues },
          }),
        )
      }

      store.put(parsed.data)
      return ok(parsed.data)
    },

    respond(response) {
      const request = store.get(response.approvalId)
      if (request === undefined) {
        return err(
          fridayError({
            code: 'NOT_FOUND',
            message: 'There is no approval request with that identifier.',
            detail: { approvalId: response.approvalId },
          }),
        )
      }

      if (isTerminalApprovalStatus(request.status)) {
        return err(
          fridayError({
            code: 'APPROVAL_ALREADY_RESOLVED',
            message: `That request was already ${request.status}.`,
            detail: { approvalId: request.id, status: request.status },
          }),
        )
      }

      const at = now()

      // Checked before the answer is accepted, not after. A "yes" that arrives
      // a second after the deadline is a denial, and treating it as an
      // approval would make the deadline advisory.
      if (at >= request.expiresAt) {
        const expired = settle(request, 'expired', at, null, null)
        store.replace(expired)

        return err(
          fridayError({
            code: 'APPROVAL_REQUIRED',
            message: 'That request ran out of time before it was answered, so nothing was done.',
            detail: { approvalId: request.id },
          }),
        )
      }

      const refusal = checkSurfaceAndAuth(request, response, at)
      if (refusal !== null) return err(refusal)

      const settled = settle(
        request,
        response.decision === 'approve' ? 'approved' : 'declined',
        at,
        response.via,
        response.reason ?? null,
      )

      store.replace(settled)
      return ok(settled)
    },

    sweepExpired() {
      const at = now()
      const lapsed: ApprovalRequest[] = []

      for (const request of store.listPending()) {
        if (at < request.expiresAt) continue

        const expired = settle(request, 'expired', at, null, null)
        store.replace(expired)
        lapsed.push(expired)
      }

      return lapsed
    },

    pending(principalId) {
      return store.listPending(principalId)
    },

    get(id) {
      return store.get(id)
    },
  }

  return registry
}

/**
 * The two rules about *how* an answer arrived.
 *
 * Split out so each reads as the single sentence it is. Both are enforced in
 * code rather than in policy, because Chapter 19 says so — a policy file the
 * owner could edit is the wrong place for "approving a code change on a phone
 * is not review".
 */
function checkSurfaceAndAuth(
  request: ApprovalRequest,
  response: ApprovalResponse,
  at: number,
): FridayError | null {
  if (request.riskClass === 'self_modification' && response.via === 'mobile') {
    return fridayError({
      code: 'SURFACE_NOT_PERMITTED',
      message:
        'Changes to FRIDAY’s own code are approved on a computer, where you can read the ' +
        'whole change. Approving one on a phone is not review.',
      detail: { approvalId: request.id, via: response.via },
    })
  }

  if (request.requiredAuth === 'none') return null

  if (response.authenticatedAt === undefined || at - response.authenticatedAt > STEP_UP_WINDOW_MS) {
    return fridayError({
      code: 'STEP_UP_REQUIRED',
      message:
        'This one needs you to prove it is you right now, not that you unlocked ' +
        'this device earlier.',
      detail: { approvalId: request.id, requiredAuth: request.requiredAuth },
    })
  }

  return null
}

/** Applies a terminal status and the fields that must accompany it. */
function settle(
  request: ApprovalRequest,
  status: 'approved' | 'declined' | 'expired',
  at: number,
  via: ResponseSurface | null,
  reason: string | null,
): ApprovalRequest {
  return { ...request, status, respondedAt: at, respondedVia: via, responseReason: reason }
}
