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

/**
 * How hard to try again.
 *
 * ★ There is a second `RetryPolicy` in `@friday/kernel`, and the two are
 * deliberately separate rather than shared. The kernel's governs redelivering
 * an event to a subscriber **inside this process**, where there is no herd to
 * synchronise and no external party to annoy, so it has no jitter. This one
 * governs calls to somebody else's server. The field names are kept identical
 * so that the same concept reads the same way in both places.
 */
export interface RetryPolicy {
  /** Total tries, including the first. `1` disables retrying. */
  readonly maxAttempts: number

  /** The first wait. Each subsequent one doubles, before jitter. */
  readonly baseMs: number

  /** The ceiling. Doubling stops here however many attempts have failed. */
  readonly maxMs: number
}

/** Conservative on purpose: three tries, and never more than half a minute. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseMs: 1_000,
  maxMs: 30_000,
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
 * HTTP statuses worth trying again.
 *
 * ★ Kept apart from `isTransient`, which reads a `FridayError`. A 503 is not
 * an error in this system — the boundary returns it as an ordinary answer,
 * because deciding what a status means is the connector's job rather than the
 * transport's. So the retry decision has two doors, and this is the HTTP one.
 *
 * `429` is included and `403` is not, even though some providers signal
 * throttling with a 403: a 403 is far more often a permission problem, and
 * hammering a service that is refusing on authorisation grounds is how an
 * application gets banned rather than throttled.
 *
 * @param status - The HTTP status the provider returned.
 * @returns True when trying again could plausibly succeed.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 504)
}

/**
 * What a provider asked us to wait, from its `Retry-After` header.
 *
 * ★ **An explicit instruction from the service beats our own arithmetic.** Our
 * backoff is a guess about a system we cannot see; `Retry-After` is that
 * system telling us the answer. Ignoring it is how a client that thinks it is
 * being polite gets blocked anyway.
 *
 * Both forms in the specification are handled: a number of seconds, and an
 * HTTP date. A date already in the past yields `0` — the wait is over.
 *
 * @param headers - The response headers.
 * @param now - The current time, for resolving the date form.
 * @returns Milliseconds to wait, or `null` when there was no usable header.
 */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/

export function retryAfterMs(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after')
  if (raw === null) return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  // The delta-seconds form. Checked first because it is the common one, and
  // because Date.parse accepts some bare numbers on some runtimes.
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000

  // ★ Matched strictly before parsing, because `Date.parse` is far more
  // lenient than the specification: it reads "-5" as a date in 2001 and "1.5"
  // as one in January 2001. Both are already past, so a garbage header would
  // resolve to "retry immediately" — the most damaging possible reading of an
  // instruction to slow down.
  //
  // This is RFC 9110's required IMF-fixdate. The two obsolete date formats are
  // not accepted; they fall back to our own backoff, which is the safe
  // direction to be wrong in.
  if (!IMF_FIXDATE.test(trimmed)) return null

  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null

  return Math.max(0, at - now)
}

/**
 * What to do next, given the policy and anything the provider said.
 *
 * ★ A provider asking for longer than we are willing to wait is answered by
 * **giving up rather than by waiting less.** Retrying earlier than we were
 * told is precisely the behaviour that turns throttling into a ban, and
 * sleeping for the hour a provider asked for would leave a plan silently
 * stalled. Stopping, and recording what was asked, is the only honest option
 * of the three.
 */
export type RetryDelay =
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'give_up'; readonly askedForMs: number }

/**
 * How long to wait before the next attempt, or whether to stop.
 *
 * @param options - The failed attempt number, the policy, anything the
 *   provider asked for, and an injectable source of randomness.
 * @returns A wait, or a decision to stop.
 */
export function nextRetryDelay(options: {
  readonly attempt: number
  readonly policy: RetryPolicy
  readonly retryAfterMs?: number | null | undefined
  readonly random?: (() => number) | undefined
}): RetryDelay {
  const asked = options.retryAfterMs

  if (asked !== null && asked !== undefined) {
    if (asked > options.policy.maxMs) return { kind: 'give_up', askedForMs: asked }
    return { kind: 'wait', ms: asked }
  }

  return { kind: 'wait', ms: backoffDelayMs(options.attempt, options.policy, options.random) }
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
 * @returns Milliseconds to wait, never above `maxMs`.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const uncapped = policy.baseMs * 2 ** (attempt - 1)
  const ceiling = Math.min(uncapped, policy.maxMs)

  return Math.floor(random() * ceiling)
}
