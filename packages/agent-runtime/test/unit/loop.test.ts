import {
  type AgentStep,
  createMediator,
  type OutputValidator,
  openSpendLedger,
  runAgent,
  type StepIntent,
} from '@friday/agent-runtime'
import type { Actor, AgentManifest, GuardianDecision, RiskClass } from '@friday/contracts'
import { ok, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The execution loop.
 *
 * The assertions worth having are about **ending**: an agent that finishes,
 * an agent that is stopped, and — the one the architecture rests on — an agent
 * that returns rather than waits.
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }

function aManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: 'self-check',
    department: 'operations',
    description: 'Checks that FRIDAY is internally consistent.',
    capabilities: ['diagnostics.run'],
    connectors: [],
    input: 'SelfCheckRequest',
    output: 'SelfCheckResult',
    budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 3 },
    model: { capability: 'reasoning.fast', sensitivity: 'internal' },
    riskClasses: ['low'],
    ...overrides,
  }
}

function guardianSaying(answer: Partial<GuardianDecision> = {}) {
  return () =>
    ok({
      id: uuidv7(),
      decision: 'allow',
      reason: 'policy_allowed',
      riskClass: 'low' as RiskClass,
      matched: ['agents-may-run-diagnostics'],
      summary: 'allowed',
      ...answer,
    } as GuardianDecision)
}

function mediatorSaying(answer: Partial<GuardianDecision> = {}, manifest = aManifest()) {
  return createMediator({
    manifest,
    actor: AGENT,
    principalId: 'usr_owner',
    authorize: guardianSaying(answer),
  })
}

const ASK: StepIntent = {
  kind: 'request',
  request: {
    capability: 'diagnostics.run',
    action: 'diagnostics.self-check.run',
    resource: 'diagnostics:self-check/all',
    because: 'to confirm the record is intact',
  },
}

const ACCEPTS: OutputValidator = () => ({ ok: true })
const REJECTS: OutputValidator = () => ({ ok: false, problem: 'missing "checked"' })

describe('an invocation that finishes', () => {
  it('returns the output once it validates', async () => {
    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => ({ kind: 'finish', output: { checked: true } }),
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('completed')
    if (result.kind === 'completed') expect(result.output).toEqual({ checked: true })
  })

  it('hands each request outcome back to the agent for its next turn', async () => {
    const seen: (string | undefined)[] = []

    const step: AgentStep = (previous) => {
      seen.push(previous?.kind)
      return seen.length < 3 ? ASK : { kind: 'finish', output: {} }
    }

    await runAgent({ manifest: aManifest(), mediator: mediatorSaying(), step, validate: ACCEPTS })

    expect(seen).toEqual([undefined, 'allowed', 'allowed'])
  })
})

describe('output validation', () => {
  it('★ retries exactly once, then terminates', async () => {
    // ★ Chapter 11: one retry with the error fed back, because models correct
    // their own format errors reliably given the error and not at all given
    // silence. A second failure is terminal — malformed output must never
    // reach the database, the owner, or another agent.
    let finishes = 0

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => {
        finishes++
        return { kind: 'finish', output: { wrong: true } }
      },
      validate: REJECTS,
    })

    expect(finishes).toBe(2)
    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.reason).toBe('output_invalid')
  })

  it('accepts a corrected second attempt', async () => {
    let attempt = 0

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => {
        attempt++
        return { kind: 'finish', output: { attempt } }
      },
      validate: (_name, output) =>
        (output as { attempt: number }).attempt > 1
          ? { ok: true }
          : { ok: false, problem: 'first try' },
    })

    expect(result.kind).toBe('completed')
  })

  it('never lets invalid output escape as a completion', async () => {
    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => ({ kind: 'finish', output: { wrong: true } }),
      validate: REJECTS,
    })

    expect(result.kind).not.toBe('completed')
  })
})

describe('an approval ends the invocation', () => {
  it('★ suspends rather than waiting, and stops asking', async () => {
    // ★ The property the whole design rests on. If the agent waited, a thread
    // and an expensive model context would be held open for days.
    let turns = 0

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying({ decision: 'needs_approval' }),
      step: () => {
        turns++
        return ASK
      },
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('suspended')
    expect(turns).toBe(1)
    if (result.kind === 'suspended') {
      expect(result.suspension.because).toBe('to confirm the record is intact')
    }
  })

  it('records what was spent up to the suspension', async () => {
    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying({ decision: 'needs_approval' }),
      step: () => ASK,
      validate: ACCEPTS,
    })

    expect(result.spend.toolCalls).toBe(1)
  })
})

describe('resuming', () => {
  it('★ continues the ledger it was given rather than starting fresh', async () => {
    // ★ Otherwise an agent suspended near its ceiling comes back with a full
    // budget, and a plan could be walked past its limit one approval at a time.
    const ledger = openSpendLedger({ budget: aManifest().budget })
    ledger.record({ cents: 10 })

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => ({ kind: 'finish', output: {} }),
      validate: ACCEPTS,
      ledger,
    })

    expect(result.spend.cents).toBe(10)
  })

  it('★ terminates immediately when resumed already over budget', async () => {
    let turns = 0
    const ledger = openSpendLedger({ budget: aManifest().budget })
    ledger.record({ cents: 999 })

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => {
        turns++
        return ASK
      },
      validate: ACCEPTS,
      ledger,
    })

    expect(result.kind).toBe('terminated')
    expect(turns).toBe(0)
  })
})

describe('budgets end the loop', () => {
  it('★ stops once the tool-call ceiling is passed', async () => {
    const result = await runAgent({
      manifest: aManifest({
        budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 2 },
      }),
      mediator: mediatorSaying(),
      step: () => ASK,
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.reason).toBe('budget_exhausted')
  })

  it('★ checks the budget after the last step, not only before the next', async () => {
    // ★ A budget checked only before the next iteration lets the final step run
    // over and then reports success — an invocation that exceeded its ceiling
    // and is recorded as having stayed inside it.
    let at = 0
    const result = await runAgent({
      manifest: aManifest({
        budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 50, maxToolCalls: 10 },
      }),
      mediator: mediatorSaying(),
      step: () => {
        at += 100
        return { kind: 'finish', output: {} }
      },
      validate: ACCEPTS,
      now: () => at,
    })

    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.reason).toBe('budget_exhausted')
  })

  it('says which ceiling stopped it, in the owner’s terms', async () => {
    const result = await runAgent({
      manifest: aManifest({
        budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 1 },
      }),
      mediator: mediatorSaying(),
      step: () => ASK,
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.because).toContain('1 times')
  })
})

describe('a manifest breach ends the loop', () => {
  it('★ terminates and stops calling the agent', async () => {
    let turns = 0

    const result = await runAgent({
      manifest: aManifest(),
      mediator: mediatorSaying(),
      step: () => {
        turns++
        return { kind: 'request', request: { ...ASK.request, capability: 'memory.write' } }
      },
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.reason).toBe('capability_not_declared')
    expect(turns).toBe(1)
  })

  it('reports a Guardian outage as a failure, not as the agent misbehaving', async () => {
    const result = await runAgent({
      manifest: aManifest(),
      mediator: {
        mediate: () => ({ kind: 'unavailable', because: 'the policy store is gone' }),
      },
      step: () => ASK,
      validate: ACCEPTS,
    })

    expect(result.kind).toBe('failed')
  })
})
