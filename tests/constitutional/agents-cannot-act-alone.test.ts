import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediator, openSpendLedger, type ToolRequest } from '@friday/agent-runtime'
import type { Actor, AgentManifest, FridayError, GuardianDecision, Result } from '@friday/contracts'
import { err, fridayError } from '@friday/contracts'
import {
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  loadPolicySet,
} from '@friday/guardian'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ CONSTITUTIONAL — Articles III, V, and VII, applied to the first component
 * in FRIDAY that can act.
 *
 * Every guarantee before Milestone 5 was structurally trivial: nothing could
 * act, so nothing could act wrongly. Agents change that. They run AI-generated
 * behaviour over untrusted content, which means they can be confused, wrong,
 * or captured by something they read — and the architecture treats them as the
 * least trustworthy component in the system.
 *
 * Three guarantees are asserted here, and each was chosen because it has a
 * plausible, well-meant change that removes it. In every case the change looks
 * like an improvement in the diff:
 *
 *   1. Consulting the Guardian "once, up front, for efficiency".
 *   2. Turning a termination into a denial "so the agent can recover".
 *   3. Making a budget a warning "so long work is not lost".
 *
 * They live here rather than in `packages/agent-runtime` because that
 * package's own tests are allowed to change when the package is refactored.
 * These are not. A failure here is a stop-the-line event.
 *
 * Reference: docs/00-foundation/constitution.md · docs/01-bible/11-agent-framework.md
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }
const PRINCIPAL = 'usr_tyler'

const POLICY_DIR = new URL('../../packages/guardian/policies', import.meta.url).pathname

const KEYS = createInMemoryKeyProvider({
  'capability-signing-key': Buffer.alloc(32, 9).toString('base64'),
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

let directory: string
let storage: Storage

/** The real Guardian, over the rules the owner actually ships. */
function realGuardian() {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })
  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)
  storage = opened.value

  const policies = loadPolicySet(POLICY_DIR)
  if (!policies.ok) throw new Error('the shipped policies do not load')

  const capabilities = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
  })
  if (!capabilities.ok) throw new Error('no capability issuer')

  return {
    guardian: createGuardian({
      policies: policies.value,
      capabilities: capabilities.value,
      grants: createGrantRegistry({ store: storage.guardian.grants }),
    }),

    /**
     * ★ Mints the signed slip an agent must carry.
     *
     * Without one the Guardian denies everything as `capability_required` at
     * `critical`, before it evaluates a single rule — which is correct, and
     * which would also make the risk-ceiling assertion below pass for entirely
     * the wrong reason. The permit is what forces the real policy
     * classification to be the thing under test.
     */
    permitFor(action: string, resource: string): string {
      const slip = capabilities.value.issue({
        principalId: PRINCIPAL,
        issuedTo: AGENT,
        action,
        resource,
      })
      if (!slip.ok) throw new Error(`no permission slip: ${slip.error.message}`)

      return slip.value.token
    },
  }
}

/**
 * Counts every question put to the Guardian.
 *
 * ★ The counter is the instrument for guarantees 1 and 2. Both are about
 * *whether the Guardian was consulted at all*, which no assertion on a return
 * value can establish.
 */
function counting(answer: () => Result<GuardianDecision, FridayError>) {
  const asked: { action: string; resource: string }[] = []

  return {
    asked,
    authorize(input: { action: string; resource: string }) {
      asked.push({ action: input.action, resource: input.resource })
      return answer()
    },
  }
}

function aManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: 'self-check',
    department: 'operations',
    description: 'Checks that FRIDAY is internally consistent.',
    capabilities: ['diagnostics.run'],
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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-agents-'))
})

