import {
  type ConnectorManifest,
  type ConnectorOperation,
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
 * A guarded request. Returns a typed failure rather than throwing, because a
 * failing external service is an ordinary outcome and Article VII asks for it
 * to be handled rather than caught.
 */
export type ConnectorFetch = (
  operation: ConnectorOperation,
  url: string,
  init?: RequestInit,
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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), operation.timeoutMs)

    try {
      const response = await options.fetch(url, {
        ...init,

        // ★ The guard must own redirects. Letting the underlying fetch follow
        // one would let a declared host hand the connector to an undeclared
        // one, and the allowlist would be advisory. The connector re-enters
        // this function with the new location, or does not follow it.
        redirect: 'manual',
        signal: controller.signal,
      })

      return ok(response)
    } catch (cause) {
      if (controller.signal.aborted) {
        return err(
          fridayError({
            code: 'TIMEOUT',
            message: `${options.manifest.service} did not answer within ${operation.timeoutMs}ms.`,
            detail: {
              connector: options.manifest.id,
              operation: operation.id,
              timeoutMs: operation.timeoutMs,
            },
            cause,
          }),
        )
      }

      return err(
        fridayError({
          code: 'CONNECTOR_UNAVAILABLE',
          message: `${options.manifest.service} could not be reached.`,
          detail: { connector: options.manifest.id, operation: operation.id },
          cause,
        }),
      )
    } finally {
      // A timer left pending would abort a later, unrelated call.
      clearTimeout(timer)
    }
  }
}
