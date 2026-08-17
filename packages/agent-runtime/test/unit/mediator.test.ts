import { createMediator, type ToolRequest } from '@friday/agent-runtime'
import type {
  Actor,
  AgentManifest,
  FridayError,
  GuardianDecision,
  Result,
  RiskClass,
} from '@friday/contracts'
import { err, fridayError, ok, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The mediator is the security boundary, so these are written as guarantees
 * rather than as branch coverage.
 *
 * The recurring assertion is **that the Guardian was never asked** when the
 * manifest already settled it. A test that only checked the returned outcome
 * would pass on an implementation that consulted the Guardian first and then
 * discarded the answer — which would put a question in front of the owner that
 * the agent had no business raising.
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }

function aManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: 'self-check',
    department: 'operations',
    description: 'Checks that FRIDAY is internally consistent.',
    capabilities: ['diagnostics.run', 'model.invoke'],
    connectors: [],
    input: 'SelfCheckRequest',
    output: 'SelfCheckResult',
    budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 6 },
    model: { capability: 'reasoning.fast', sensitivity: 'internal' },
    riskClasses: ['low'],
    ...overrides,
  }
}

function aRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    capability: 'diagnostics.run',
    action: 'diagnostics.self-check.run',
    resource: 'diagnostics:self-check/all',
    because: 'to confirm the record is intact',
    ...overrides,
  }
}

/** A Guardian that records every question and answers as told. */
function aGuardian(answer: Partial<GuardianDecision> = {}) {
  const asked: { action: string; resource: string }[] = []

  const authorize = (input: {
    action: string
    resource: string
  }): Result<GuardianDecision, FridayError> => {
    asked.push({ action: input.action, resource: input.resource })

    return ok({
      id: uuidv7(),
      decision: 'allow',
      reason: 'policy_allowed',
      riskClass: 'low' as RiskClass,
      matched: ['agents-may-run-diagnostics'],
      summary: 'allowed',
      ...answer,
    } as GuardianDecision)
  }

  return { authorize, asked }
}

describe('the manifest is checked before the Guardian', () => {
  it('★ terminates an agent using a capability it did not declare', () => {
    // ★ Terminated, not denied. An agent reaching outside its own manifest is
    // malfunctioning or has been manipulated, and both mean stop it rather
    // than say no and let it try something else.
    const guardian = aGuardian()
    const mediator = createMediator({
      manifest: aManifest({ capabilities: ['diagnostics.run'] }),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest({ capability: 'memory.write' }))

    expect(outcome.kind).toBe('terminate')
    if (outcome.kind === 'terminate') expect(outcome.reason).toBe('capability_not_declared')

    // ★ The assertion that matters: the Guardian was never asked. A manifest
    // breach must not become an ordinary permission question.
    expect(guardian.asked).toEqual([])
  })

  it('★ terminates an agent reaching for a connector it did not declare', () => {
    const guardian = aGuardian()
    const mediator = createMediator({
      manifest: aManifest({ capabilities: ['diagnostics.run'], connectors: [] }),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest({ connector: 'gmail' }))

    expect(outcome.kind).toBe('terminate')
    if (outcome.kind === 'terminate') expect(outcome.reason).toBe('connector_not_declared')
    expect(guardian.asked).toEqual([])
  })

  it('lets a declared capability through to the Guardian', () => {
    const guardian = aGuardian()
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest())

    expect(outcome.kind).toBe('allowed')
    expect(guardian.asked).toHaveLength(1)
  })
})

describe('the risk ceiling an agent declared', () => {
  it('★ terminates when a decision lands above the declared ceiling', () => {
    // ★ Even though the Guardian would have asked the owner. A low-only agent
    // that provokes a high classification had no business getting there, and
    // surfacing it as an approval would let a manipulated agent choose what
    // the owner is asked about.
    const guardian = aGuardian({ decision: 'needs_approval', riskClass: 'high' })
    const mediator = createMediator({
      manifest: aManifest({ riskClasses: ['low'] }),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest())

    expect(outcome.kind).toBe('terminate')
    if (outcome.kind === 'terminate') expect(outcome.reason).toBe('risk_class_exceeded')
  })

  it('allows a decision at exactly the declared ceiling', () => {
    const guardian = aGuardian({ decision: 'allow', riskClass: 'medium' })
    const mediator = createMediator({
      manifest: aManifest({ riskClasses: ['low', 'medium'] }),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    expect(mediator.mediate(aRequest()).kind).toBe('allowed')
  })

  it('reads the ceiling as the highest class declared, not as a list to match', () => {
    // A manifest declaring ['low', 'high'] permits medium too. The field is a
    // ceiling; treating it as an exact set would refuse a decision that is
    // strictly less risky than one already declared.
    const guardian = aGuardian({ decision: 'allow', riskClass: 'medium' })
    const mediator = createMediator({
      manifest: aManifest({ riskClasses: ['low', 'high'] }),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    expect(mediator.mediate(aRequest()).kind).toBe('allowed')
  })
})

describe('an approval suspends rather than waits', () => {
  it('★ returns a suspension carrying what the owner must decide', () => {
    // ★ The agent does not block. If it did, a worker thread and an expensive
    // model context would be held open for what may be days, and the pressure
    // to add a timeout that proceeds anyway would be constant.
    const guardian = aGuardian({ decision: 'needs_approval', riskClass: 'low' })
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest({ because: 'to compact the log' }))

    expect(outcome.kind).toBe('suspended')
    if (outcome.kind === 'suspended') {
      expect(outcome.suspension.action).toBe('diagnostics.self-check.run')
      expect(outcome.suspension.because).toBe('to compact the log')
    }
  })
})

describe('failing closed', () => {
  it('★ stops when the Guardian cannot answer, and does not blame the agent', () => {
    // ★ A Guardian that cannot answer is not a Guardian that said yes. But the
    // agent did nothing wrong, so this is `unavailable` rather than a
    // termination — "your assistant misbehaved" and "FRIDAY's permission
    // system is down" are different incidents with different fixes.
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: () =>
        err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'the policy store is gone' })),
    })

    const outcome = mediator.mediate(aRequest())

    expect(outcome.kind).toBe('unavailable')
  })

  it('reports a denial as a denial, which an agent may survive', () => {
    // Distinct from termination: the agent asked something reasonable and was
    // told no. It may carry on and try something else.
    const guardian = aGuardian({ decision: 'deny', reason: 'no_policy_matched' })
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: guardian.authorize,
    })

    expect(mediator.mediate(aRequest()).kind).toBe('denied')
  })

  it('never performs an effect itself, whatever the answer', () => {
    // The mediator answers questions. It has no way to act, which is why
    // "an agent can only ask" holds even if a caller ignores the answer.
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: aGuardian().authorize,
    })

    expect(Object.keys(mediator)).toEqual(['mediate'])
  })
})
