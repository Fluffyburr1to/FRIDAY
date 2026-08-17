import {
  isAwaitingOwner,
  isTerminalPlanStatus,
  PLAN_STATUSES,
  PLAN_STEP_STATUSES,
  PlanSchema,
  PlanStepSchema,
  RISK_CLASSES,
  RiskClassSchema,
  STEP_FAILURE_ACTIONS,
  StepFailureActionSchema,
  TERMINAL_PLAN_STATUSES,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

function aPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidv7(),
    principalId: 'usr_tyler',
    utterance: 'remind Sarah about the budget',
    intent: { kind: 'communications.remind', confidence: 0.9, entities: {}, ambiguities: [] },
    rationale: 'One reminder, to one person, about one thing.',
    explanation: null,
    status: 'draft',
    correlationId: uuidv7(),
    createdAt: 1_754_467_200_000,
    updatedAt: 1_754_467_200_000,
    completedAt: null,
    budgetTokens: 50_000,
    budgetCents: 200,
    budgetDeadlineMs: null,
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
    dependsOn: [],
    description: 'Put the budget review on the calendar.',
    status: 'pending',
    actionType: 'calendar.event.create',
    actionPayload: { title: 'Budget review' },
    department: 'communications',
    riskClass: 'medium',
    onFailure: 'ask_user',
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

  it('requires the owner’s own words, and a structured reading beside them', () => {
    // ★ ADR-0045 §1: both, and neither substitutes for the other. An
    // explanation has to be able to quote him rather than quote a model's
    // restatement of him.
    expect(PlanSchema.safeParse(aPlan({ utterance: '' })).success).toBe(false)
    expect(PlanSchema.safeParse(aPlan({ intent: 'remind Sarah' })).success).toBe(false)
  })

  it('requires a rationale, because an unexplained plan cannot be approved', () => {
    const { rationale: _dropped, ...withoutRationale } = aPlan()

    expect(PlanSchema.safeParse(withoutRationale).success).toBe(false)
    expect(PlanSchema.safeParse(aPlan({ rationale: '' })).success).toBe(false)
  })

  it('leaves the explanation empty until there is something to explain', () => {
    expect(PlanSchema.safeParse(aPlan({ explanation: null })).success).toBe(true)
    expect(PlanSchema.safeParse(aPlan({ explanation: 'She did the thing.' })).success).toBe(true)
  })

  it('distinguishes approving the shape from approving a step mid-flight', () => {
    // ★ "May I begin?" and "may I continue?" are different questions.
    expect(PlanSchema.safeParse(aPlan({ status: 'awaiting_plan_approval' })).success).toBe(true)
    expect(isAwaitingOwner('awaiting_plan_approval')).toBe(true)
    expect(isAwaitingOwner('awaiting_approval')).toBe(true)
    expect(isAwaitingOwner('running')).toBe(false)
  })

  it('allows a plan with no deadline', () => {
    // Article III's "survive waiting days" outranks a wall-clock ceiling: a
    // plan waiting on the owner must not die of old age.
    expect(PlanSchema.safeParse(aPlan({ budgetDeadlineMs: null })).success).toBe(true)
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

  it('requires a plain-language description', () => {
    // It is what the owner reads when approving. A step that cannot describe
    // itself cannot be approved meaningfully.
    const { description: _dropped, ...withoutDescription } = aPlanStep()

    expect(PlanStepSchema.safeParse(withoutDescription).success).toBe(false)
    expect(PlanStepSchema.safeParse(aPlanStep({ description: '' })).success).toBe(false)
  })

  it('requires a department, because routing is deterministic', () => {
    const { department: _dropped, ...withoutDepartment } = aPlanStep()

    expect(PlanStepSchema.safeParse(withoutDepartment).success).toBe(false)
  })

  it('★ requires a failure action, and supplies no default', () => {
    // ★ ADR-0045 §5. A planner that did not decide has produced an invalid
    // plan. If this ever grows a default, the requirement has been removed
    // rather than satisfied — Article VII asks for failure behaviour decided
    // in advance, and a default decides it for everyone in advance instead.
    const { onFailure: _dropped, ...withoutAction } = aPlanStep()

    expect(PlanStepSchema.safeParse(withoutAction).success).toBe(false)
    expect(PlanStepSchema.safeParse(aPlanStep({ onFailure: 'improvise' })).success).toBe(false)

    for (const action of STEP_FAILURE_ACTIONS) {
      expect(StepFailureActionSchema.safeParse(action).success).toBe(true)
      expect(PlanStepSchema.safeParse(aPlanStep({ onFailure: action })).success).toBe(true)
    }
  })

  it('carries a dependency graph, empty for a step that waits on nothing', () => {
    const first = uuidv7()

    expect(PlanStepSchema.safeParse(aPlanStep({ dependsOn: [] })).success).toBe(true)
    expect(PlanStepSchema.safeParse(aPlanStep({ dependsOn: [first] })).success).toBe(true)
  })

  it('rejects a dependency that is not a step id', () => {
    expect(PlanStepSchema.safeParse(aPlanStep({ dependsOn: ['step-2'] })).success).toBe(false)
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
