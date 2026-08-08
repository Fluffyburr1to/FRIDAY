import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Actor } from '@friday/contracts'
import {
  type CapabilityIssuer,
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  createInMemoryCapabilityStore,
  createInMemoryGrantStore,
  createPolicySet,
  type GrantRegistry,
  type Guardian,
  loadPolicySet,
  type PolicySet,
} from '@friday/guardian'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The four layers together, against the rules the owner actually ships.
 *
 * This is the file to read to understand what FRIDAY will and will not do.
 */

const POLICY_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../policies')
const DAY_MS = 24 * 60 * 60 * 1000
const START = 1_700_000_000_000

const AGENT: Actor = { type: 'agent', id: 'agent:communications/send' }
const OWNER: Actor = { type: 'user', id: 'usr_tyler' }

const SEND = {
  action: 'connector.gmail.message.send',
  resource: 'connector:gmail/messages/draft-1',
}

let policies: PolicySet
let clock: number
let capabilities: CapabilityIssuer
let grants: GrantRegistry
let guardian: Guardian

beforeAll(() => {
  const loaded = loadPolicySet(POLICY_DIR)
  if (!loaded.ok) throw new Error(`the shipped policies do not load: ${loaded.error.message}`)
  policies = loaded.value
})

beforeEach(() => {
  clock = START

  const issuer = createCapabilityIssuer({
    store: createInMemoryCapabilityStore(),
    keys: { getKey: () => ({ ok: true, value: Buffer.alloc(32, 3) }) },
    now: () => clock,
  })
  if (!issuer.ok) throw new Error('expected an issuer')
  capabilities = issuer.value

  grants = createGrantRegistry({ store: createInMemoryGrantStore(), now: () => clock })
  guardian = createGuardian({ policies, capabilities, grants, now: () => clock })
})

/** A ticket for exactly the action under test. */
function ticket(action = SEND.action, resource = SEND.resource, actor = AGENT): string {
  const issued = capabilities.issue({
    principalId: 'usr_tyler',
    issuedTo: actor,
    action,
    resource,
  })
  if (!issued.ok) throw new Error(`fixture ticket failed: ${issued.error.message}`)
  return issued.value.token
}

describe('layer 1 — who is asking', () => {
  it('refuses an actor that does not name itself properly', () => {
    // An agent inventing an identity is the realistic failure. `nonexistent`
    // with no department is not something the audit trail could ever resolve.
    const decision = guardian.authorize({
      actor: { type: 'agent', id: 'whoever' },
      principalId: 'usr_tyler',
      ...SEND,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
    expect(decision.value.reason).toBe('actor_unknown')
  })

  it('refuses a question it cannot make sense of', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      action: 'not a valid action',
      resource: SEND.resource,
    })

    expect(decision.ok).toBe(false)
  })
})

describe('layer 2 — the ticket', () => {
  it('refuses an agent acting with no ticket at all', () => {
    const decision = guardian.authorize({ actor: AGENT, principalId: 'usr_tyler', ...SEND })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
    expect(decision.value.reason).toBe('capability_required')
  })

  it('does not require one of the owner', () => {
    // Article III governs what FRIDAY does unattended, not what you do.
    const decision = guardian.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'memory.write',
      resource: 'memory:notes/today',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('allow')
  })

  it('refuses a ticket issued for something else, before consulting the rules', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket('memory.read', 'memory:contacts/sarah-chen'),
      ...SEND,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.reason).toBe('capability_scope_mismatch')
    expect(decision.value.matchedPolicies).toEqual([])
  })

  it('records which ticket was used when one was', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket('memory.read', 'memory:contacts/sarah-chen'),
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('allow')
    expect(decision.value.capabilityId).not.toBeNull()
  })
})

describe('layers 3 and 4 — the rules, and what they cost you', () => {
  it('asks before an agent sends a message, and says why in your words', () => {
    // M2's demonstrable outcome.
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(),
      ...SEND,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return

    expect(decision.value.decision).toBe('needs_approval')
    expect(decision.value.riskClass).toBe('high')
    expect(decision.value.matchedPolicies).toContain('connector-sends-need-approval')
    expect(decision.value.summary).toContain('cannot be unsent')
  })

  it('refuses an action nobody has classified, and names it', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket('thermostat.temperature.set', 'home:thermostat/hallway'),
      action: 'thermostat.temperature.set',
      resource: 'home:thermostat/hallway',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
    expect(decision.value.reason).toBe('no_policy_matched')
    expect(decision.value.summary).toContain('thermostat.temperature.set')
  })

  it('refuses to move money, for anyone', () => {
    const decision = guardian.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'finance.bank.transfer',
      resource: 'finance:accounts/checking',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
    expect(decision.value.reason).toBe('policy_denied')
  })

  it('mentions how many other rules applied', () => {
    const decision = guardian.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'guardian.policy.write',
      resource: 'guardian:policies/00-defaults',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.summary).toContain('1 other rule also applied')
  })

  it('pluralises when several other rules applied', () => {
    // Against a purpose-built rule set rather than the shipped one: no real
    // action is currently covered by four rules, and padding the owner's
    // policy files to exercise a sentence would be the wrong fix.
    const built = createPolicySet(
      ['a', 'b', 'c', 'd'].map((id) => ({
        id: `rule-${id}`,
        description: 'A rule that covers writing to a connected service.',
        effect: id === 'd' ? 'deny' : 'allow',
        riskClass: 'medium',
        when: { action: 'connector.*.write' },
      })),
    )
    if (!built.ok) throw new Error('fixture policy set is invalid')

    const decision = createGuardian({
      policies: built.value,
      capabilities,
      grants,
      now: () => clock,
    }).authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'connector.gmail.write',
      resource: 'connector:gmail/labels/inbox',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.summary).toContain('3 other rules also applied')
  })

  it('says nothing about other rules when only one applied', () => {
    // The sentence is shown to a person. "(0 other rules also applied.)" is
    // the kind of detail that makes an explanation read like a log line.
    // An agent, so that the broad "anything you do yourself" rule does not
    // also match and make this two.
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket('finance.bank.transfer', 'finance:accounts/checking'),
      action: 'finance.bank.transfer',
      resource: 'finance:accounts/checking',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.matchedPolicies).toEqual(['money-is-never-moved'])
    expect(decision.value.summary).not.toContain('also applied')
    expect(decision.value.summary).toContain('does not move money')
  })
})

