import {
  type BreakerPolicy,
  createCircuitBreaker,
  DEFAULT_BREAKER_POLICY,
  tripsBreaker,
} from '@friday/connector-sdk'
import { ERROR_CODES, type ErrorCode, type FridayError, fridayError } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const POLICY: BreakerPolicy = DEFAULT_BREAKER_POLICY
const { failureThreshold: THRESHOLD, openMs: OPEN_MS } = POLICY

function fail(code: ErrorCode): FridayError {
  return fridayError({ code, message: 'x' })
}

/** Drives `n` consecutive failures at the given moment. */
function failTimes(breaker: ReturnType<typeof createCircuitBreaker>, n: number, at = 0): void {
  for (let i = 0; i < n; i++) breaker.recordFailure(at)
}

describe("Chapter 14's numbers", () => {
  it('uses five failures and sixty seconds by default', () => {
    expect(DEFAULT_BREAKER_POLICY).toEqual({ failureThreshold: 5, openMs: 60_000 })
  })
})

describe('while the service is answering', () => {
  it('starts closed and lets everything through', () => {
    const breaker = createCircuitBreaker(POLICY)

    expect(breaker.stateAt(0)).toBe('closed')
    expect(breaker.attempt(0)).toBe(true)
  })

  it('stays closed one failure short of the threshold', () => {
    const breaker = createCircuitBreaker(POLICY)

    failTimes(breaker, THRESHOLD - 1)

    expect(breaker.stateAt(0)).toBe('closed')
    expect(breaker.attempt(0)).toBe(true)
  })

  it('counts consecutive failures, not total ones', () => {
    // ★ Four failures and a success is a service having a rough time, not a
    // service that is down. A counter that only decremented would eventually
    // open the circuit on a service that works.
    const breaker = createCircuitBreaker(POLICY)

    for (let round = 0; round < 5; round++) {
      failTimes(breaker, THRESHOLD - 1)
      breaker.recordSuccess(0)
    }

    expect(breaker.stateAt(0)).toBe('closed')
  })
})

describe('when it gives up', () => {
  it('opens on the threshold failure, not the one after', () => {
    const breaker = createCircuitBreaker(POLICY)

    failTimes(breaker, THRESHOLD)

    expect(breaker.stateAt(0)).toBe('open')
  })

  it('refuses immediately rather than making the caller wait', () => {
    // A caller waiting 30 seconds to be told what the last twenty callers
    // were already told is a caller doing nothing useful.
    const breaker = createCircuitBreaker(POLICY)
    failTimes(breaker, THRESHOLD)

    expect(breaker.attempt(0)).toBe(false)
  })

  it('stays open for the full wait, to the millisecond', () => {
    const breaker = createCircuitBreaker(POLICY)
    failTimes(breaker, THRESHOLD)

    expect(breaker.stateAt(OPEN_MS - 1)).toBe('open')
    expect(breaker.stateAt(OPEN_MS)).toBe('half_open')
  })

  it('does not keep counting while it is open', () => {
    const breaker = createCircuitBreaker(POLICY)
    failTimes(breaker, THRESHOLD)

    failTimes(breaker, 100)

    // Still exactly one wait from the moment it opened, not a hundred more.
    expect(breaker.stateAt(OPEN_MS)).toBe('half_open')
  })
})

describe('finding out whether it is back', () => {
  function opened() {
    const breaker = createCircuitBreaker(POLICY)
    failTimes(breaker, THRESHOLD)
    return breaker
  }

  it('lets exactly one call through, and no more', () => {
    // ★ The reason `attempt` reserves rather than merely reporting. Every
    // caller waiting on an open circuit arrives at once the moment it
    // half-opens, and letting them all through is the stampede the open
    // circuit existed to prevent.
    const breaker = opened()

    expect(breaker.attempt(OPEN_MS)).toBe(true)
    expect(breaker.attempt(OPEN_MS)).toBe(false)
    expect(breaker.attempt(OPEN_MS + 1)).toBe(false)
  })

  it('closes when the probe succeeds', () => {
    const breaker = opened()
    breaker.attempt(OPEN_MS)

    breaker.recordSuccess(OPEN_MS)

    expect(breaker.stateAt(OPEN_MS)).toBe('closed')
    expect(breaker.attempt(OPEN_MS)).toBe(true)
  })

  it('forgets the old failures once it closes', () => {
    const breaker = opened()
    breaker.attempt(OPEN_MS)
    breaker.recordSuccess(OPEN_MS)

    // One more failure must not re-open it — the count started again.
    breaker.recordFailure(OPEN_MS)

    expect(breaker.stateAt(OPEN_MS)).toBe('closed')
  })

  it('re-opens for the full wait when the probe fails', () => {
    // Not a remainder of the old wait: the service just said it is still
    // broken, which is fresh information.
    const breaker = opened()
    breaker.attempt(OPEN_MS)

    breaker.recordFailure(OPEN_MS)

    expect(breaker.stateAt(OPEN_MS)).toBe('open')
    expect(breaker.stateAt(OPEN_MS + OPEN_MS - 1)).toBe('open')
    expect(breaker.stateAt(OPEN_MS + OPEN_MS)).toBe('half_open')
  })

  it('keeps probing once per wait for as long as it stays broken', () => {
    const breaker = opened()

    for (let round = 1; round <= 4; round++) {
      const at = OPEN_MS * round
      expect(breaker.attempt(at), `probe ${round}`).toBe(true)
      expect(breaker.attempt(at), `only one probe in round ${round}`).toBe(false)
      breaker.recordFailure(at)
    }

    expect(breaker.stateAt(OPEN_MS * 4)).toBe('open')
  })

  it('does not close early when the clock steps backwards', () => {
    const breaker = createCircuitBreaker(POLICY)
    failTimes(breaker, THRESHOLD, 10 * OPEN_MS)

    expect(breaker.stateAt(0)).toBe('open')
    expect(breaker.stateAt(10 * OPEN_MS + OPEN_MS - 1)).toBe('open')
  })
})

describe('whose fault it was', () => {
  it.each(['TIMEOUT', 'CONNECTOR_UNAVAILABLE'] as const)(
    'counts %s against the service',
    (code) => {
      expect(tripsBreaker(fail(code))).toBe(true)
    },
  )

  it('does not count our own refusal against the service', () => {
    // ★ EGRESS_BLOCKED means a manifest did not declare a host the connector
    // needs. Opening the circuit would present a configuration mistake as an
    // outage, and send the owner to read someone else's status page.
    expect(tripsBreaker(fail('EGRESS_BLOCKED'))).toBe(false)
  })

  it('does not count our own crash against the service', () => {
    expect(tripsBreaker(fail('CONNECTOR_FAULTED'))).toBe(false)
  })

  it('blames the provider for nothing else by default', () => {
    const blamed = ERROR_CODES.filter((code) => tripsBreaker(fail(code)))

    expect(blamed).toEqual(['TIMEOUT', 'CONNECTOR_UNAVAILABLE'])
  })
})