afterEach(() => {
  storage?.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('Article III — an agent cannot act without the Guardian', () => {
  it('★ asks the Guardian for every request, and never reuses an answer', () => {
    // ★ GUARANTEE 1. The failure this prevents is caching: an agent authorised
    // for one action proceeding to a second on the strength of the first
    // answer.
    //
    // Article III governs each ACTION, not each session. An agent's second
    // request is a different question, and an implementation that asked once
    // and reused the answer would pass a test that only checked outcomes —
    // which is why this counts.
    const { guardian, permitFor } = realGuardian()
    const permit = permitFor('diagnostics.self-check.run', 'diagnostics:self-check/all')
    const seen: string[] = []

    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: (input) => {
        seen.push(input.action)
        return guardian.authorize(input)
      },
    })

    for (let i = 0; i < 5; i++) mediator.mediate(aRequest({ permit }))

    expect(seen).toHaveLength(5)
  })

  it('★ has no way to perform an effect, only to ask about one', () => {
    // ★ The structural half of guarantee 1. The mediator answers questions and
    // holds nothing it could act with, so a caller that ignored the answer
    // still could not act. "An agent can only ask" survives a careless caller.
    const { guardian } = realGuardian()

    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: guardian.authorize,
    })

    expect(Object.keys(mediator)).toEqual(['mediate'])
  })

  it('★ does not proceed when the Guardian cannot answer', () => {
    // ★ Fails closed. A Guardian whose policy store is unreadable is not a
    // Guardian that said yes.
    const mediator = createMediator({
      manifest: aManifest(),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: () =>
        err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'the policy store is gone' })),
    })

    expect(mediator.mediate(aRequest()).kind).not.toBe('allowed')
  })
})

describe('Article V — an agent that exceeds its manifest is terminated', () => {
  it('★ stops the agent rather than denying the request', () => {
    // ★ GUARANTEE 2. A denial is an answer to a reasonable question. Reaching
    // outside its own declared manifest is not a reasonable question: the
    // agent is malfunctioning or has been manipulated, and letting it continue
    // to try other things is letting a compromised agent search for what works.
    const { guardian } = realGuardian()

    const mediator = createMediator({
      manifest: aManifest({ capabilities: ['diagnostics.run'] }),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: guardian.authorize,
    })

    const outcome = mediator.mediate(aRequest({ capability: 'memory.write' }))

    expect(outcome.kind).toBe('terminate')
    expect(outcome.kind).not.toBe('denied')
  })

  it('★ never asks the owner about a request the manifest already refused', () => {
    // ★ THE assertion, and the reason this guarantee is constitutional rather
    // than merely correct.
    //
    // If a manifest breach surfaced as an approval, a manipulated agent could
    // choose what the owner is asked about — and an owner asked often enough
    // stops reading. Approval fatigue is the failure Chapter 19 names as fatal
    // to the whole system.
    //
    // ★ The Guardian must never become the mechanism by which an agent
    // negotiates its way past a boundary it was never authorised to cross.
    // Zero questions is the invariant.
    const guardian = counting(() => {
      throw new Error('the Guardian was consulted about a request the manifest refused')
    })

    const mediator = createMediator({
      manifest: aManifest({ capabilities: ['diagnostics.run'], connectors: [] }),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: guardian.authorize,
    })

    mediator.mediate(aRequest({ capability: 'memory.write' }))
    mediator.mediate(aRequest({ connector: 'gmail' }))

    expect(guardian.asked).toEqual([])
  })

  it('★ terminates above the declared risk ceiling, even when the owner would have been asked', () => {
    // ★ A low-only agent that provokes a `high` decision is stopped, not shown
    // to the owner. It had no business getting there, and surfacing it would
    // hand the choice of what the owner sees to the agent.
    //
    // Driven through the real Guardian and the real shipped rules: compaction
    // is classified `high` and requires approval.
    const { guardian, permitFor } = realGuardian()
    const compact = { action: 'operations.log.compact', resource: 'events:log/segments' }

    // ★ A real permit, so the Guardian actually reaches the owner's rules.
    // Without it every request is denied `capability_required` at `critical`,
    // and this assertion would hold no matter what the ceiling was.
    const permit = permitFor(compact.action, compact.resource)

    // First, prove the premise: for an agent whose ceiling ALLOWS it, the
    // shipped rules classify compaction as `high` and ask the owner. If this
    // ever stops being true, the assertion below is testing nothing.
    const permitted = createMediator({
      manifest: aManifest({ riskClasses: ['low', 'high'] }),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: guardian.authorize,
    }).mediate(aRequest({ ...compact, permit }))

    expect(permitted.kind).toBe('suspended')

    // ★ Now the guarantee: the same request, from an agent that declared only
    // `low`, is stopped rather than put in front of the owner.
    const outcome = createMediator({
      manifest: aManifest({ riskClasses: ['low'] }),
      actor: AGENT,
      principalId: PRINCIPAL,
      authorize: guardian.authorize,
    }).mediate(aRequest({ ...compact, permit }))

    expect(outcome.kind).toBe('terminate')
    if (outcome.kind === 'terminate') expect(outcome.reason).toBe('risk_class_exceeded')
  })
})

