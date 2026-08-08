import {
  AuthorizationRequestSchema,
  DECISION_REASONS,
  DECISIONS,
  DecisionReasonSchema,
  DecisionSchema,
  GuardianDecisionSchema,
  permits,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

function validRequest(overrides: Record<string, unknown> = {}): unknown {
  return {
    actor: { type: 'agent', id: 'agent:communications/draft-email' },
    principalId: 'usr_tyler',
    action: 'memory.read',
    resource: 'memory:contacts/sarah-chen',
    ...overrides,
  }
}

function validDecision(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: uuidv7(),
    decision: 'needs_approval',
    reason: 'approval_required',
    riskClass: 'high',
    matchedPolicies: ['connector-write-requires-approval'],
    approvalId: uuidv7(),
    standingGrantId: null,
    capabilityId: null,
    summary: 'Sending mail requires your approval, because it cannot be undone.',
    actor: { type: 'agent', id: 'agent:communications/draft-email' },
    principalId: 'usr_tyler',
    action: 'connector.gmail.message.send',
    resource: 'connector:gmail/messages/draft-1',
    planId: null,
    planStepId: null,
    correlationId: null,
    decidedAt: 1_000,
    ...overrides,
  }
}

describe('the three answers', () => {
  it('is a closed set', () => {
    expect([...DECISIONS]).toEqual(['allow', 'deny', 'needs_approval'])
    expect(DecisionSchema.safeParse('maybe').success).toBe(false)
  })

  it('permits only allow', () => {
    // `needs_approval` is not permission. A caller that treated it as one
    // would act before the owner answered, which is the failure this whole
    // milestone exists to prevent.
    expect(permits({ decision: 'allow' })).toBe(true)
    expect(permits({ decision: 'needs_approval' })).toBe(false)
    expect(permits({ decision: 'deny' })).toBe(false)
  })
})

describe('decision reasons', () => {
  it('is a closed set with no duplicates', () => {
    expect(new Set(DECISION_REASONS).size).toBe(DECISION_REASONS.length)
    expect(DecisionReasonSchema.safeParse('because').success).toBe(false)
  })

  it('tells a forged capability apart from an expired one', () => {
    // Different incidents. An audit trail that collapses them cannot tell the
    // owner whether someone constructed a token or replayed a real one.
    for (const reason of ['capability_forged', 'capability_expired', 'capability_revoked']) {
      expect(DecisionReasonSchema.safeParse(reason).success).toBe(true)
    }
  })
})

describe('the request', () => {
  it('accepts the minimum a caller must supply', () => {
    expect(AuthorizationRequestSchema.safeParse(validRequest()).success).toBe(true)
  })

  it('accepts a fully specified request', () => {
    const parsed = AuthorizationRequestSchema.safeParse(
      validRequest({
        capability: `fct_v1.${uuidv7()}.${'a'.repeat(43)}`,
        planId: uuidv7(),
        planStepId: uuidv7(),
        correlationId: uuidv7(),
        context: { amountCents: 500 },
      }),
    )

    expect(parsed.success).toBe(true)
  })

  it('refuses a pattern where a concrete action or resource belongs', () => {
    expect(AuthorizationRequestSchema.safeParse(validRequest({ action: 'memory.*' })).success).toBe(
      false,
    )
    expect(
      AuthorizationRequestSchema.safeParse(validRequest({ resource: 'memory:*' })).success,
    ).toBe(false)
  })

  it('refuses a request with no principal', () => {
    expect(AuthorizationRequestSchema.safeParse(validRequest({ principalId: '' })).success).toBe(
      false,
    )
  })
})

describe('the recorded decision', () => {
  it('accepts a complete decision', () => {
    expect(GuardianDecisionSchema.safeParse(validDecision()).success).toBe(true)
  })

  it('requires a summary the owner could read', () => {
    expect(GuardianDecisionSchema.safeParse(validDecision({ summary: '' })).success).toBe(false)
  })

  it('records every matched policy, including none', () => {
    expect(
      GuardianDecisionSchema.safeParse(
        validDecision({
          decision: 'deny',
          reason: 'no_policy_matched',
          matchedPolicies: [],
          approvalId: null,
        }),
      ).success,
    ).toBe(true)

    expect(
      GuardianDecisionSchema.safeParse(validDecision({ matchedPolicies: ['a', 'b', 'c'] })).success,
    ).toBe(true)
  })

  it('refuses a risk class an agent invented', () => {
    expect(GuardianDecisionSchema.safeParse(validDecision({ riskClass: 'harmless' })).success).toBe(
      false,
    )
  })
})
