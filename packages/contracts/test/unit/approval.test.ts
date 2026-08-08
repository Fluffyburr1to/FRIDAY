import {
  APPROVAL_STATUSES,
  type ApprovalRequest,
  ApprovalRequestSchema,
  ExplanationSchema,
  isTerminalApprovalStatus,
  PreviewSchema,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * A request that satisfies every rule, so each test can break exactly one
 * thing. Chapter 19's requirement is that an incomplete request cannot exist,
 * which is only testable against a complete one.
 */
function validRequest(overrides: Partial<ApprovalRequest> = {}): unknown {
  return {
    id: uuidv7(),
    principalId: 'usr_tyler',
    title: 'Send a follow-up email to Sarah Chen',
    riskClass: 'high',
    explanation: {
      what: 'Send the drafted message to sarah@example.com.',
      why: 'You asked me to follow up on the contract thread this morning.',
      confidence: 0.8,
      risks: ['Sending an email cannot be undone.'],
      alternatives: ['Save it as a draft instead.'],
    },
    preview: { kind: 'text', content: 'Hi Sarah — following up on the contract.' },
    impact: {
      reversible: false,
      dataLeavesDevice: true,
      dataCategories: ['correspondence'],
      estimatedCostCents: null,
    },
    actor: { type: 'agent', id: 'agent:communications/draft-email' },
    action: 'connector.gmail.message.send',
    resource: 'connector:gmail/messages/draft-1',
    planId: null,
    planStepId: null,
    correlationId: null,
    decisionId: uuidv7(),
    requiredAuth: 'biometric',
    createdAt: 1_000,
    expiresAt: 2_000,
    status: 'pending',
    respondedAt: null,
    respondedVia: null,
    responseReason: null,
    ...overrides,
  }
}

describe('the explanation block', () => {
  it('accepts a complete explanation', () => {
    expect(ApprovalRequestSchema.safeParse(validRequest()).success).toBe(true)
  })

  it('rejects an explanation with no risks listed', () => {
    // An empty list is not "no risks" — it is an agent that did not look.
    const parsed = ExplanationSchema.safeParse({
      what: 'Send it.',
      why: 'You asked.',
      confidence: 1,
      risks: [],
      alternatives: ['Do nothing.'],
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an explanation with no alternatives considered', () => {
    const parsed = ExplanationSchema.safeParse({
      what: 'Send it.',
      why: 'You asked.',
      confidence: 1,
      risks: ['Irreversible.'],
      alternatives: [],
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects empty what and why', () => {
    for (const field of ['what', 'why'] as const) {
      const parsed = ExplanationSchema.safeParse({
        what: 'Send it.',
        why: 'You asked.',
        confidence: 1,
        risks: ['Irreversible.'],
        alternatives: ['Do nothing.'],
        [field]: '',
      })

      expect(parsed.success).toBe(false)
    }
  })

  it('keeps confidence inside 0 to 1', () => {
    for (const confidence of [-0.1, 1.1]) {
      const parsed = ExplanationSchema.safeParse({
        what: 'Send it.',
        why: 'You asked.',
        confidence,
        risks: ['Irreversible.'],
        alternatives: ['Do nothing.'],
      })

      expect(parsed.success).toBe(false)
    }
  })

  it('rejects a request whose explanation is missing entirely', () => {
    const request = validRequest() as Record<string, unknown>
    request.explanation = undefined

    expect(ApprovalRequestSchema.safeParse(request).success).toBe(false)
  })
})

describe('the preview', () => {
  it('requires an artifact whenever it claims to have one', () => {
    for (const kind of ['text', 'diff', 'json', 'amount'] as const) {
      const parsed = ApprovalRequestSchema.safeParse(
        validRequest({ preview: { kind, content: '' } }),
      )

      expect(parsed.success).toBe(false)
    }
  })

  it('allows empty content only for kind none', () => {
    const parsed = ApprovalRequestSchema.safeParse(
      validRequest({ preview: { kind: 'none', content: '' } }),
    )

    expect(parsed.success).toBe(true)
  })

  it('accepts a preview on its own terms', () => {
    expect(PreviewSchema.safeParse({ kind: 'diff', content: '- a\n+ b' }).success).toBe(true)
    expect(PreviewSchema.safeParse({ kind: 'screenshot', content: 'x' }).success).toBe(false)
  })
})

describe('expiry', () => {
  it('requires a request to expire after it was created', () => {
    for (const expiresAt of [1_000, 999]) {
      expect(ApprovalRequestSchema.safeParse(validRequest({ expiresAt })).success).toBe(false)
    }
  })
})

describe('response consistency', () => {
  it('requires a resolved request to record when it was resolved', () => {
    // Time-to-decision is one of the two metrics Chapter 19 uses to detect
    // rubber-stamping, so a resolution with no timestamp is a hole in the
    // health data rather than a cosmetic omission.
    for (const status of ['approved', 'declined', 'expired', 'cancelled'] as const) {
      const parsed = ApprovalRequestSchema.safeParse(validRequest({ status, respondedAt: null }))

      expect(parsed.success).toBe(false)
    }
  })

  it('accepts a resolved request that records its time', () => {
    const parsed = ApprovalRequestSchema.safeParse(
      validRequest({
        status: 'approved',
        respondedAt: 1_500,
        respondedVia: 'desktop',
      }),
    )

    expect(parsed.success).toBe(true)
  })

  it('refuses a pending request that claims to have been answered', () => {
    const parsed = ApprovalRequestSchema.safeParse(
      validRequest({ status: 'pending', respondedAt: 1_500 }),
    )

    expect(parsed.success).toBe(false)
  })
})

describe('terminal statuses', () => {
  it('treats expiry as settled, because timeout means denied', () => {
    expect(isTerminalApprovalStatus('expired')).toBe(true)
  })

  it('treats only pending as open', () => {
    const open = APPROVAL_STATUSES.filter((status) => !isTerminalApprovalStatus(status))

    expect(open).toEqual(['pending'])
  })
})
