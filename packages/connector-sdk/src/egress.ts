import {
  type ConnectorManifest,
  type ConnectorOperation,
  type CorrelationId,
  egressPermits,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'

/**
 * The egress boundary — the one place a connector's network access is decided.
 *
 * Chapter 14 calls the allowlist *"one of the highest-value controls in the
 * entire security model, and it costs almost nothing"*, and this is where it
 * costs it. A connector does not receive `fetch`. It receives this, bound to
 * its own manifest, and it cannot widen what its manifest declared.
 *
 * ★ **A blocked request never happens.** The check runs before the underlying
 * `fetch` is called, not after — so a connector reaching for an undeclared
 * host does not leak a DNS lookup, a TLS handshake, or the fact that FRIDAY
 * exists to that host. This is what defends against a compromised dependency
 * and a manipulated agent, neither of which will ask politely first.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 18
 */

/** Why a request was refused at the boundary. */
export type BlockedEgressReason = 'undeclared_host' | 'insecure_transport' | 'unparseable_url'

/**
 * A refusal, in the shape a `security.egress.blocked` event needs.
 *
 * Reported rather than emitted here: this package does not own the event log,
 * and a boundary that reached for it would be a boundary that could not be
 * tested without one. The caller wires this to the bus and the diagnostic.
 */
export interface BlockedEgress {
  readonly connectorId: string
  readonly operationId: string
  /** The host that was refused. `null` when the URL could not be parsed. */
  readonly host: string | null
  readonly reason: BlockedEgressReason
  /** The URL as the connector supplied it, for the diagnostic to quote. */
  readonly url: string
}

export interface ConnectorFetchOptions {
  readonly manifest: ConnectorManifest

  /** Injected so the boundary is testable without a network. */
  readonly fetch: typeof globalThis.fetch

  /** Called for every refusal. Must not throw. */
  readonly onBlocked?: ((event: BlockedEgress) => void) | undefined
}

/**
 * What a connector may set on a request.
 *
 * `redirect` is absent because the guard owns it — see below. `signal` is
 * widened to accept `undefined` so that `OperationContext.signal` can be
 * passed straight through; under `exactOptionalPropertyTypes` the DOM's own
 * `AbortSignal | null` would make every connector write a conditional spread.
 */
export type ConnectorRequestInit = Omit<RequestInit, 'redirect' | 'signal'> & {
  readonly signal?: AbortSignal | null | undefined

  /**
   * The provider's deduplication token, when this call has one.
   *
   * ★ Carried on the request rather than taken from the operation context,
   * so that **forgetting it is the safe mistake.** A connector that omits it
   * on a non-idempotent call simply does not get retried; a connector that
   * omitted a whole context would still be retried, on the assumption that
   * someone else had thought about it.
   */
  readonly idempotencyKey?: string | undefined

  /**
   * Ties this request to the plan step that caused it, in the audit trail.
   *
   * ★ Typed as `CorrelationId` rather than `string` on purpose. The event log
   * requires a UUID, so a plain string would compile, reach the bus, and be
   * refused at publish time — losing the audit record for a call that had
   * already gone out. The compiler is the only place that can catch it before
   * it becomes a hole in the trail.
   */
  readonly correlationId?: CorrelationId | undefined
}

/**
 * A guarded request. Returns a typed failure rather than throwing, because a
 * failing external service is an ordinary outcome and Article VII asks for it
 * to be handled rather than caught.
 */
export type ConnectorFetch = (
  operation: ConnectorOperation,
  url: string,
  init?: ConnectorRequestInit,
) => Promise<Result<Response, FridayError>>

function refuse(
  options: ConnectorFetchOptions,
  operation: ConnectorOperation,
  url: string,
  host: string | null,
  reason: BlockedEgressReason,
  message: string,
): Result<Response, FridayError> {
  options.onBlocked?.({
    connectorId: options.manifest.id,
    operationId: operation.id,
    host,
    reason,
    url,
  })

  return err(
    fridayError({
      code: 'EGRESS_BLOCKED',
      message,
      detail: { connector: options.manifest.id, operation: operation.id, host, reason },
    }),
  )
}

/**
 * The signal a request should actually watch.
 *
 * ★ Both, not either. An earlier version set only the deadline, which silently
 * discarded the caller's signal — so a plan that had moved on still held the
 * call open for the full timeout.
 *
 * @param deadline - The guard's own timeout signal.
 * @param caller - The signal the caller supplied, if any.
 * @returns A signal that fires when either does.
 */
function combineSignals(
  deadline: AbortSignal,
  caller: AbortSignal | null | undefined,
): AbortSignal {
  if (caller === undefined || caller === null) return deadline
  return AbortSignal.any([deadline, caller])
}

/**
 * Turns a rejected request into the failure that names the right party.
 *
 * @param options - The connector's manifest and reporting hooks.
 * @param operation - The operation being run.
 * @param aborted - Which signals fired, if any.
 * @param cause - What the underlying fetch threw.
 * @returns A typed failure.
 */
function describeFailure(
  options: ConnectorFetchOptions,
  operation: ConnectorOperation,
  aborted: { readonly deadline: boolean; readonly caller: boolean },
  cause: unknown,
): FridayError {
  const detail = { connector: options.manifest.id, operation: operation.id }

  // The deadline specifically — a caller that cancelled did not time out, and
  // reporting it as a timeout would blame the provider for our own choice.
  if (aborted.deadline) {
    return fridayError({
      code: 'TIMEOUT',
      message: `${options.manifest.service} did not answer within ${operation.timeoutMs}ms.`,
      detail: { ...detail, timeoutMs: operation.timeoutMs },
      cause,
    })
  }

  if (aborted.caller) {
    return fridayError({
      code: 'CANCELLED',
      message: `The call to ${options.manifest.service} was abandoned before it finished.`,
      detail,
      cause,
    })
  }

  return fridayError({
    code: 'CONNECTOR_UNAVAILABLE',
    message: `${options.manifest.service} could not be reached.`,
    detail,
    cause,
  })
}

/**
 * Builds the only way a connector may reach the network.
 *
 * @param options - The connector's manifest, the underlying fetch, and an
 *   optional reporter for refusals.
 * @returns A fetch bound to that manifest's allowlist and time limits.
 */
export function createConnectorFetch(options: ConnectorFetchOptions): ConnectorFetch {
  return async (operation, url, init) => {
    let target: URL

    try {
      target = new URL(url)
    } catch {
      // Guessing at a malformed URL is how a boundary gets talked past.
      return refuse(
        options,
        operation,
        url,
        null,
        'unparseable_url',
        `${options.manifest.id} asked for a location that is not a URL.`,
      )
    }

    // Chapter 18: TLS everywhere, with no exceptions for convenience. Checked
    // before the host, because plaintext to a *declared* host is still
    // plaintext.
    if (target.protocol !== 'https:') {
      return refuse(
        options,
        operation,
        url,
        target.hostname,
        'insecure_transport',
        `${options.manifest.id} tried to send data unencrypted to ${target.hostname}.`,
      )
    }

    if (!egressPermits(options.manifest, target.hostname)) {
      return refuse(
        options,
        operation,
        url,
        target.hostname,
        'undeclared_host',
        `${options.manifest.id} tried to reach ${target.hostname}, which it does not declare.`,
      )
    }

    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), operation.timeoutMs)
    const caller = init?.signal

    try {
      // `idempotencyKey` and `correlationId` are FRIDAY's, not the platform's.
      // Passing them through would put unknown keys on a real RequestInit.
      const { idempotencyKey: _key, correlationId: _correlation, ...forwarded } = init ?? {}

      const response = await options.fetch(url, {
        ...forwarded,

        // ★ The guard must own redirects. Letting the underlying fetch follow
        // one would let a declared host hand the connector to an undeclared
        // one, and the allowlist would be advisory. The connector re-enters
        // this function with the new location, or does not follow it.
        redirect: 'manual',
        signal: combineSignals(deadline.signal, caller),
      })

      return ok(response)
    } catch (cause) {
      return err(
        describeFailure(
          options,
          operation,
          { deadline: deadline.signal.aborted, caller: caller?.aborted === true },
          cause,
        ),
      )
    } finally {
      // A timer left pending would abort a later, unrelated call.
      clearTimeout(timer)
    }
  }
}
