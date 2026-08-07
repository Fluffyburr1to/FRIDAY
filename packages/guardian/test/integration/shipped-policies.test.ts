import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePolicies, loadPolicySet, type PolicySet } from '@friday/guardian'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The rules the owner actually ships, evaluated as they will be at runtime.
 *
 * These assertions are about *behaviour the owner chose*, not about the
 * engine. If one fails, either a rule file was edited or the engine changed
 * what an existing rule means — and both of those are things the owner needs
 * told about, in those terms.
 */

const POLICY_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../policies')

const NO_GRANT = { standingGrantApplies: false }
const GRANT = { standingGrantApplies: true }

const AGENT = { actorType: 'agent', actorId: 'agent:communications/send' }
const OWNER = { actorType: 'user', actorId: 'usr_tyler' }

let policies: PolicySet

beforeAll(() => {
  const result = loadPolicySet(POLICY_DIR)
  if (!result.ok) throw new Error(`the shipped policies do not load: ${result.error.message}`)
  policies = result.value
})

describe('the shipped rule set', () => {
  it('loads, and every rule explains itself in plain language', () => {
    expect(policies.policies.length).toBeGreaterThan(0)

    for (const policy of policies.policies) {
      expect(policy.description.length).toBeGreaterThan(20)
      expect(policy.description).not.toMatch(/\b(actorType|riskClass|regex|schema)\b/)
    }
  })
})

describe('what an agent may do unattended', () => {
  it('lets an agent read memory', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'memory.read', resource: 'memory:contacts/sarah-chen' },
      NO_GRANT,
    )

    expect(evaluation.effect).toBe('allow')
    expect(evaluation.riskClass).toBe('low')
  })

  it('asks before an agent sends a message to another person', () => {
    // M2's demonstrable outcome, in one assertion.
    const evaluation = evaluatePolicies(
      policies,
      {
        ...AGENT,
        action: 'connector.gmail.message.send',
        resource: 'connector:gmail/messages/draft-1',
      },
      NO_GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('high')
    expect(evaluation.deciding).toBe('connector-sends-need-approval')
  })

  it('asks before an agent forgets something', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'memory.delete', resource: 'memory:contacts/sarah-chen' },
      NO_GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('high')
  })

  it('refuses an action nobody has classified', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'thermostat.temperature.set', resource: 'home:thermostat/hallway' },
      NO_GRANT,
    )

    expect(evaluation.effect).toBeNull()
  })
})

describe('what a standing permission can and cannot cover', () => {
  it('lets a grant cover a routine connector write', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'connector.gmail.write', resource: 'connector:gmail/labels/inbox' },
      GRANT,
    )

    expect(evaluation.effect).toBe('allow')
    expect(evaluation.riskClass).toBe('medium')
  })

  it('never lets a grant cover a change to the rules themselves', () => {
    // Chapter 19's first absolute rule, expressed as the absence of an
    // `unless` clause rather than as a special case in code.
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'guardian.policy.write', resource: 'guardian:policies/20-never' },
      GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('critical')
  })

  it('never lets a grant cover a credential change', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'credential.gmail.write', resource: 'credential:gmail/oauth' },
      GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('critical')
  })

  it('never lets a grant cover FRIDAY changing her own code', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'engineering.change.merge', resource: 'repo:friday/pull/12' },
      GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('self_modification')
  })
})

describe('what is refused outright', () => {
  it('never moves money, for anyone, grant or no grant', () => {
    for (const actor of [AGENT, OWNER]) {
      for (const context of [NO_GRANT, GRANT]) {
        const evaluation = evaluatePolicies(
          policies,
          { ...actor, action: 'finance.bank.transfer', resource: 'finance:accounts/checking' },
          context,
        )

        expect(evaluation.effect).toBe('deny')
      }
    }
  })
})

describe('the owner acting directly', () => {
  it('is allowed to do ordinary things without being asked', () => {
    // The rules that ask about memory and connectors are scoped to agents, so
    // the owner editing their own notes is not interrupted to approve
    // themselves. Article IX — being asked to confirm your own keystroke is
    // the fastest route to a reflex tap.
    const evaluation = evaluatePolicies(
      policies,
      { ...OWNER, action: 'memory.write', resource: 'memory:notes/today' },
      NO_GRANT,
    )

    expect(evaluation.effect).toBe('allow')
    expect(evaluation.matched).toEqual(['owner-acts-directly'])
  })

  it('is asked before an agent does the same thing', () => {
    const evaluation = evaluatePolicies(
      policies,
      { ...AGENT, action: 'memory.write', resource: 'memory:notes/today' },
      NO_GRANT,
    )

    expect(evaluation.effect).toBe('require_approval')
  })

  it('is still asked to confirm a change to the rules', () => {
    // The broad "anything you do yourself" rule matches, and loses. Strictest
    // wins, so a permissive rule can never disarm a restrictive one.
    const evaluation = evaluatePolicies(
      policies,
      { ...OWNER, action: 'guardian.policy.write', resource: 'guardian:policies/00-defaults' },
      NO_GRANT,
    )

    expect(evaluation.matched).toContain('owner-acts-directly')
    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('critical')
  })
})
