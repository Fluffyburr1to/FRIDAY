import {
  err,
  type FridayError,
  fridayError,
  type HealthReport,
  type Result,
} from '@friday/contracts'
import type {
  AnyOperationMap,
  Connector,
  ConnectorContext,
  ConnectorOperationMap,
  DryRunResult,
  OperationContext,
} from './connector.js'
import { operationById } from './connector.js'

/**
 * The lifecycle contract, enforced rather than documented.
 *
 * A connector is the component Chapter 14 expects to be *"written quickly, by
 * an AI, or by a third party"*. Everything here assumes exactly that: the
 * supervisor holds the rules so that a connector cannot break them by being
 * careless, and so that reviewing a connector does not mean re-checking that
 * it got the lifecycle right.
 *
 * Three things it guarantees, whatever the connector does:
 *
 *  1. **Nothing runs before `initialize` succeeds, or after `shutdown`.**
 *  2. **No operation runs that the manifest does not declare.** The same
 *     shape of rule as the egress allowlist — declared, or refused.
 *  3. **A connector that throws does not take the kernel with it.** A thrown
 *     error becomes a typed failure naming the connector as the fault.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 23
 */

export const CONNECTOR_STATES = ['created', 'ready', 'stopped'] as const
export type ConnectorState = (typeof CONNECTOR_STATES)[number]

export interface SupervisedConnector<Ops extends ConnectorOperationMap = AnyOperationMap>
  extends Connector<Ops> {
  /** Where in its life this connector is. Readable, never settable. */
  readonly state: ConnectorState
}

function notReady(connectorId: string, state: ConnectorState, what: string): FridayError {
  const because =
    state === 'stopped' ? 'it has already been shut down' : 'it has not been started yet'

  return fridayError({
    code: 'CONNECTOR_NOT_READY',
    message: `${connectorId} cannot ${what} because ${because}.`,
    detail: { connector: connectorId, state },
  })
}

/**
 * Runs one call, converting anything thrown into a typed failure.
 *
 * ★ Chapter 30 says `throw` is for genuine bugs, and a connector throwing IS
 * a genuine bug — but it is a bug in the least trustworthy component in the
 * system, and letting it propagate would let a third-party adapter crash
 * FRIDAY. Recorded as `CONNECTOR_FAULTED` so a diagnostic points at this
 * repository rather than at the provider's status page.
 */
async function guarded<T>(
  connectorId: string,
  what: string,
  run: () => Promise<Result<T, FridayError>>,
): Promise<Result<T, FridayError>> {
  try {
    return await run()
  } catch (cause) {
    return err(
      fridayError({
        code: 'CONNECTOR_FAULTED',
        message: `${connectorId} failed unexpectedly while trying to ${what}.`,
        detail: { connector: connectorId },
        cause,
      }),
    )
  }
}

/**
 * Wraps a connector so its lifecycle and its manifest are both enforced.
 *
 * @param connector - The connector implementation.
 * @returns The same connector, holding its own rules.
 */
export function superviseConnector<Ops extends ConnectorOperationMap = AnyOperationMap>(
  connector: Connector<Ops>,
): SupervisedConnector<Ops> {
  let state: ConnectorState = 'created'
  const id = connector.manifest.id

  /** Shared by execute and dryRun: both need a live connector and a real operation. */
  function refuseIfUnusable(operationId: string, what: string): FridayError | null {
    if (state !== 'ready') return notReady(id, state, what)

    if (operationById(connector.manifest, operationId) === undefined) {
      return fridayError({
        code: 'OPERATION_NOT_DECLARED',
        message: `${id} was asked to ${operationId}, which it does not declare.`,
        detail: { connector: id, operation: operationId },
      })
    }

    return null
  }

  return {
    manifest: connector.manifest,

    get state() {
      return state
    },

    async initialize(context: ConnectorContext): Promise<Result<void, FridayError>> {
      // Starting twice would run acquisition twice — two token refreshes, two
      // pools — and leave the first set unreleasable.
      if (state !== 'created') return err(notReady(id, state, 'start'))

      const result = await guarded(id, 'start', () => connector.initialize(context))
      if (result.ok) state = 'ready'

      return result
    },

    async health(): Promise<HealthReport> {
      // ★ A connector that has not started reports `unknown`, never `healthy`.
      // Chapter 23: assuming health from silence is how outages go unnoticed.
      if (state !== 'ready') {
        return {
          component: id,
          status: 'unknown',
          detail: `${id} has not been started, so nothing is known about it.`,
          checkedAt: 0,
          latencyMs: 0,
          metrics: {},
        }
      }

      try {
        return await connector.health()
      } catch {
        return {
          component: id,
          status: 'unhealthy',
          detail: `${id} failed while checking itself.`,
          checkedAt: 0,
          latencyMs: 0,
          metrics: {},
        }
      }
    },

    async execute<K extends keyof Ops & string>(
      operationId: K,
      input: Ops[K]['input'],
      context: OperationContext,
    ): Promise<Result<Ops[K]['output'], FridayError>> {
      const refusal = refuseIfUnusable(operationId, `run ${operationId}`)
      if (refusal !== null) return err(refusal)

      return await guarded(id, `run ${operationId}`, () =>
        connector.execute(operationId, input, context),
      )
    },

    async dryRun<K extends keyof Ops & string>(
      operationId: K,
      input: Ops[K]['input'],
    ): Promise<Result<DryRunResult, FridayError>> {
      const refusal = refuseIfUnusable(operationId, `preview ${operationId}`)
      if (refusal !== null) return err(refusal)

      return await guarded(id, `preview ${operationId}`, () => connector.dryRun(operationId, input))
    },

    async shutdown(): Promise<void> {
      // Cleanup must always be safe to call: a supervisor unwinding a failed
      // startup does not know how far the connector got.
      if (state === 'stopped') return

      state = 'stopped'

      try {
        await connector.shutdown()
      } catch {
        // Already stopped as far as everything else is concerned. A connector
        // that throws on the way out must not block the shutdown of anything
        // after it in the sequence.
      }
    },
  }
}
