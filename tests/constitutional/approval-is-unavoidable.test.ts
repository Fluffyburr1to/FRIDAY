import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Actor } from '@friday/contracts'
import {
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  createInMemoryCapabilityStore,
  createInMemoryGrantStore,
  type GrantRegistry,
  type Guardian,
  loadPolicySet,
  type PolicySet,
} from '@friday/guardian'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ CONSTITUTIONAL — Article III, and Chapter 19's eight absolute rules.
 *
 * These do not assert that a feature works. They assert that a founding
 * guarantee is enforced by the code, against the rules the owner actually
 * ships rather than against a fixture invented to make them pass.
 *
 * **When one of these fails, never adjust the test.** Either the code has
 * violated a founding guarantee — fix the code — or the guarantee itself needs
 * amending, which requires an ADR and the owner's deliberate decision. Chapter
 * 19 calls a violation a stop-the-line incident, and it means it.
 *
 * The five rules covered here are the ones the Guardian can enforce at
 * Milestone 2. The remaining three concern recording a decision in the audit
 * log and are asserted in `decisions-are-recorded.test.ts` once the audit
 * package lands.
 *
 * Reference: docs/00-foundation/constitution.md · docs/01-bible/19-approval-system.md
 */

const POLICY_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../packages/guardian/policies')

const DAY_MS = 24 * 60 * 60 * 1000
const START = 1_700_000_000_000

const AGENT: Actor = { type: 'agent', id: 'agent:communications/send' }
const OWNER: Actor = { type: 'user', id: 'usr_tyler' }

let policies: PolicySet
let clock: number
let grants: GrantRegistry
let guardian: Guardian
let issue: (action: string, resource: string) => string

beforeAll(() => {
  const loaded = loadPolicySet(POLICY_DIR)
  if (!loaded.ok) throw new Error(`the shipped policies do not load: ${loaded.error.message}`)
  policies = loaded.value
})

beforeEach(() => {
  clock = START

  const issuer = createCapabilityIssuer({
    store: createInMemoryCapabilityStore(),
    keys: { getKey: () => ({ ok: true, value: Buffer.alloc(32, 11) }) },
    now: () => clock,
  })
  if (!issuer.ok) throw new Error('expected a capability issuer')

  issue = (action, resource) => {
    const issued = issuer.value.issue({
      principalId: 'usr_tyler',
      issuedTo: AGENT,
      action,
      resource,
    })
    if (!issued.ok) throw new Error(`could not issue a capability: ${issued.error.message}`)
    return issued.value.token
  }

  grants = createGrantRegistry({ store: createInMemoryGrantStore(), now: () => clock })
  guardian = createGuardian({
    policies,
    capabilities: issuer.value,
    grants,
    now: () => clock,
  })
})

/** Asks the Guardian, with a valid ticket, and insists on getting an answer. */
function ask(action: string, resource: string, actor: Actor = AGENT) {
  const decision = guardian.authorize({
    actor,
    principalId: 'usr_tyler',
    action,
    resource,
    ...(actor.type === 'agent' ? { capability: issue(action, resource) } : {}),
  })

  if (!decision.ok) throw new Error(`the Guardian refused the question: ${decision.error.message}`)
  return decision.value
}

describe('Article III — nothing above routine happens without the owner', () => {
  it('never allows an action above low risk on policy alone', () => {
    // Chapter 19, rule 1. Every action the shipped rules classify above `low`
    // must come back as needing the owner, or as refused. An `allow` here
    // would mean something consequential proceeding unattended.
    const consequential = [
      ['memory.write', 'memory:notes/today'],
      ['memory.delete', 'memory:contacts/sarah-chen'],
      ['connector.gmail.write', 'connector:gmail/labels/inbox'],
      ['connector.gmail.message.send', 'connector:gmail/messages/draft-1'],
      ['connector.gmail.delete', 'connector:gmail/messages/1'],
      ['guardian.policy.write', 'guardian:policies/00-defaults'],
      ['guardian.grant.create', 'guardian:grants/new'],
      ['credential.gmail.write', 'credential:gmail/oauth'],
      ['system.config.write', 'system:config/friday'],
      ['engineering.change.merge', 'repo:friday/pull/12'],
      ['finance.bank.transfer', 'finance:accounts/checking'],
    ] as const

    for (const [action, resource] of consequential) {
      const decision = ask(action, resource)

      expect(
        decision.decision,
        `${action} came back as "${decision.decision}" with no approval`,
      ).not.toBe('allow')
      expect(decision.riskClass).not.toBe('low')
    }
  })

  it('refuses an action no rule has ever classified', () => {
    // Fail closed. An action nobody considered cannot be one the owner
    // consented to.
    const decision = ask('thermostat.temperature.set', 'home:thermostat/hallway')

    expect(decision.decision).toBe('deny')
    expect(decision.reason).toBe('no_policy_matched')
  })
})

