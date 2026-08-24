import type { ErrorCode, FridayError } from '@friday/contracts'

/**
 * The circuit breaker: stop calling a service that is not answering.
 *
 * Chapter 14 gives this one explicit numbers — *"5 consecutive failures →
 * open for 60s → half-open probe → closed"* — so they are the defaults rather
 * than a guess.
 *
 * What it is actually for is the second-order effect. A service having a bad
 * minute does not need FRIDAY's retries added to its load, and a caller
 * waiting 30 seconds to be told what the last twenty callers were already
 * told is a caller doing nothing useful. Failing immediately is both kinder to
 * the service and faster for the owner.
 *
 * Clock-injected and timer-free, for the same reason as the rate limiter: an
 * hour of behaviour is tested in a microsecond.
 *
 * Reference: docs/01-bible/14-connector-framework.md
 */

export const BREAKER_STATES = ['closed', 'open', 'half_open'] as const
export type BreakerState = (typeof BREAKER_STATES)[number]

export interface BreakerPolicy {
  /** Consecutive failures before the circuit opens. */
  readonly failureThreshold: number

  /** How long it stays open before one probe is allowed through. */
  readonly openMs: number
}

/** Chapter 14's numbers, verbatim. */
export const DEFAULT_BREAKER_POLICY: BreakerPolicy = {
  failureThreshold: 5,
  openMs: 60_000,
}

/**
 * Failures the provider is answerable for.
 *
 * ★ The distinction the breaker depends on. `EGRESS_BLOCKED` is **FRIDAY's
 * own refusal** — a manifest that does not declare a host the connector needs.
 * Counting it here would open the circuit against a provider that is
 * perfectly healthy, and present a configuration mistake as an outage. The
 * owner would go and check someone else's status page.
 *
 * `CONNECTOR_FAULTED` is excluded for the mirror-image reason: a connector
 * crashing is our bug, not the service's. It still needs to be loud, but the
 * breaker is not the thing that should say it.
 */
const PROVIDER_FAULTS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'TIMEOUT',
  'CONNECTOR_UNAVAILABLE',
])

/**
 * Whether this failure should count against the service.
 *
 * @param error - The failure that just happened.
 * @returns True only when the provider is the one that failed.
 */
export function tripsBreaker(error: FridayError): boolean {
  return PROVIDER_FAULTS.has(error.code)
}

export interface CircuitBreaker {
  /** What the circuit is doing, accounting for time already passed. */
  stateAt(now: number): BreakerState

  /**
   * Whether a call may go now — and, in half-open, **reserves the one probe**.
   *
   * Deliberately not a pure query. Half-open must let exactly one call through
   * to find out whether the service is back; a pure `canCall` would let every
   * waiting caller through at once, which is the stampede the open circuit
   * existed to prevent.
   */
  attempt(now: number): boolean

  recordSuccess(now: number): void
  recordFailure(now: number): void

  /**
   * Hands back a reserved probe without deciding anything.
   *
   * ★ For a call that was allowed through and then never sent — throttled,
   * cancelled, refused at our own boundary. Recording a success instead would
   * **close the circuit on the strength of a request that never happened**,
   * which is how a service that is still down starts being called again at
   * full volume. Leaving the probe reserved is the opposite failure: the
   * circuit never probes again and the connector wedges. Neither is
   * acceptable, so this is its own operation.
   */
  releaseProbe(now: number): void
}

/**
 * Builds a circuit breaker.
 *
 * @param policy - How many consecutive failures open it, and for how long.
 * @returns A breaker holding that policy.
 */
export function createCircuitBreaker(
  policy: BreakerPolicy = DEFAULT_BREAKER_POLICY,
): CircuitBreaker {
  let state: BreakerState = 'closed'
  let consecutiveFailures = 0
  let openedAt = 0
  let probeInFlight = false

  /** Moves open → half-open once the wait has elapsed. */
  function settle(now: number): void {
    if (state !== 'open') return

    // `>=` so the boundary is exact. A clock stepping backwards makes this
    // difference negative, which is below any positive wait — so the circuit
    // stays open rather than closing early, which is the safe direction.
    if (now - openedAt >= policy.openMs) {
      state = 'half_open'
      probeInFlight = false
    }
  }

  function trip(now: number): void {
    state = 'open'
    openedAt = now
    probeInFlight = false
  }

  return {
    stateAt(now: number): BreakerState {
      settle(now)
      return state
    },

    attempt(now: number): boolean {
      settle(now)

      if (state === 'closed') return true
      if (state === 'open') return false

      // Half-open: exactly one call finds out whether the service is back.
      if (probeInFlight) return false

      probeInFlight = true
      return true
    },

    releaseProbe(now: number): void {
      settle(now)
      if (state === 'half_open') probeInFlight = false
    },

    recordSuccess(now: number): void {
      settle(now)

      // ★ A success resets the count rather than decrementing it. Chapter 14
      // says CONSECUTIVE failures: four failures and a success is a service
      // having a rough time, not a service that is down, and a decrementing
      // counter would eventually open the circuit on a service that works.
      consecutiveFailures = 0
      probeInFlight = false
      state = 'closed'
    },

    recordFailure(now: number): void {
      settle(now)

      // Already open: there is nothing further to learn from another failure,
      // and the wait is already running.
      if (state === 'open') return

      // The probe failed, so the service just told us it is still broken.
      // Re-opens for the FULL wait rather than a remainder.
      //
      // The counter is deliberately not touched: reaching half-open already
      // required crossing the threshold, so incrementing here would be
      // arithmetic with no reader. Kept as its own branch rather than falling
      // through to the counting path, because that path only happens to give
      // the same answer — it would stop doing so the day anything else resets
      // the count.
      if (state === 'half_open') {
        trip(now)
        return
      }

      consecutiveFailures += 1

      if (consecutiveFailures >= policy.failureThreshold) trip(now)
    },
  }
}
