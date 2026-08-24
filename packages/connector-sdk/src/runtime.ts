import {
  type ConnectorManifest,
  type ConnectorOperation,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'
import {
  type BreakerPolicy,
  type CircuitBreaker,
  createCircuitBreaker,
  DEFAULT_BREAKER_POLICY,
  tripsBreaker,
} from './circuit-breaker.js'
import {
  type BlockedEgress,
  type ConnectorFetch,
  type ConnectorRequestInit,
  createConnectorFetch,
} from './egress.js'
import { createRateLimiter, type RateLimiter } from './rate-limit.js'
import {
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  isTransient,
  mayRepeat,
  nextRetryDelay,
  type RetryPolicy,
  retryAfterMs,
} from './retry.js'

/**
 * Everything a connector's requests pass through, composed once.
 *
 * Until now each control existed on its own and nothing put them in order.
 * This is that order, and the order is load-bearing:
 *
 *  1. **The circuit breaker**, before anything else. A service that is down
 *     should cost nothing — not a token from the bucket, not a DNS lookup.
 *  2. **The rate limiter**, before the request. Chapter 14: *"FRIDAY does not
 *     discover limits by being throttled."*
 *  3. **The egress boundary**, which refuses undeclared hosts before a packet
 *     leaves and bounds the call in time.
 *  4. **The retry rule**, which never repeats what a repeat would duplicate.
 *
 * ★ **Everything that happens here is reported.** The observer is how a
 * refusal, a call, or a service going quiet reaches the event log — Chapter 14
 * requires a blocked egress to raise a diagnostic, and a control nobody is
 * told about teaches the owner nothing.
 *
 * Reference: docs/01-bible/14-connector-framework.md
 */

/** What the runtime saw. Whoever owns the event log turns these into events. */
export interface ConnectorObserver {
  /** A request refused at the boundary. Never reached the network. */
  readonly onBlocked?: ((event: BlockedEgress) => void) | undefined

  /** A call that ran to a conclusion, however it ended. */
  readonly onCalled?:
    | ((event: {
        readonly connectorId: string
        readonly operationId: string
        readonly outcome: 'succeeded' | 'failed' | 'refused'
        readonly status: number | null
        readonly durationMs: number
        readonly attempts: number
        readonly errorCode: string | null
        readonly correlationId: string | undefined
      }) => void)
    | undefined

  /** The circuit opened: FRIDAY has stopped calling this service. */
  readonly onDegraded?:
    | ((event: {
        readonly connectorId: string
        readonly reason: string
        readonly consecutiveFailures: number
        readonly retryAt: number
      }) => void)
    | undefined

  /** The circuit closed again. */
  readonly onRecovered?:
    | ((event: { readonly connectorId: string; readonly degradedForMs: number }) => void)
    | undefined
}

export interface ConnectorRuntimeOptions {
  readonly manifest: ConnectorManifest
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number

  /** Injected so a test never waits a real second. */
  readonly sleep: (ms: number) => Promise<void>

  readonly retry?: RetryPolicy | undefined
  readonly breaker?: BreakerPolicy | undefined
  readonly observer?: ConnectorObserver | undefined
  readonly random?: (() => number) | undefined
}

export interface ConnectorRuntime {
  /** The only way out: guarded, limited, retried, and behind the breaker. */
  readonly fetch: ConnectorFetch

  /** For the dashboard and the health check. Spends nothing. */
  readonly state: () => { readonly breaker: string; readonly tokens: number }
}

type Outcome = 'succeeded' | 'failed' | 'refused'

/** What one attempt concluded: try again, or this is the answer. */
type Step =
  | { readonly kind: 'retry'; readonly delayMs: number; readonly failure: FridayError | null }
  | {
      readonly kind: 'settled'
      readonly result: Result<Response, FridayError>
      readonly status: number | null
      readonly failure: FridayError | null
    }

/** How long a caller will wait for the bucket before giving up on the call. */
const MAX_THROTTLE_WAIT_MS = 5_000

function refusal(
  code: 'CONNECTOR_UNAVAILABLE',
  message: string,
  detail: Record<string, unknown>,
): FridayError {
  return fridayError({ code, message, detail })
}

/**
 * Composes the whole outbound path for one connector.
 *
 * @param options - The manifest, the transport, a clock, a sleep, and policies.
 * @returns A fetch every control has already been applied to.
 */
export function createConnectorRuntime(options: ConnectorRuntimeOptions): ConnectorRuntime {
  const { manifest, now, sleep } = options
  const retryPolicy = options.retry ?? DEFAULT_RETRY_POLICY
  const observer = options.observer
  const id = manifest.id

  const limiter: RateLimiter = createRateLimiter(manifest.rateLimits)
  const breaker: CircuitBreaker = createCircuitBreaker(options.breaker ?? DEFAULT_BREAKER_POLICY)

  let consecutiveFailures = 0
  let degradedSince: number | null = null

  const guarded: ConnectorFetch = createConnectorFetch({
    manifest,
    fetch: options.fetch,
    onBlocked: (event) => observer?.onBlocked?.(event),
  })

  /** Records the outcome against the breaker, and reports a change of state. */
  function noteFailure(at: number, error: FridayError): void {
    // Belt and braces. Callers already filter to provider failures before
    // reaching here, so this is currently unreachable — kept because the cost
    // of it being wrong is a configuration mistake presenting as an outage,
    // and that is exactly the confusion the attribution rule exists to stop.
    if (!tripsBreaker(error)) return

    consecutiveFailures += 1
    breaker.recordFailure(at)

    // ★ Reported on the way IN to degraded, never while already there.
    // A failing probe re-opens the circuit once a minute, and a service down
    // for a day would otherwise write 1,440 identical events into a log that
    // is also the audit trail. "It broke" is the event; "it is still broken"
    // is a state, and the state is readable from `state()`.
    if (breaker.stateAt(at) === 'open' && degradedSince === null) {
      degradedSince = at
      observer?.onDegraded?.({
        connectorId: id,
        reason: `${manifest.service} stopped answering.`,
        consecutiveFailures,
        retryAt: at + (options.breaker ?? DEFAULT_BREAKER_POLICY).openMs,
      })
    }
  }

  function noteSuccess(at: number): void {
    const wasOpen = degradedSince !== null
    breaker.recordSuccess(at)
    consecutiveFailures = 0

    if (wasOpen && degradedSince !== null) {
      observer?.onRecovered?.({ connectorId: id, degradedForMs: at - degradedSince })
      degradedSince = null
    }
  }

  /** Waits for a token, or gives up rather than queueing behind a long one. */
  async function awaitCapacity(): Promise<boolean> {
    const decision = limiter.take(now())
    if (decision.allowed) return true

    // ★ Bounded. A caller that waited however long the bucket demanded would
    // turn a rate limit into an unbounded pause, which Chapter 14's "no
    // unbounded waits" rule forbids just as much as a missing timeout does.
    if (decision.retryAfterMs > MAX_THROTTLE_WAIT_MS) return false

    await sleep(decision.retryAfterMs)
    return limiter.take(now()).allowed
  }

  /**
   * One attempt: send it, and say whether to try again.
   *
   * Split out so the call loop reads as a loop. Every branch that decides
   * *whether* to retry lives here; every branch that decides what to *record*
   * lives in the loop. Keeping those apart is what stops this becoming the
   * kind of function nobody can hold in their head.
   */
  async function runAttempt(
    operation: ConnectorOperation,
    url: string,
    init: ConnectorRequestInit | undefined,
    attempt: number,
  ): Promise<Step> {
    const result = await guarded(operation, url, init)
    const at = now()

    if (!result.ok) {
      // ★ Only a failure the provider is answerable for. A refusal at our own
      // boundary must never present as an outage.
      const failure = tripsBreaker(result.error) ? result.error : null

      if (shouldTryAgain(operation, init, result.error, attempt, retryPolicy)) {
        const delay = nextRetryDelay({ attempt, policy: retryPolicy, ...randomOf(options) })
        if (delay.kind === 'wait') return { kind: 'retry', delayMs: delay.ms, failure }
      }

      return { kind: 'settled', result, status: null, failure }
    }

    const response = result.value
    const failure = providerFailure(id, operation.id, response.status)

    const wait = waitForStatus(response, at, attempt, retryPolicy, operation, init, options)
    if (wait !== null) return { kind: 'retry', delayMs: wait, failure }

    return { kind: 'settled', result: ok(response), status: response.status, failure }
  }

  /**
   * The bookkeeping for one call: how many attempts, how long, and how to
   * report the two things every exit needs to say.
   *
   * Its own factory rather than closures inside `fetch`, so the call path
   * reads as a sequence of decisions instead of a wall of nested functions.
   */
  function beginCall(operation: ConnectorOperation, init: ConnectorRequestInit | undefined) {
    const startedAt = now()
    let attempts = 0

    function report(outcome: Outcome, status: number | null, errorCode: string | null): void {
      observer?.onCalled?.({
        connectorId: id,
        operationId: operation.id,
        outcome,
        status,
        durationMs: now() - startedAt,
        attempts: Math.max(1, attempts),
        errorCode,
        correlationId: init?.correlationId,
      })
    }

    return {
      get attempts() {
        return attempts
      },
      nextAttempt: () => {
        attempts += 1
      },
      report,
      refuse: (message: string, detail: Record<string, unknown>) => {
        const error = refusal('CONNECTOR_UNAVAILABLE', message, {
          connector: id,
          operation: operation.id,
          ...detail,
        })
        report('refused', null, error.code)
        return err(error)
      },
    }
  }

  type Call = ReturnType<typeof beginCall>

  /**
   * Ends a call that our own limiter stopped, rather than the provider.
   *
   * Two quite different endings share this path, and telling them apart is the
   * whole job: a retry that got throttled is a call the provider already
   * failed, and a first attempt that got throttled never happened at all.
   */
  function giveUpThrottled(
    call: Call,
    observed: FridayError | null,
  ): Result<Response, FridayError> {
    const at = now()

    // ★ The provider has already failed once, and that failure is real.
    // Losing it because we then gave up for our own reasons would let a
    // genuinely broken service look quiet.
    if (observed !== null) {
      noteFailure(at, observed)
      call.report('failed', null, observed.code)
      return err(observed)
    }

    // Nothing was ever sent, so the provider is answerable for nothing — but
    // the probe must be handed back or the circuit wedges. Handed back WITHOUT
    // a verdict: a success would close the circuit on the strength of a
    // request that did not happen.
    breaker.releaseProbe(at)

    return call.refuse(
      `FRIDAY is calling ${manifest.service} as fast as it allows, so this one waited too long.`,
      { throttled: true },
    )
  }

  /** Records the outcome against the circuit, and says what happened. */
  function settle(
    call: Call,
    step: Extract<Step, { kind: 'settled' }>,
    observed: FridayError | null,
  ): Result<Response, FridayError> {
    const at = now()

    if (observed !== null) {
      noteFailure(at, observed)
    } else if (step.result.ok) {
      noteSuccess(at)
    } else {
      // ★ Neither. A refusal at our own boundary — a blocked host, a bad URL —
      // is not the provider failing, and it is not the provider succeeding
      // either. Recording a success here would RESET the failure count, so
      // four real outages followed by one manifest mistake would look like a
      // healthy service. The probe is handed back and nothing is decided.
      breaker.releaseProbe(at)
    }

    if (!step.result.ok) call.report('failed', step.status, step.result.error.code)
    else call.report(succeeded(step.status), step.status, null)

    return step.result
  }

  const fetch: ConnectorFetch = async (operation, url, init) => {
    const call = beginCall(operation, init)

    // What the provider last did wrong, if anything. Held across attempts so
    // that giving up for our OWN reasons does not throw away something we
    // already observed.
    let observed: FridayError | null = null

    // ★ Asked ONCE per call, not once per attempt. A call and its retries are
    // one thing as far as the circuit is concerned — and asking per attempt
    // was a liveness bug: in half-open the first attempt reserves the single
    // probe, and the retry that follows is refused by that same reservation.
    // The outcome is never recorded, the probe is never released, and the
    // circuit stays half-open forever. One outage wedged a connector for good.
    if (!breaker.attempt(now())) {
      return call.refuse(`${manifest.service} is not answering, so FRIDAY did not call it.`, {
        circuit: 'open',
      })
    }

    while (true) {
      if (!(await awaitCapacity())) return giveUpThrottled(call, observed)

      call.nextAttempt()
      const step = await runAttempt(operation, url, init, call.attempts)
      if (step.failure !== null) observed = step.failure

      if (step.kind !== 'retry') return settle(call, step, observed)

      await sleep(step.delayMs)
    }
  }

  return {
    fetch,
    state: () => ({ breaker: breaker.stateAt(now()), tokens: limiter.tokensAt(now()) }),
  }
}

function randomOf(options: ConnectorRuntimeOptions): { random?: () => number } {
  return options.random === undefined ? {} : { random: options.random }
}

function keyOf(init: ConnectorRequestInit | undefined): { idempotencyKey?: string } {
  return init?.idempotencyKey === undefined ? {} : { idempotencyKey: init.idempotencyKey }
}

function succeeded(status: number | null): Outcome {
  return status !== null && status < 400 ? 'succeeded' : 'failed'
}

/** The failure a status represents, or `null` when the provider did its job. */
function providerFailure(
  connectorId: string,
  operationId: string,
  status: number,
): FridayError | null {
  if (!blamesProvider(status)) return null

  return fridayError({
    code: 'CONNECTOR_UNAVAILABLE',
    message: 'the service did not serve',
    detail: { connector: connectorId, operation: operationId, status },
  })
}

/** Statuses the provider is answerable for, as opposed to ones we caused. */
function blamesProvider(status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * How long to wait before trying this response again, or `null` for no retry.
 *
 * Separated out because the decision has four independent conditions — budget,
 * status, the provider's own instruction, and whether repeating is safe — and
 * reading them inline made the call path hard to follow.
 */
function waitForStatus(
  response: Response,
  at: number,
  attempts: number,
  policy: RetryPolicy,
  operation: ConnectorOperation,
  init: ConnectorRequestInit | undefined,
  options: ConnectorRuntimeOptions,
): number | null {
  if (attempts >= policy.maxAttempts) return null
  if (!isRetryableStatus(response.status)) return null
  if (!mayRepeat(operation, { correlationId: '', ...keyOf(init) })) return null

  const delay = nextRetryDelay({
    attempt: attempts,
    policy,
    retryAfterMs: retryAfterMs(response.headers, at),
    ...randomOf(options),
  })

  return delay.kind === 'wait' ? delay.ms : null
}

/** All three retry conditions, applied together. */
function shouldTryAgain(
  operation: ConnectorOperation,
  init: ConnectorRequestInit | undefined,
  error: FridayError,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  if (attempt >= policy.maxAttempts) return false
  if (!isTransient(error)) return false

  return mayRepeat(operation, { correlationId: '', ...keyOf(init) })
}
