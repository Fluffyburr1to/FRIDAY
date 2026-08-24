import { createRateLimiter } from '@friday/connector-sdk'
import { describe, expect, it } from 'vitest'

const LIMITS = { requestsPerMinute: 60, burstSize: 10 } as const

/** 60/minute is one per second, which keeps the arithmetic below readable. */
const PER_TOKEN_MS = 1_000

describe('the burst', () => {
  it('lets the declared burst through immediately', () => {
    const limiter = createRateLimiter(LIMITS)

    for (let i = 0; i < LIMITS.burstSize; i++) {
      expect(limiter.take(0), `request ${i + 1} of the burst`).toMatchObject({ allowed: true })
    }
  })

  it('stops at the burst, rather than one past it', () => {
    const limiter = createRateLimiter(LIMITS)
    for (let i = 0; i < LIMITS.burstSize; i++) limiter.take(0)

    expect(limiter.take(0).allowed).toBe(false)
  })

  it('says how long to wait, rather than only saying no', () => {
    // ★ Chapter 14: the limit is enforced BEFORE the request. A caller that
    // only learned "no" would have to guess, and guessing is how you discover
    // a provider's limit by being throttled by it.
    const limiter = createRateLimiter(LIMITS)
    for (let i = 0; i < LIMITS.burstSize; i++) limiter.take(0)

    expect(limiter.take(0).retryAfterMs).toBe(PER_TOKEN_MS)
  })

  it('rounds the wait up, never down', () => {
    // Answering even a fraction of a millisecond early sends the request back
    // into a bucket that is still empty — a busy-wait against someone else's
    // server. Half a millisecond of refill leaves 999.5ms owed, and the only
    // safe answer is 1000.
    const limiter = createRateLimiter(LIMITS)
    for (let i = 0; i < LIMITS.burstSize; i++) limiter.take(0)

    expect(limiter.take(0.5).retryAfterMs).toBe(1_000)
  })

  it('reports nothing to wait for when it is allowed', () => {
    expect(createRateLimiter(LIMITS).take(0)).toEqual({ allowed: true, retryAfterMs: 0 })
  })
})

describe('refilling', () => {
  it('earns one more request per interval', () => {
    const limiter = createRateLimiter(LIMITS)
    for (let i = 0; i < LIMITS.burstSize; i++) limiter.take(0)

    expect(limiter.take(PER_TOKEN_MS - 1).allowed).toBe(false)
    expect(limiter.take(PER_TOKEN_MS).allowed).toBe(true)
  })

  it('accumulates partial time rather than discarding it', () => {
    // Two half-intervals must add up to one request. A limiter that dropped
    // the remainder would be quietly stricter than the manifest declares.
    const limiter = createRateLimiter(LIMITS)
    for (let i = 0; i < LIMITS.burstSize; i++) limiter.take(0)

    limiter.take(PER_TOKEN_MS / 2)
    expect(limiter.take(PER_TOKEN_MS).allowed).toBe(true)
  })

  it('never banks more than the burst, however long it idles', () => {
    // ★ Otherwise an hour of quiet becomes a 3,600-request stampede the
    // moment FRIDAY wakes up — which is the exact behaviour a provider bans
    // an application for.
    const limiter = createRateLimiter(LIMITS)
    const anHour = 60 * 60 * 1_000

    // The first call only starts the clock, so the idle hour has to come
    // after it. Without this the bucket never refills at all and the cap is
    // never the thing under test.
    limiter.take(0)

    let allowed = 0
    while (limiter.take(anHour).allowed) allowed++

    expect(allowed).toBe(LIMITS.burstSize)
  })

  it('reports how much is available without spending it', () => {
    const limiter = createRateLimiter(LIMITS)

    expect(limiter.tokensAt(0)).toBe(LIMITS.burstSize)
    expect(limiter.tokensAt(0)).toBe(LIMITS.burstSize)
    expect(limiter.take(0).allowed).toBe(true)
    expect(limiter.tokensAt(0)).toBe(LIMITS.burstSize - 1)
  })
})

describe('limits that are not the convenient one', () => {
  it('handles a rate slower than one per second', () => {
    const limiter = createRateLimiter({ requestsPerMinute: 6, burstSize: 1 })

    expect(limiter.take(0).allowed).toBe(true)
    expect(limiter.take(0).retryAfterMs).toBe(10_000)
    expect(limiter.take(10_000).allowed).toBe(true)
  })

  it('handles a burst of one, which is the strictest a manifest may declare', () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, burstSize: 1 })

    expect(limiter.take(0).allowed).toBe(true)
    expect(limiter.take(0).allowed).toBe(false)
  })

  it('is unmoved by a clock that steps backwards', () => {
    // ★ Clocks do step backwards — NTP correction, a laptop waking in another
    // timezone. An unguarded bucket treats the negative interval as real and
    // destroys its own tokens, leaving the connector throttled long after the
    // clock is right again. Asserting on the balance rather than on one
    // allow/deny is what makes the two behaviours distinguishable at all.
    const limiter = createRateLimiter(LIMITS)
    limiter.take(10_000)
    const before = limiter.tokensAt(10_000)

    limiter.take(0)

    expect(limiter.tokensAt(10_000)).toBe(before - 1)
  })
})
