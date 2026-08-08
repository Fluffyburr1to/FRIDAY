import {
  type ApprovalRequest,
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  type NewEvent,
  ok,
  type PrincipalId,
  type Result,
} from '@friday/contracts'
import {
  type ApprovalRegistry,
  type ApprovalRequestInput,
  type ApprovalResponse,
  type ApprovalStore,
  createApprovalRegistry,
} from '@friday/guardian'
import type { EventBus } from '@friday/kernel'
import { type CapturedWrite, deferWrites } from './deferred-store.js'

/**
 * Raising approvals and settling them, in the event log and in the record, at
 * once.
 *
 * ★ This half of the clerk needs no Guardian. Chapter 19's rules about an
 * *answer* — has it expired, may this surface answer it, was step-up proved —
 * live in `ApprovalRegistry`, not in `Guardian.authorize`. A consumer that
 * only settles approvals therefore composes this and nothing else, which is
 * what keeps `apps/core` from having to build a policy engine, a capability
 * signer, and a keychain entry it never uses.
 *
 * What it does not do: decide anything. Every rule applied here is applied by
 * the registry. The clerk chooses which event describes the outcome, and that
 * is transcription, not policy.
 *
 * Reference: docs/adr/0031-the-clerk-records-what-the-guardian-decided.md
 */

/** Everything needed to raise a request, plus the event that caused it. */
export interface ClerkRequestInput extends ApprovalRequestInput {
  /**
   * ★ The `guardian.decided` EVENT id — not the decision id.
   *
   * This becomes the `causationId` of `approval.requested`, so it must name a
   * row in the event log. `ApprovalRequestInput.decisionId` names a Guardian
   * decision and would silently orphan the chain if used here.
   */
  readonly causedByEventId: string
}

/** A request, and the event that recorded it. */
export interface RecordedRequest {
  readonly request: ApprovalRequest
  readonly event: FridayEvent
}

/** A settled request, and the event that recorded the answer. */
export interface RecordedResponse {
  readonly request: ApprovalRequest
  readonly event: FridayEvent
}

export interface ApprovalClerk {
  /**
   * Raises a request and records that FRIDAY asked.
   *
   * @param input - The request, and the decision event that caused it.
   * @returns The stored request with its `requestedEventId` filled in.
   */
  request(input: ClerkRequestInput): Promise<Result<RecordedRequest, FridayError>>

  /**
   * Records the owner's answer.
   *
   * @param response - The answer, and the surface it arrived on.
   * @returns The settled request, or why the answer was refused.
   */
  respond(response: ApprovalResponse): Promise<Result<RecordedResponse, FridayError>>

  pending(principalId: string): Result<readonly ApprovalRequest[], FridayError>

  get(id: string): Result<ApprovalRequest | undefined, FridayError>

  /**
   * Lapses every request that has run out of time, recording each one.
   *
   * ★ Each lapse is its own transaction: one `approval.expired` event and one
   * state change, together or not at all. Per-approval rather than per-sweep,
   * because they are independent facts — one that could not be recorded must
   * not undo one that was.
   *
   * A failure stops the sweep and is reported. Whatever lapsed before it is
   * durable and correctly recorded, and the next sweep finds what is left,
   * because an expired request is no longer pending. That is resumption by
   * construction rather than a retry.
   *
   * @returns Every request that lapsed *and was recorded*, oldest first.
   */
  sweepExpired(): Promise<Result<readonly ApprovalRequest[], FridayError>>
}

export interface ApprovalClerkOptions {
  /** The real store. The clerk keeps it; the registry never sees it. */
  readonly approvals: ApprovalStore

  readonly bus: EventBus

  readonly now?: (() => number) | undefined
}

/**
 * Builds the settlement half of the clerk.
 *
 * @param options - The approval store, the bus, and a clock.
 * @returns A clerk that can raise and settle approvals.
 */
