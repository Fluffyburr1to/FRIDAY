import {
  isTerminalPlanStatus,
  PLAN_STATUSES,
  PLAN_STEP_STATUSES,
  PlanSchema,
  PlanStepSchema,
  RISK_CLASSES,
  RiskClassSchema,
  TERMINAL_PLAN_STATUSES,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

function aPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidv7(),
    principalId: 'usr_tyler',
    intent: 'remind Sarah about the budget',
    status: 'draft',
    correlationId: uuidv7(),
    createdAt: 1_754_467_200_000,
    updatedAt: 1_754_467_200_000,
    completedAt: null,
    budgetTokens: 50_000,
    budgetCents: 200,
    spentTokens: 0,
    spentCents: 0,
    ...overrides,
  }
}

function aPlanStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidv7(),
    planId: uuidv7(),
    principalId: 'usr_tyler',
    sequence: 1,
    status: 'pending',
    actionType: 'calendar.event.create',
    actionPayload: { title: 'Budget review' },
    riskClass: 'medium',
    approvalId: null,
    agentId: null,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    idempotencyKey: 'plan-1-step-1',
    ...overrides,
  }
}

describe('PlanSchema', () => {
  it('accepts a well-formed plan', () => {
    expect(PlanSchema.safeParse(aPlan()).success).toBe(true)
  })

  it('allows an unbudgeted plan but never an unspent-count one', () => {
    // Null budget means "no ceiling set yet". Null *spend* would mean the
    // running total is unknown, which is how a budget stops being a bulkhead.
    expect(PlanSchema.safeParse(aPlan({ budgetTokens: null, budgetCents: null })).success).toBe(
      true,
    )
    expect(PlanSchema.safeParse(aPlan({ spentCents: null })).success).toBe(false)
  })

  it('requires the intent in the owner’s own words', () => {
    expect(PlanSchema.safeParse(aPlan({ intent: '' })).success).toBe(false)
  })

  it('rejects a status outside the closed set', () => {
    expect(PlanSchema.safeParse(aPlan({ status: 'paused' })).success).toBe(false)
  })

  it('rejects negative spend', () => {
    expect(PlanSchema.safeParse(aPlan({ spentCents: -1 })).success).toBe(false)
  })
})

describe('PlanStepSchema', () => {
  it('accepts a well-formed step', () => {
    expect(PlanStepSchema.safeParse(aPlanStep()).success).toBe(true)
  })

  it('requires an idempotency key on every step', () => {
    // Without it, resuming after a crash between "sent the email" and
    // "recorded that we sent it" sends the email twice.
    const { idempotencyKey: _dropped, ...withoutKey } = aPlanStep()

    expect(PlanStepSchema.safeParse(withoutKey).success).toBe(false)
    expect(PlanStepSchema.safeParse(aPlanStep({ idempotencyKey: '' })).success).toBe(false)
  })

  it('requires a risk class, so nothing reaches the Guardian unclassified', () => {
    const { riskClass: _dropped, ...withoutRisk } = aPlanStep()

    expect(PlanStepSchema.safeParse(withoutRisk).success).toBe(false)
  })

  it('numbers steps from 1', () => {
    expect(PlanStepSchema.safeParse(aPlanStep({ sequence: 0 })).success).toBe(false)
  })

  it('keeps self_modification distinct from critical', () => {
    // Chapter 08 forbids approving one from a mobile client and Chapter 19
    // caps how long a grant covering one may live. Folding it into `critical`
    // would lose both restrictions silently.
    expect(RISK_CLASSES).toContain('self_modification')
    expect(RiskClassSchema.safeParse('self_modification').success).toBe(true)
  })
})

describe('isTerminalPlanStatus', () => {
  it('treats completed, failed, and cancelled as terminal', () => {
    for (const status of TERMINAL_PLAN_STATUSES) {
      expect(isTerminalPlanStatus(status)).toBe(true)
    }
  })

  it('treats awaiting_approval as live, however long it waits', () => {
    // A plan can sit here for days. Article III is only practical because
    // waiting costs nothing, so this must never be treated as finished.
    expect(isTerminalPlanStatus('awaiting_approval')).toBe(false)
    expect(isTerminalPlanStatus('draft')).toBe(false)
    expect(isTerminalPlanStatus('running')).toBe(false)
  })

  it('classifies every declared status one way or the other', () => {
    for (const status of PLAN_STATUSES) {
      expect(typeof isTerminalPlanStatus(status)).toBe('boolean')
    }
    expect(new Set(PLAN_STEP_STATUSES).size).toBe(PLAN_STEP_STATUSES.length)
  })
})
