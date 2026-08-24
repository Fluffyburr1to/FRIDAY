import type {
  ConnectorManifest,
  ConnectorOperation,
  CorrelationId,
  FridayError,
  HealthReport,
  Impact,
  PlanId,
  PlanStepId,
  Preview,
  Result,
} from '@friday/contracts'
import type { ConnectorFetch } from './egress.js'

/**
 * The interface every connector implements.
 *
 * Chapter 14 keeps this small on purpose: *"A connector is a thin, boring
 * adapter, and a small interface is a small surface to review and a small
 * thing to reimplement when a service changes its API."*
 *
 * ★ **A connector has no judgment.** It does not decide when to send an email,
 * only how. Every judgment — whether an action is permitted, whether the owner
 * must be asked, which department handles what — lives outside this interface.
 * That is what keeps the riskiest component in FRIDAY simple enough to review
 * completely.
 *
 * Reference: docs/01-bible/14-connector-framework.md
 */

/**
 * What a connector is handed at startup, and the only capabilities it gets.
 *
 * ★ It reaches for nothing else. `fetch` here is the guarded one, bound to
 * this connector's own manifest — the connector cannot widen it, and the
 * global is denied to it at build time. `now` is injected for the same reason
 * a clock always is: a connector that reads the wall clock directly cannot be
 * tested against a deadline without waiting for one.
 */
export interface ConnectorContext {
  readonly fetch: ConnectorFetch
  readonly now: () => number
}

/**
 * What a single call knows about why it is happening.
 *
 * Every field here exists to make the audit trail reconstructable: Chapter 20
 * requires that "why did FRIDAY do that?" be answered from recorded data
 * rather than from a model's account of its own reasoning.
 */
export interface OperationContext {
  /** Ties this call to the request it belongs to, across every component. */
  readonly correlationId: CorrelationId

  /** Absent for a health check, which belongs to no plan. */
  readonly planId?: PlanId | undefined
  readonly stepId?: PlanStepId | undefined

  /**
   * Supplied only for an operation the provider can deduplicate.
   *
   * ★ Load-bearing for the retry rule: a non-idempotent operation may be
   * retried **only** when the provider will collapse the duplicate, and this
   * is the token that makes that true. Without one, a retry is how an email
   * gets sent three times.
   */
  readonly idempotencyKey?: string | undefined

  /** Lets a caller abandon a call it no longer needs. */
  readonly signal?: AbortSignal | undefined
}

/**
 * What a write would do, shown before it is approved.
 *
 * ★ Deliberately built from `Preview` and `Impact` in `contracts` rather than
 * from a shape of its own. Those are exactly what the approval screen renders,
 * so a connector's dry run produces the artifact the owner sees **byte for
 * byte**. A separate shape here would need translating, and translation is
 * where "send a follow-up to Sarah" quietly replaces the actual message.
 */
export interface DryRunResult {
  readonly preview: Preview
  readonly impact: Impact
}

/**
 * The operations a connector supports, as a type.
 *
 * Chapter 14 writes `execute<Op>(op, input: InputOf<Op>)`. This is that: a
 * connector declares its own map and gets per-operation types, while anything
 * holding a connector generically still works against `unknown`.
 */
export interface ConnectorOperationMap {
  readonly [operationId: string]: { readonly input: unknown; readonly output: unknown }
}

/** The default: a connector whose operations are not known at the type level. */
export interface AnyOperationMap extends ConnectorOperationMap {
  readonly [operationId: string]: { readonly input: unknown; readonly output: unknown }
}

export interface Connector<Ops extends ConnectorOperationMap = AnyOperationMap> {
  /** What this connector declares. Never mutated after construction. */
  readonly manifest: ConnectorManifest

  /**
   * Prepare to work. Called once, before anything else.
   *
   * Returns a failure rather than throwing, because "this connector cannot
   * start" is an ordinary outcome the kernel must handle — a missing
   * credential or an unreachable provider should degrade a department, not
   * crash a startup.
   */
  initialize(context: ConnectorContext): Promise<Result<void, FridayError>>

  /**
   * A cheap probe, on the operation the manifest nominates.
   *
   * Returns a report rather than a `Result`: an unhealthy connector is not a
   * failed call, it is a fact about the world, and `unknown` is a legitimate
   * answer. Chapter 23 is explicit that silence must never read as health.
   */
  health(): Promise<HealthReport>

  /** Do the thing. The only method with an external side effect. */
  execute<K extends keyof Ops & string>(
    operationId: K,
    input: Ops[K]['input'],
    context: OperationContext,
  ): Promise<Result<Ops[K]['output'], FridayError>>

  /**
   * Say what `execute` would do, without doing it.
   *
   * Mandatory for every write operation — enforced in the manifest schema, so
   * a connector that writes without being able to preview cannot be described.
   */
  dryRun<K extends keyof Ops & string>(
    operationId: K,
    input: Ops[K]['input'],
  ): Promise<Result<DryRunResult, FridayError>>

  /** Release what `initialize` acquired. Safe to call more than once. */
  shutdown(): Promise<void>
}

/**
 * Finds a declared operation by id.
 *
 * @param manifest - The connector's manifest.
 * @param operationId - The operation being asked for.
 * @returns The declared operation, or `undefined` when it was never declared.
 */
export function operationById(
  manifest: ConnectorManifest,
  operationId: string,
): ConnectorOperation | undefined {
  return manifest.operations.find((operation) => operation.id === operationId)
}