export function createApprovalClerk(options: ApprovalClerkOptions): ApprovalClerk {
  const { approvals, bus } = options

  // ★ The registry is built here rather than injected, and it is given the
  // deferring store. That is the guarantee: there is no way to hold this clerk
  // and also hold a registry whose writes escape the transaction, because the
  // only registry involved is this one.
  const deferred = deferWrites(approvals)
  const registry: ApprovalRegistry = createApprovalRegistry({
    store: deferred.store,
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  return {
    async request(input) {
      const { causedByEventId, ...raise } = input

      const raised = registry.request(raise)
      if (!raised.ok) return err(raised.error)

      // Taken synchronously, before anything is awaited, so the captured write
      // is a local value rather than shared state during the publish.
      const captured = only(deferred.take(), 'raise an approval request')
      const request = raised.value

      const recorded = await record(bus, requestedEvent(request, causedByEventId), (written) =>
        // ★ The event id does not exist until this moment. This is the only
        // place it can be written into the record it belongs to.
        approvals.put({ ...captured.request, requestedEventId: written.id }),
      )

      if (!recorded.ok) return err(recorded.error)

      return ok({
        request: { ...request, requestedEventId: recorded.value.id },
        event: recorded.value,
      })
    },

    async respond(response) {
      const settled = registry.respond(response)
      const captured = deferred.take()

      if (!settled.ok) {
        // The registry refused the answer. One refusal — answering after the
        // deadline — settles the request as `expired` on the way out, and that
        // lapse is a real state change that must be recorded like any other.
        //
        // ★ The recording failure wins over the refusal if it happens. Both
        // are true — the answer was late *and* nothing could be written — but
        // only one of them is a fault the owner can do something about, and
        // swallowing it would hide a broken log behind a routine "too late".
        // The request simply stays pending and the next sweep finds it.
        const lapse = await recordLapse(bus, approvals, captured)
        if (!lapse.ok) return err(lapse.error)

        return err(settled.error)
      }

      const request = settled.value
      const write = only(captured, 'settle an approval request')

      // ★ The answer's cause is the event that recorded the question. Without
      // it the grant would be an orphan in the causal chain, and an approval
      // nobody can trace to a request explains nothing.
      if (request.requestedEventId === null) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message:
              'That approval has no record of ever being asked, so answering it ' +
              'could not be recorded truthfully. Nothing was done.',
            detail: { approvalId: request.id },
          }),
        )
      }

      const recorded = await record(bus, settledEvent(request), () =>
        approvals.replace(write.request),
      )

      if (!recorded.ok) return err(recorded.error)

      return ok({ request, event: recorded.value })
    },

    async sweepExpired() {
      const lapsed = registry.sweepExpired()

      // Taken synchronously, before the first await, for the same reason as
      // everywhere else in this file: the captures become local values rather
      // than shared state spanning a publish.
      const captured = deferred.take()

      // A failed read means nothing was settled and nothing was captured.
      if (!lapsed.ok) return err(lapsed.error)

      const recorded = await recordLapse(bus, approvals, captured)
      if (!recorded.ok) return err(recorded.error)

      return ok(recorded.value)
    },

    pending(principalId) {
      return approvals.listPending(principalId)
    },

    get(id) {
      return approvals.get(id)
    },
  }
}

/**
 * Publishes an event and performs a state write inside its transaction.
 *
 * ★ The whole consistency guarantee is these fifteen lines. The write runs
 * inside the append transaction; if it fails it throws, the append rolls back,
 * and neither the event nor the state change happened. The failure is carried
 * out in a variable rather than reconstructed from the thrown error, so the
 * caller gets the store's own typed reason instead of a wrapper.
 *
 * There is no retry and no repair, deliberately: a write that did not happen
 * is reported as not having happened.
 *
 * @param bus - The event bus.
 * @param event - The event to record.
 * @param write - The state change belonging to it.
 * @returns The recorded event, or why nothing was recorded.
 */
async function record(
  bus: EventBus,
  event: NewEvent,
  write: (written: FridayEvent) => Result<void, FridayError>,
): Promise<Result<FridayEvent, FridayError>> {
  let failure: FridayError | undefined

  const published = await bus.publish(event, (written) => {
    const result = write(written)
    if (result.ok) return

    failure = result.error

    // Rolls the append back. The message is for the log; the caller is given
    // `failure`, which is the store's own error.
    throw new Error(result.error.message)
  })

  // Checked first: a state write that failed is a more specific truth than the
  // rollback it caused.
  if (failure !== undefined) return err(failure)
  if (!published.ok) return err(published.error)

  return ok(published.value)
}