describe('Chapter 19 rule 3 — a critical action never runs on a standing grant', () => {
  /**
   * Two independent things hold this up, and both are asserted, because either
   * one alone would let the other be removed unnoticed.
   *
   * 1. A grant covering `critical` or `self_modification` cannot be created at
   *    all — asserted under rule 5 below.
   * 2. The rules governing those actions offer no standing-grant exemption for
   *    a grant to take, even if one somehow existed.
   *
   * The second is defence in depth and **cannot be reached through the public
   * API**, precisely because the first prevents it. So it is asserted against
   * the rule set directly. An earlier version of this file tried to reach it
   * by creating the widest grant the system allows and checking the answer was
   * still "ask me" — that passed, and kept passing when the exemption was
   * added to a critical rule, because the grant was refused one layer earlier
   * for a different reason. A guarantee test that passes for the wrong reason
   * is worse than no test.
   */
  it('gives the rules governing critical actions nothing for a grant to take', () => {
    const exemptible = policies.policies.filter(
      (policy) =>
        (policy.riskClass === 'critical' || policy.riskClass === 'self_modification') &&
        policy.unless?.standingGrant === true,
    )

    expect(
      exemptible.map((policy) => policy.id),
      'a critical rule offers a standing-grant exemption',
    ).toEqual([])
  })

  it('still asks, with the widest permission the system can hold in place', () => {
    grants.create({
      principalId: 'usr_tyler',
      actionPattern: '*',
      resourcePattern: 'guardian:**',
      riskClass: 'high',
      reason: 'The widest standing permission this system can hold.',
      expiresAt: START + 30 * DAY_MS,
    })

    for (const [action, resource] of [
      ['guardian.policy.write', 'guardian:policies/00-defaults'],
      ['guardian.policy.delete', 'guardian:policies/20-never'],
    ] as const) {
      const decision = ask(action, resource, OWNER)

      expect(decision.decision).toBe('needs_approval')
      expect(decision.riskClass).toBe('critical')
    }
  })

  it('holds for credentials and for FRIDAY changing her own code', () => {
    grants.create({
      principalId: 'usr_tyler',
      actionPattern: '*',
      resourcePattern: 'credential:**',
      riskClass: 'high',
      reason: 'A permission the owner should not be able to give.',
      expiresAt: START + 30 * DAY_MS,
    })

    expect(ask('credential.gmail.write', 'credential:gmail/oauth').decision).toBe('needs_approval')
    expect(ask('engineering.change.merge', 'repo:friday/pull/12').decision).toBe('needs_approval')
  })
})

describe('Chapter 19 rule 5 — no standing grant exists without an expiry', () => {
  it('cannot be created without one', () => {
    const perpetual = grants.create({
      principalId: 'usr_tyler',
      actionPattern: 'connector.*.write',
      resourcePattern: 'connector:gmail/**',
      riskClass: 'medium',
      reason: 'Forever.',
      expiresAt: START,
    })

    expect(perpetual.ok).toBe(false)
  })

  it('cannot cover money or self-modification at any lifetime', () => {
    for (const riskClass of ['critical', 'self_modification'] as const) {
      const created = grants.create({
        principalId: 'usr_tyler',
        actionPattern: 'connector.*.write',
        resourcePattern: 'connector:gmail/**',
        riskClass,
        reason: 'Should be impossible.',
        expiresAt: START + DAY_MS,
      })

      expect(created.ok, `a ${riskClass} standing grant was accepted`).toBe(false)
    }
  })

  it('cannot say "FRIDAY may do anything"', () => {
    const abdication = grants.create({
      principalId: 'usr_tyler',
      actionPattern: '*',
      resourcePattern: '*',
      riskClass: 'medium',
      reason: 'Everything.',
      expiresAt: START + DAY_MS,
    })

    expect(abdication.ok).toBe(false)
  })
})

describe('Chapter 19 rule 6 — nothing but a rule assigns a risk class', () => {
  it('ignores a risk class an agent puts in the request', () => {
    // The anti-manipulation property. A confused or injected model claiming
    // that sending mail is harmless changes nothing, because its claim is
    // never consulted.
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      action: 'connector.gmail.message.send',
      resource: 'connector:gmail/messages/draft-1',
      capability: issue('connector.gmail.message.send', 'connector:gmail/messages/draft-1'),
      context: { riskClass: 'low', risk: 'none', trusted: true, approved: true },
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.riskClass).toBe('high')
    expect(decision.value.decision).toBe('needs_approval')
  })
})

describe('Article V — a captured agent cannot exceed its step', () => {
  it('refuses an agent acting with no permission slip', () => {
    const decision = guardian.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.value.decision).toBe('deny')
  })

  it('refuses a slip re-used for anything other than what it was issued for', () => {
    const slip = issue('memory.read', 'memory:contacts/sarah-chen')

    for (const [action, resource] of [
      ['memory.read', 'memory:contacts/alex'],
      ['memory.delete', 'memory:contacts/sarah-chen'],
      ['connector.gmail.message.send', 'connector:gmail/messages/draft-1'],
    ] as const) {
      const decision = guardian.authorize({
        actor: AGENT,
        principalId: 'usr_tyler',
        action,
        resource,
        capability: slip,
      })

      expect(decision.ok).toBe(true)
      if (!decision.ok) continue
      expect(decision.value.decision).toBe('deny')
      expect(decision.value.reason).toBe('capability_scope_mismatch')
    }
  })
})

describe('Article II — every decision can be read by the owner', () => {
  it('carries a plain-language reason, whatever the answer was', () => {
    const decisions = [
      ask('memory.read', 'memory:contacts/sarah-chen'),
      ask('connector.gmail.message.send', 'connector:gmail/messages/draft-1'),
      ask('finance.bank.transfer', 'finance:accounts/checking'),
      ask('thermostat.temperature.set', 'home:thermostat/hallway'),
    ]

    for (const decision of decisions) {
      expect(decision.summary.length).toBeGreaterThan(20)

      // No identifiers, no field names. The owner does not read code, and an
      // explanation they cannot read is not an explanation.
      expect(decision.summary).not.toMatch(/\b(riskClass|actorType|policyId|undefined|null)\b/)
      expect(decision.actor).toBeDefined()
      expect(decision.decidedAt).toBe(START)
    }
  })
})
