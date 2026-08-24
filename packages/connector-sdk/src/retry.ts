import type { ConnectorOperation, ErrorCode, FridayError } from '@friday/contracts'
import type { OperationContext } from './connector.js'

/**
 * When a failed call may be tried again, and how long to wait first.
 *
 * Chapter 14 states the rule that matters here in one sentence: *"Retrying a
 * non-idempotent operation is how you send an email three times."* Everything
 * below exists so that judgment is made once, by the framework, rather than
 * by each connector author at the moment they are least likely to be careful.
 *
 * Reference: docs/01-bible/14-connector-framework.md
 */

/**
 * The only failures worth trying again.
 *
 * ★ A deliberately short allowlist rather than a denylist of permanent errors.
 * A new failure mode added to `ErrorCode` should default to **not** being
 * retried: retrying something that will never succeed wastes budget and
 * hammers a service, while failing to retry something transient is merely a
 * call that did not happen. The safe default is the quiet one.
 *
 * Two entries in particular are absent on purpose:
 *
 *  - `EGRESS_BLOCKED` — the request was refused for reaching an undeclared
 *    host. Trying again is not resilience, it is an attempt to get around the
 *    allowlist, and it must never be automatic.
 *  - `CONNECTOR_FAULTED` — the connector threw. The bug is in this repository
 *    and running it again just runs the bug again.
 */
const TRANSIENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['TIMEOUT', 'CONNECTOR_UNAVAILABLE'])

export interface RetryPolicy {
  /** Total tries, including the first. `1` disables retrying. */
  readonly maxAttempts: number

  /** The first wait. Each subsequent one doubles, before jitter. */
  readonly baseDelayMs: number

  /** The ceiling. Doubling stops here however many attempts have failed. */
  readonly maxDelayMs: number
}

/** Conservative on purpose: three tries, and never more than half a minute. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
}

/**
 * Whether this failure is the kind that might succeed next time.
 *
 * @param error - The failure that just happened.
 * @returns True only for failures the framework treats as transient.
 */
export function isTransient(error: FridayError): boolean {
  return TRANSIENT.has(error.code)
}

/**
 * Whether repeating this operation is safe at all.
 *
 * ★ The rule Chapter 14 refuses to leave to each connector's judgment. An
 * operation the provider cannot deduplicate is retried only when the caller
 * supplied an idempotency key, which is the thing that makes the duplicate
 * collapse on the provider's side rather than on hope.
 *
 * @param operation - The declared operation.
 * @param context - The call, which may carry an idempotency key.
 * @returns True when a second attempt cannot cause a second effect.
 */
export function mayRepeat(operation: ConnectorOperation, context: OperationContext): boolean {
  if (operation.idempotent) return true

  return typeof context.idempotencyKey === 'string' && context.idempotencyKey.length > 0
}

/**
 * Whether to try again, given everything known about the failure.
 *
 * All three conditions must hold. Written as one function so no caller can
 * check two of them and forget the third.
 *
 * @param options - The attempt number (1-based), the failure, the operation,
 *   the call context, and the policy.
 * @returns True only when a further attempt is both safe and worthwhile.
 */
export function shouldRetry(options: {
  readonly attempt: number
  readonly error: FridayError
  readonly operation: ConnectorOperation
  readonly context: OperationContext
  readonly policy: RetryPolicy
}): boolean {
  if (options.attempt >= options.policy.maxAttempts) return false
  if (!isTransient(options.error)) return false

  return mayRepeat(options.operation, options.context)
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * ★ Full jitter — a uniform pick between zero and the backoff ceiling, rather
 * than the ceiling itself. Fixed exponential backoff synchronises every client
 * that failed at the same moment, so they all return together and knock the
 * recovering service straight back over. The randomness is the point, not a
 * refinement of it.
 *
 * @param attempt - Which attempt just failed, 1-based.
 * @param policy - The delays to work within.
 * @param random - Injected, so a test can pin the jitter. Returns 0 ≤ n < 1.
 * @returns Milliseconds to wait, never above `maxDelayMs`.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const uncapped = policy.baseDelayMs * 2 ** (attempt - 1)
  const ceiling = Math.min(uncapped, policy.maxDelayMs)

  return Math.floor(random() * ceiling)
}
