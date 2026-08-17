import { describeExceeded, openSpendLedger } from '@friday/agent-runtime'
import type { AgentBudget } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The per-invocation ceilings.
 *
 * ★ The defence against the most plausible expensive failure in FRIDAY: an
 * agent loop calling a model thousands of times overnight. Every assertion
 * here is about **stopping**, never about warning, because a loop that is
 * warned and continues is still a loop.
 */

function aBudget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return { maxTokens: 1000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 3, ...overrides }
}

/** A clock a test drives, so wall-clock limits do not need real waiting. */
function aClock(start = 0) {
  let at = start
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

describe('the spend ledger', () => {
  it('starts at nothing used', () => {
    const ledger = openSpendLedger({ budget: aBudget() })

    expect(ledger.spend).toEqual({ tokens: 0, cents: 0, durationMs: 0, toolCalls: 0 })
    expect(ledger.exceeded()).toBeUndefined()
  })

  it('stops on tokens', () => {
    const ledger = openSpendLedger({ budget: aBudget({ maxTokens: 100 }) })

    ledger.record({ tokens: 101 })

    expect(ledger.exceeded()).toBe('tokens')
  })

  it('stops on money', () => {
    const ledger = openSpendLedger({ budget: aBudget({ maxCents: 10 }) })

    ledger.record({ cents: 11 })

    expect(ledger.exceeded()).toBe('cents')
  })

  it('stops on wall-clock', () => {
    const clock = aClock()
    const ledger = openSpendLedger({ budget: aBudget({ maxDurationMs: 1000 }), now: clock.now })

    clock.advance(1001)

    expect(ledger.exceeded()).toBe('duration')
  })

  it('★ counts a denied request against the tool-call ceiling', () => {
    // ★ A denied call still cost a model round trip to produce. Counting only
    // the permitted ones would let an agent that is being refused loop for
    // free — and "keeps asking and keeps being refused" is exactly the shape a
    // manipulated agent takes.
    const ledger = openSpendLedger({ budget: aBudget({ maxToolCalls: 2 }) })

    ledger.record({})
    ledger.record({})
    ledger.record({})

    expect(ledger.exceeded()).toBe('toolCalls')
  })

  it('is inside its ceiling at exactly the limit', () => {
    // The limit is what it may use, not what it may not reach.
    const ledger = openSpendLedger({ budget: aBudget({ maxTokens: 100 }) })

    ledger.record({ tokens: 100 })

    expect(ledger.exceeded()).toBeUndefined()
  })

  it('reports the first dimension that went over, in a stable order', () => {
    const ledger = openSpendLedger({ budget: aBudget({ maxTokens: 10, maxCents: 1 }) })

    ledger.record({ tokens: 100, cents: 100 })

    expect(ledger.exceeded()).toBe('tokens')
  })

  it('keeps recording spend after a ceiling is passed', () => {
    // ★ The record must stay truthful past the limit. Clamping would lose the
    // number the owner needs when asking what it actually cost.
    const ledger = openSpendLedger({ budget: aBudget({ maxCents: 5 }) })

    ledger.record({ cents: 10 })
    ledger.record({ cents: 10 })

    expect(ledger.spend.cents).toBe(20)
  })

  it('explains which ceiling stopped it, in money and seconds', () => {
    const budget = aBudget({ maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 6 })

    expect(describeExceeded('cents', budget)).toContain('$0.15')
    expect(describeExceeded('duration', budget)).toContain('30 seconds')
    expect(describeExceeded('toolCalls', budget)).toContain('6 times')
    expect(describeExceeded('tokens', budget)).toContain('1,000')
  })
})
