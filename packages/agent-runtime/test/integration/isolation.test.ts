import { join } from 'node:path'
import { createMediator, runAgent, startIsolatedAgent } from '@friday/agent-runtime'
import type { Actor, AgentManifest, GuardianDecision, RiskClass } from '@friday/contracts'
import { ok, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * ★ Worker isolation — what an agent can physically reach.
 *
 * The mediator decides what FRIDAY will do on an agent's behalf. This decides
 * what the agent's own code can touch, and the two are not interchangeable:
 * without isolation the mediator would faithfully refuse to fetch a URL for an
 * agent, and nothing would stop the agent calling `fetch` itself.
 *
 * These run real worker threads against real fixture agents, because that is
 * the only way to know the scope is actually stripped. A unit test with a fake
 * worker would assert what the bootstrap *intends*.
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }
const FIXTURES = new URL('../fixtures', import.meta.url).pathname

function aManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: 'self-check',
    department: 'operations',
    description: 'Checks that FRIDAY is internally consistent.',
    capabilities: ['diagnostics.run'],
    connectors: [],
    input: 'SelfCheckRequest',
    output: 'SelfCheckResult',
    budget: { maxTokens: 8000, maxCents: 15, maxDurationMs: 30_000, maxToolCalls: 4 },
    model: { capability: 'reasoning.fast', sensitivity: 'internal' },
    riskClasses: ['low'],
    ...overrides,
  }
}

function allowingMediator(manifest = aManifest()) {
  return createMediator({
    manifest,
    actor: AGENT,
    principalId: 'usr_owner',
    // Cast through `unknown`: this is a stand-in for a Guardian answer, and
    // the point of these tests is the isolation boundary rather than the
    // decision. The real Guardian is exercised in tests/constitutional.
    authorize: () =>
      ok({
        id: uuidv7(),
        decision: 'allow',
        reason: 'policy_allowed',
        riskClass: 'low' as RiskClass,
        matched: ['agents-may-run-diagnostics'],
        summary: 'allowed',
        decidedAt: 0,
      } as unknown as GuardianDecision),
  })
}

/** Runs a fixture agent through the same loop every agent goes through. */
async function run(fixture: string, manifest = aManifest()) {
  const isolated = startIsolatedAgent({
    manifest,
    entry: join(FIXTURES, fixture),
    input: { requested: 'a self-check' },
  })

  try {
    return await runAgent({
      manifest,
      mediator: allowingMediator(manifest),
      step: isolated.step,
      validate: () => ({ ok: true }),
    })
  } finally {
    await isolated.dispose()
  }
}

describe('what an isolated agent cannot reach', () => {
  it('★ cannot reach the network, the filesystem, or a child process', async () => {
    // ★ THE test this package exists for. An agent that reaches for the
    // network gets a ReferenceError, not a connection — and the fixture
    // reports what actually happened rather than the test asserting a guess.
    const result = await run('reaches-for-the-network.cjs')

    expect(result.kind).toBe('completed')
    if (result.kind !== 'completed') return

    const { attempts } = result.output as { attempts: string[] }

    // ★ Asserted positively, not as an absence. `not.toContain` passes on an
    // empty array, so a fixture that crashed before trying anything would look
    // exactly like one that was properly refused — the same
    // passing-for-the-wrong-reason trap as a constitutional test with no
    // premise. Each attempt has to have been made, and to have been refused.
    expect(attempts).toEqual([
      'fetch: ReferenceError',
      'net: ReferenceError',
      'fs: ReferenceError',
      'child_process: ReferenceError',
      'env keys: 0',
    ])
  }, 20_000)

  it('★ sees an empty environment, so there are no credentials to find', async () => {
    // ★ The whole object goes, not the interesting keys. A partially emptied
    // environment invites probing for what survived.
    const result = await run('reaches-for-the-network.cjs')

    expect(result.kind).toBe('completed')
    if (result.kind !== 'completed') return

    const { attempts } = result.output as { attempts: string[] }

    expect(attempts).toContain('env keys: 0')
  }, 20_000)
})

describe('what an isolated agent can do', () => {
  it('asks, and is told what happened', async () => {
    const result = await run('asks-properly.cjs')

    expect(result.kind).toBe('completed')
    if (result.kind === 'completed') {
      expect(result.output).toMatchObject({ saw: 'allowed', input: { requested: 'a self-check' } })
    }
  }, 20_000)

  it('★ goes through the same loop, so the ledger still binds it', async () => {
    // ★ Isolation is exposed as a step function rather than as a second way to
    // run an agent. That is deliberate: the budget and the mediator are
    // enforced by the same code on the host side, and the constitutional
    // guarantee that the execution boundary obeys the ledger covers this path
    // too — rather than a second path existing beside it that nothing checks.
    const result = await run('asks-properly.cjs')

    expect(result.spend.toolCalls).toBe(1)
  }, 20_000)
})

describe('an agent that misuses the channel', () => {
  it('★ is terminated for a protocol violation, and never reaches the mediator', async () => {
    // ★ The worker is the untrusted side. A message that cannot be read as a
    // request is parsed and refused rather than cast and passed on — the
    // mediator must only ever see well-formed questions.
    const result = await run('breaks-the-protocol.cjs')

    expect(result.kind).toBe('terminated')
    if (result.kind === 'terminated') expect(result.reason).toBe('protocol_violation')
  }, 20_000)

  it('does not hang when an agent dies without answering', async () => {
    // A worker that exits silently is still an ending. Without that, the loop
    // would await a message that is never coming.
    const result = await run('does-not-exist.cjs')

    expect(result.kind).toBe('terminated')
  }, 20_000)
})
