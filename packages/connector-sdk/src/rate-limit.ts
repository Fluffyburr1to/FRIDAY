import type { ConnectorManifest } from '@friday/contracts'

/**
 * The token bucket every connector's requests pass through.
 *
 * ★ Chapter 14: rate limiting is *"enforced before the request. FRIDAY does
 * not discover limits by being throttled."* That sentence is the whole design.
 * Learning a provider's limit by hitting it means the request that taught you
 * was refused, and a provider that sees a burst of refused requests does not
 * conclude the client is well behaved.
 *
 * Deliberately pure and clock-injected: no timers, no async, no state beyond
 * the bucket. That is what lets an hour of behaviour be tested in a
 * microsecond, and it means the limiter cannot be the reason a test is flaky.
 *
 * Reference: docs/01-bible/14-connector-framework.md
 */

const MS_PER_MINUTE = 60_000

export interface RateLimits {
  readonly requestsPerMinute: number
  readonly burstSize: number
}

export interface RateLimitDecision {
  readonly allowed: boolean

  /** How long until one is available. `0` when the request may go now. */
  readonly retryAfterMs: number
}

export interface RateLimiter {
  /** Takes one if there is one. Consumes only when it answers `allowed`. */
  take(now: number): RateLimitDecision

  /** How many are available, without spending any. For diagnostics. */
  tokensAt(now: number): number
}

/**
 * Builds a token bucket from a manifest's declared limits.
 *
 * Starts full, so a connector's first burst is the burst it declared rather
 * than a cold start the owner would experience as FRIDAY being slow.
 *
 * @param limits - `requestsPerMinute` and `burstSize`, from the manifest.
 * @returns A limiter holding those limits.
 */
export function createRateLimiter(limits: RateLimits): RateLimiter {
  const perMs = limits.requestsPerMinute / MS_PER_MINUTE

  let tokens = limits.burstSize
  let lastRefill = Number.NEGATIVE_INFINITY

  /**
   * Brings the bucket up to date.
   *
   * ★ Clamped at the previous reading, so a clock that steps backwards mints
   * nothing. Left unguarded, a backward step is a way to get unlimited
   * requests out of a bucket — and clocks do step backwards, on NTP
   * correction and on a laptop waking in another timezone.
   */
  function refill(now: number): void {
    if (lastRefill === Number.NEGATIVE_INFINITY) {
      lastRefill = now
      return
    }

    const elapsed = now - lastRefill
    if (elapsed <= 0) return

    tokens = Math.min(limits.burstSize, tokens + elapsed * perMs)
    lastRefill = now
  }

  return {
    take(now: number): RateLimitDecision {
      refill(now)

      if (tokens >= 1) {
        tokens -= 1
        return { allowed: true, retryAfterMs: 0 }
      }

      // Rounded up: answering a millisecond early would send the request back
      // into a bucket that is still empty, which is a busy-wait against
      // someone else's server.
      return { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / perMs) }
    },

    tokensAt(now: number): number {
      refill(now)
      return tokens
    },
  }
}

/**
 * Builds the limiter a manifest asks for.
 *
 * @param manifest - The connector's manifest.
 * @returns A limiter holding that connector's declared limits.
 */
export function rateLimiterFor(manifest: ConnectorManifest): RateLimiter {
  return createRateLimiter(manifest.rateLimits)
}