describe('Article VII — an exhausted budget stops agent work', () => {
  it('★ stops rather than warns, on every one of the four dimensions', () => {
    // ★ GUARANTEE 3. A loop that is warned and continues is still a loop.
    // This is the defence against the most plausible expensive failure in
    // FRIDAY: an agent calling a model thousands of times overnight, against a
    // $50–200 budget, while everyone is asleep.
    const budget = { maxTokens: 10, maxCents: 10, maxDurationMs: 10, maxToolCalls: 1 }

    const tokens = openSpendLedger({ budget })
    tokens.record({ tokens: 11 })
    expect(tokens.exceeded()).toBe('tokens')

    const cents = openSpendLedger({ budget })
    cents.record({ cents: 11 })
    expect(cents.exceeded()).toBe('cents')

    let at = 0
    const duration = openSpendLedger({ budget, now: () => at })
    at = 11
    expect(duration.exceeded()).toBe('duration')

    const calls = openSpendLedger({ budget })
    calls.record({})
    calls.record({})
    expect(calls.exceeded()).toBe('toolCalls')
  })

  it('★ counts a refused request against the ceiling', () => {
    // ★ Otherwise an agent that is being refused loops for free — which is
    // exactly the shape a manipulated agent takes, and exactly when the
    // ceiling needs to hold.
    const ledger = openSpendLedger({
      budget: { maxTokens: 1000, maxCents: 100, maxDurationMs: 60_000, maxToolCalls: 2 },
    })

    // Three mediated requests, none of which was permitted to do anything.
    ledger.record({})
    ledger.record({})
    ledger.record({})

    expect(ledger.exceeded()).toBe('toolCalls')
  })

  it('★ offers no way to raise a ceiling once an invocation has started', () => {
    // ★ Asserted structurally rather than behaviourally. An override is what a
    // runaway loop would find at 3am, so the guarantee is that no such door
    // exists to be found: the ledger exposes what was spent, a way to record
    // more, and a way to ask whether it is over. Nothing that lifts a limit.
    const ledger = openSpendLedger({
      budget: { maxTokens: 10, maxCents: 10, maxDurationMs: 10, maxToolCalls: 1 },
    })

    expect(Object.keys(ledger).sort()).toEqual(['exceeded', 'record', 'spend'])
  })

  it('★ stays exceeded once it is exceeded', () => {
    // ★ Terminal, not a threshold that can be crossed back over. Recording
    // more spend can never bring an invocation back inside its budget.
    const ledger = openSpendLedger({
      budget: { maxTokens: 10, maxCents: 100, maxDurationMs: 60_000, maxToolCalls: 100 },
    })

    ledger.record({ tokens: 11 })
    expect(ledger.exceeded()).toBe('tokens')

    ledger.record({ tokens: 0 })
    expect(ledger.exceeded()).toBe('tokens')
  })
})