/** The event that says FRIDAY asked. */
function requestedEvent(request: ApprovalRequest, causedByEventId: string): NewEvent {
  return {
    type: 'approval.requested',
    actor: request.actor,
    principalId: request.principalId as PrincipalId,
    causationId: causedByEventId,
    ...(request.correlationId === null ? {} : { correlationId: request.correlationId }),
    payload: {
      approvalId: request.id,
      decisionId: request.decisionId,
      title: request.title,
      riskClass: request.riskClass,
      action: request.action,
      resource: request.resource,
      expiresAt: request.expiresAt,
      requiredAuth: request.requiredAuth,
    },
    sensitivity: 'private',
  }
}

/**
 * Records every lapse in `captured`, each in its own transaction.
 *
 * ★ Per-approval rather than per-sweep. Two requests lapsing are two
 * independent facts, and wrapping them together would mean one that could not
 * be recorded silently undoing one that was.
 *
 * Stops at the first failure and reports it. Everything before it is committed
 * and correctly recorded; everything after is still pending and will be found
 * by the next sweep, because expiry removes a request from `listPending`. That
 * is resumption falling out of durable state, not a retry.
 *
 * @param bus - The event bus.
 * @param approvals - The real store.
 * @param captured - The lapses the registry settled.
 * @returns The requests recorded as lapsed, or the first failure.
 */
async function recordLapse(
  bus: EventBus,
  approvals: ApprovalStore,
  captured: readonly CapturedWrite[],
): Promise<Result<readonly ApprovalRequest[], FridayError>> {
  const recorded: ApprovalRequest[] = []

  for (const write of captured) {
    const lapse = await record(bus, settledEvent(write.request), () =>
      approvals.replace(write.request),
    )

    if (!lapse.ok) return err(lapse.error)

    recorded.push(write.request)
  }

  return ok(recorded)
}

/** The three endings this package records, and the event for each. */
const SETTLED_AS = {
  approved: 'approval.granted',
  declined: 'approval.declined',
  expired: 'approval.expired',
} as const

type RecordableStatus = keyof typeof SETTLED_AS

/**
 * Names the event for a settled request, refusing anything else.
 *
 * ★ A lookup rather than a ternary. Before expiry had an event this read
 * `status === 'approved' ? granted : declined`, which labelled an expired
 * request as one the owner had *declined* — a false statement about what the
 * owner did, produced by a shape with no room for the third case.
 *
 * `pending` and `cancelled` throw. Neither can reach here: `pending` is not
 * settled, and nothing in FRIDAY produces `cancelled` yet. If either ever
 * does, this stops rather than filing it under the wrong ending.
 */
function eventTypeFor(status: ApprovalRequest['status']): string {
  const type = SETTLED_AS[status as RecordableStatus]

  if (type === undefined) {
    throw new TypeError(
      `an approval that is "${status}" has no settled event to record, ` +
        'and the clerk will not guess at one',
    )
  }

  return type
}

/** The event that says how a request ended. */
function settledEvent(request: ApprovalRequest): NewEvent {
  const respondedAt = request.respondedAt ?? request.createdAt

  return {
    type: eventTypeFor(request.status),
    actor: request.actor,
    principalId: request.principalId as PrincipalId,

    // ★ The request's own event, never its `decisionId`.
    ...(request.requestedEventId === null ? {} : { causationId: request.requestedEventId }),
    ...(request.correlationId === null ? {} : { correlationId: request.correlationId }),

    payload: {
      approvalId: request.id,
      action: request.action,
      resource: request.resource,
      respondedVia: request.respondedVia,
      reason: request.responseReason,
      timeToDecisionMs: Math.max(0, respondedAt - request.createdAt),
    },
    sensitivity: 'private',
  }
}

/**
 * The one write a successful raise or answer must have produced.
 *
 * Anything else is a genuine bug rather than an operational failure — it can
 * only mean the registry stopped writing through its store, or wrote twice for
 * one request — so it throws rather than returning a `Result`. Chapter 30
 * draws the line there.
 *
 * @param captured - What the registry wrote.
 * @param what - The operation, for the message.
 * @returns The single write.
 */
function only(captured: readonly CapturedWrite[], what: string): CapturedWrite {
  const first = captured[0]

  if (captured.length !== 1 || first === undefined) {
    throw new TypeError(
      `the approval registry reported success on ${what} after making ` +
        `${captured.length} writes, and the clerk can record exactly one`,
    )
  }

  return first
}