describe('standing permissions in the whole flow', () => {
  function grantWrites(overrides: Record<string, unknown> = {}) {
    const created = grants.create({
      principalId: 'usr_tyler',
      actionPattern: 'connector.*.write',
      resourcePattern: 'connector:gmail/**',
      riskClass: 'medium',
      reason: 'Labelling my own inbox is fine.',
      expiresAt: START + 30 * DAY_MS,
      ...overrides,
    })
    if (!created.ok) throw new Error(`fixture grant rejected: ${created.error.message}`)
    return created.value
  }

  const WRITE = {
    action: 'connector.gmail.write',
    resource: 'connector:gmail/labels/inbox',
  }

  it('lets a permission you gave in advance stand in for asking', () => {
    const grant = grantWrites()

    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(WRITE.action, WRITE.resource),
      ...WRITE,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('allow')
    expect(decision.value.reason).toBe('standing_grant_applied')
    expect(decision.value.standingGrantId).toBe(grant.id)
    expect(decision.value.summary).toContain('Labelling my own inbox is fine')
  })

  it('counts the use, so you can see it was used', () => {
    const grant = grantWrites({ maxUses: 1 })

    guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(WRITE.action, WRITE.resource),
      ...WRITE,
    })

    const listed = grants.list('usr_tyler')
    if (!listed.ok) throw new Error('expected a listing')

    const [after] = listed.value.filter((g) => g.id === grant.id)
    expect(after?.uses).toBe(1)

    // Spent. The next one asks.
    const second = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(WRITE.action, WRITE.resource),
      ...WRITE,
    })

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.decision).toBe('needs_approval')
  })

  it('leaves the question standing when the rule offered no exemption', () => {
    // The permission is wide enough on paper — it matches the action, the
    // resource, and the risk class. It still does not help, because the rule
    // that asked for approval does not offer an exemption at all. This is the
    // mechanism behind "no standing permission covers a critical action":
    // there is no special case for it anywhere, those rules simply say
    // nothing about standing permissions.
    grants.create({
      principalId: 'usr_tyler',
      actionPattern: 'guardian.grant.*',
      resourcePattern: 'guardian:**',
      riskClass: 'high',
      reason: 'Let FRIDAY set up her own standing permissions.',
      expiresAt: START + 30 * DAY_MS,
    })

    const decision = guardian.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'guardian.grant.create',
      resource: 'guardian:grants/new',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('needs_approval')
    expect(decision.value.reason).toBe('approval_required')
  })

  it('never lets one cover a change to the rules themselves', () => {
    // Chapter 19's first absolute rule, end to end. The permission matches the
    // action and the resource, and the answer is still "ask me".
    grants.create({
      principalId: 'usr_tyler',
      actionPattern: 'guardian.policy.*',
      resourcePattern: 'guardian:**',
      riskClass: 'high',
      reason: 'An over-broad permission the owner should never be able to give.',
      expiresAt: START + 30 * DAY_MS,
    })

    const decision = guardian.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'guardian.policy.write',
      resource: 'guardian:policies/00-defaults',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('needs_approval')
    expect(decision.value.riskClass).toBe('critical')
  })

  it('says so when your permission does not stretch far enough', () => {
    grantWrites({ constraints: { maxAmountCents: 100 } })

    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(WRITE.action, WRITE.resource),
      context: { amountCents: 5_000 },
      ...WRITE,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.reason).toBe('standing_grant_insufficient')
    expect(decision.value.summary).toContain('does not stretch this far')
  })

  it('lets a standing refusal beat a rule that would have allowed it', () => {
    grants.create({
      principalId: 'usr_tyler',
      negative: true,
      actionPattern: 'memory.read',
      resourcePattern: 'memory:contacts/**',
      riskClass: 'low',
      reason: 'Stop reading my contacts.',
      expiresAt: START + 30 * DAY_MS,
    })

    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket('memory.read', 'memory:contacts/sarah-chen'),
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
    expect(decision.value.reason).toBe('standing_grant_denied')
    expect(decision.value.summary).toContain('Stop reading my contacts')
  })
})

describe('every decision is recordable', () => {
  it('carries a plain sentence and the request it answered', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: ticket(),
      ...SEND,
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return

    const recorded = decision.value
    expect(recorded.summary.length).toBeGreaterThan(0)
    expect(recorded.action).toBe(SEND.action)
    expect(recorded.resource).toBe(SEND.resource)
    expect(recorded.actor).toEqual(AGENT)
    expect(recorded.decidedAt).toBe(START)
  })

  it('uses the wall clock when none is injected', () => {
    const live = createGuardian({ policies, capabilities, grants })

    const decision = live.authorize({
      actor: OWNER,
      principalId: 'usr_tyler',
      action: 'memory.write',
      resource: 'memory:notes/today',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decidedAt).toBeLessThanOrEqual(Date.now())
  })
})
