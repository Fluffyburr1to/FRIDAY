import {
  type ApprovalRequest,
  type AuthorizationRequest,
  type Explanation,
  err,
  type FridayError,
  type FridayEvent,
  type GuardianDecision,
  type Impact,
  type NewEvent,
  ok,
  type Preview,
  type PrincipalId,
  type Result,
} from '@friday/contracts'
import type { Guardian } from '@friday/guardian'
import type { EventBus } from '@friday/kernel'
import type { ApprovalClerk, ClerkRequestInput } from './approval-clerk.js'

/**
 * Asking the Guardian, and writing down what it said.
 *
 * ★ The Guardian is untouched by this file. It is called, synchronously, and
 * its answer is recorded. It has no bus, no store beyond its own ports, and no
 * knowledge that anything is being written — which is why it stays a pure
 * function of the rules and is exhaustively testable.
 *
 * The one rule that is easy to lose here: **an error is not a decision.** When
 * `authorize` returns a failure — the storage it needed was unreachable — the
 * Guardian did not consult the rules, so nothing is recorded. Writing a
 * `deny` would put a decision in the audit trail that nobody made, and would
 * turn an infrastructure fault into a policy answer. ADR-0027 settled that;
 * this preserves it.
 *
 * Reference: docs/adr/0031-the-clerk-records-what-the-guardian-decided.md
 */

/** Just enough of the decisions store for the clerk to record one. */
export interface DecisionRecorder {
  record(decision: GuardianDecision): Result<void, FridayError>
}

/** What the owner must be told, if this turns out to need them. Chapter 19. */
export interface ApprovalExplanation {
  readonly title: string
  readonly explanation: Explanation
  readonly preview: Preview
  readonly impact: Impact
}

/** What was decided, and everything recorded about it. */
export interface RecordedDecision {
  readonly decision: GuardianDecision

  /** The `guardian.decided` event. Every recorded decision has one. */
  readonly decidedEvent: FridayEvent

  /** The request raised, when the decision was `needs_approval`. */
  readonly approval?: { readonly request: ApprovalRequest; readonly event: FridayEvent }
}

export interface AuthorizingClerk {
  /**
   * Asks the Guardian, records the answer, and raises an approval if the
   * answer was that the owner must be asked.
   *
   * @param input - The authorization question and what to tell the owner.
   * @returns What was decided and what was recorded, or an infrastructure
   *   failure. A refusal is a *decision* and comes back as one.
   */
  authorize(input: {
    request: AuthorizationRequest
    explain: ApprovalExplanation
  }): Promise<Result<RecordedDecision, FridayError>>
}

export interface AuthorizingClerkOptions {
  readonly guardian: Guardian
  readonly clerk: ApprovalClerk
  readonly bus: EventBus
  readonly decisions: DecisionRecorder
}

/**
 * Builds the authorizing half of the clerk.
 *
 * @param options - The Guardian, the settlement clerk, the bus, and the store
 *   decisions are recorded in.
 * @returns A clerk that can answer an authorization question and record it.
 */
export function createAuthorizingClerk(options: AuthorizingClerkOptions): AuthorizingClerk {
  const { guardian, clerk, bus, decisions } = options

  return {
    async authorize({ request, explain }) {
      const decided = guardian.authorize(request)

      // ★ Not a decision. Nothing is recorded, and the caller gets the
      // infrastructure failure rather than a refusal nobody made.
      if (!decided.ok) return err(decided.error)

      const decision = decided.value

      const recorded = await recordDecision({ bus, decisions, decision, request })
      if (!recorded.ok) return err(recorded.error)

      const decidedAt = recorded.value

      if (decision.decision !== 'needs_approval') {
        return ok({ decision, decidedEvent: decidedAt })
      }

      const raised = await clerk.request(toRequest(decision, explain, decidedAt))
      if (!raised.ok) return err(raised.error)

      return ok({
        decision,
        decidedEvent: decidedAt,
        approval: { request: raised.value.request, event: raised.value.event },
      })
    },
  }
}

/**
 * Records the decision and its event in one transaction.
 *
 * The store's own error is carried out in a variable rather than reconstructed
 * from the thrown one, so the caller learns what actually failed instead of
 * being handed the rollback that followed.
 *
 * @param input - The bus, the decision store, the decision, and the question.
 * @returns The recorded event, or why nothing was recorded.
 */
async function recordDecision(input: {
  bus: EventBus
  decisions: DecisionRecorder
  decision: GuardianDecision
  request: AuthorizationRequest
}): Promise<Result<FridayEvent, FridayError>> {
  const { bus, decisions, decision, request } = input

  let failure: FridayError | undefined

  const published = await bus.publish(decidedEvent(decision, request), () => {
    const stored = decisions.record(decision)
    if (stored.ok) return

    failure = stored.error
    throw new Error(stored.error.message)
  })

  if (failure !== undefined) return err(failure)
  if (!published.ok) return err(published.error)

  return ok(published.value)
}

/**
 * Turns a decision that needs the owner into the request to raise.
 *
 * @param decision - What the Guardian decided.
 * @param explain - What the owner must be told.
 * @param decidedAt - The recorded decision event, which becomes the cause.
 * @returns The input for the approval clerk.
 */
function toRequest(
  decision: GuardianDecision,
  explain: ApprovalExplanation,
  decidedAt: FridayEvent,
): ClerkRequestInput {
  return {
    principalId: decision.principalId,
    title: explain.title,
    riskClass: decision.riskClass,
    explanation: explain.explanation,
    preview: explain.preview,
    impact: explain.impact,
    actor: decision.actor,
    action: decision.action,
    resource: decision.resource,
    decisionId: decision.id,

    // ★ The EVENT id, not `decision.id`. Both are UUIDs and both would
    // typecheck; only this one names a row in the log.
    causedByEventId: decidedAt.id,

    ...(decision.planId === null ? {} : { planId: decision.planId }),
    ...(decision.planStepId === null ? {} : { planStepId: decision.planStepId }),
    ...(decision.correlationId === null ? {} : { correlationId: decision.correlationId }),
  }
}

/**
 * The event that records what the Guardian decided.
 *
 * The summary is the Guardian's own sentence, composed at decision time from
 * the rules the owner wrote. Nothing here re-describes it — a second account
 * of the same decision is two accounts that can drift.
 */
function decidedEvent(decision: GuardianDecision, request: AuthorizationRequest): NewEvent {
  return {
    type: 'guardian.decided',
    actor: decision.actor,
    principalId: decision.principalId as PrincipalId,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    payload: {
      decisionId: decision.id,
      decision: decision.decision,
      reason: decision.reason,
      riskClass: decision.riskClass,
      action: decision.action,
      resource: decision.resource,
      actor: decision.actor,
      matchedPolicies: decision.matchedPolicies,
      approvalId: decision.approvalId,
      standingGrantId: decision.standingGrantId,
      summary: decision.summary,
    },
    sensitivity: 'private',
  }
}
