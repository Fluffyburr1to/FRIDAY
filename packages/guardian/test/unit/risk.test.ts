import { RISK_CLASSES } from '@friday/contracts'
import { isAtLeastAsRiskyAs, RISK_RANK } from '@friday/guardian'
import { describe, expect, it } from 'vitest'

describe('risk ordering', () => {
  it('ranks every declared class, so none is silently unordered', () => {
    // A class added to the enum without a rank would compare as undefined and
    // every comparison involving it would be quietly wrong.
    for (const riskClass of RISK_CLASSES) {
      expect(typeof RISK_RANK[riskClass]).toBe('number')
    }

    expect(new Set(Object.values(RISK_RANK)).size).toBe(RISK_CLASSES.length)
  })

  it('orders low < medium < high < critical < self_modification', () => {
    expect(isAtLeastAsRiskyAs('medium', 'low')).toBe(true)
    expect(isAtLeastAsRiskyAs('high', 'medium')).toBe(true)
    expect(isAtLeastAsRiskyAs('critical', 'high')).toBe(true)
    expect(isAtLeastAsRiskyAs('self_modification', 'critical')).toBe(true)
    expect(isAtLeastAsRiskyAs('low', 'medium')).toBe(false)
  })

  it('treats a class as at least as risky as itself', () => {
    for (const riskClass of RISK_CLASSES) {
      expect(isAtLeastAsRiskyAs(riskClass, riskClass)).toBe(true)
    }
  })

  it('puts self_modification above critical rather than beside it', () => {
    // ADR-0025 requires only "at least critical". Placing it at the top is the
    // reading that cannot fail in the permissive direction.
    expect(isAtLeastAsRiskyAs('self_modification', 'critical')).toBe(true)
    expect(isAtLeastAsRiskyAs('critical', 'self_modification')).toBe(false)
  })
})
