import { type Actor, uuidv7 } from '@friday/contracts'
import {
  createApprovalRegistry,
  createCapabilityIssuer,
  createGrantRegistry,
  createInMemoryApprovalStore,
  createInMemoryCapabilityStore,
  createInMemoryGrantStore,
  loadPolicySet,
} from '@friday/guardian'
import { describe, expect, it } from 'vitest'
import {
  approvalStoreFailing,
  breakableStore,
  capabilityStoreFailing,
  grantStoreFailing,
} from '../support/failing-stores.js'

/**
 * What happens when FRIDAY cannot reach her own records.
 *
 * ADR-0027's whole purpose. The property being asserted throughout is the
 * same one: **a storage failure never becomes a decision.** It is reported as
 * an inability to answer, and a caller with no answer cannot act.
 *
 * The one that would be easiest to get wrong is a failed write on the way to
 * an `allow` — a permission counted against a budget, or an approval the owner
 * granted. Reporting success there would tell the caller something happened
 * that FRIDAY has no record of.
 */

const AGENT: Actor = { type: 'agent', id: 'agent:communications/send' }
const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

const KEYS = { getKey: () => ({ ok: true as const, value: Buffer.alloc(32, 5) }) }

/** What a capability is about, without the fields only issuance needs. */
const SCOPE = {
  action: 'memory.read',
  resource: 'memory:contacts/sarah-chen',
}

const CAPABILITY = { principalId: 'usr_tyler', issuedTo: AGENT, ...SCOPE }

function issuerOver(store: Parameters<typeof createCapabilityIssuer>[0]['store']) {
  const built = createCapabilityIssuer({ store, keys: KEYS, now: () => NOW })
  if (!built.ok) throw new Error('expected an issuer')
  return built.value
}

describe('capabilities', () => {
  it('reports a permission that could not be recorded, rather than handing one out', () => {
    // A token whose record was never written would verify as `unknown`
    // forever. Better to say the issue failed.
    const issued = issuerOver(capabilityStoreFailing('put')).issue(CAPABILITY)

    expect(issued.ok).toBe(false)
    if (issued.ok) return
    expect(issued.error.code).toBe('STORAGE_UNAVAILABLE')
  })

  it('says it could not tell, rather than that the token was bad', () => {
    // ★ The distinction ADR-0027 exists for. `unavailable` is not a rejection,
    // and the Guardian must not record it as one.
    const working = issuerOver(createInMemoryCapabilityStore())
    const issued = working.issue(CAPABILITY)
    if (!issued.ok) throw new Error('expected a token')

    const blind = issuerOver(capabilityStoreFailing('get'))
    const verified = blind.verify({ token: issued.value.token, actor: AGENT, ...SCOPE })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.kind).toBe('unavailable')
  })

  it('refuses a use it could not count', () => {
    // A token capped at five uses that silently never counts is uncapped.
    const { store, breakIt } = breakableStore(createInMemoryCapabilityStore(), 'replace')
    const issuer = issuerOver(store)

    const issued = issuer.issue({ ...CAPABILITY, constraints: { maxCalls: 5 } })
    if (!issued.ok) throw new Error('expected a token')

    breakIt()
    const verified = issuer.verify({ token: issued.value.token, actor: AGENT, ...SCOPE })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.kind).toBe('unavailable')
  })

  it('reports a withdrawal it could not read or write', () => {
    expect(issuerOver(capabilityStoreFailing('get')).revoke(uuidv7(), 'because').ok).toBe(false)

    const { store, breakIt } = breakableStore(createInMemoryCapabilityStore(), 'replace')
    const issuer = issuerOver(store)
    const issued = issuer.issue(CAPABILITY)
    if (!issued.ok) throw new Error('expected a token')

    breakIt()
    expect(issuer.revoke(issued.value.capability.id, 'because').ok).toBe(false)
  })

  it('reports a plan-wide withdrawal it could not complete', () => {
    expect(issuerOver(capabilityStoreFailing('listByPlan')).revokeForPlan(uuidv7(), 'x').ok).toBe(
      false,
    )

    const planId = uuidv7()
    const { store, breakIt } = breakableStore(createInMemoryCapabilityStore(), 'replace')
    const issuer = issuerOver(store)
    issuer.issue({ ...CAPABILITY, planId })

    breakIt()
    expect(issuer.revokeForPlan(planId, 'the plan was cancelled').ok).toBe(false)
  })
})

describe('standing permissions', () => {
  const NEW_GRANT = {
    principalId: 'usr_tyler',
    actionPattern: 'connector.*.write',
    resourcePattern: 'connector:gmail/**',
    riskClass: 'medium' as const,
    reason: 'Labelling my own inbox is fine.',
    expiresAt: NOW + 30 * DAY_MS,
  }

  it('reports a permission that could not be recorded', () => {
    const registry = createGrantRegistry({ store: grantStoreFailing('put'), now: () => NOW })

    expect(registry.create(NEW_GRANT).ok).toBe(false)
  })

  it('reports that it could not check for a permission', () => {
    const registry = createGrantRegistry({
      store: grantStoreFailing('listByPrincipal'),
      now: () => NOW,
    })

    const found = registry.find({
      principalId: 'usr_tyler',
      action: 'connector.gmail.write',
      resource: 'connector:gmail/labels/inbox',
      riskClass: 'medium',
    })

    expect(found.ok).toBe(false)
  })

  it('reports a use or withdrawal it could not read or write', () => {
    expect(createGrantRegistry({ store: grantStoreFailing('get') }).use('x').ok).toBe(false)
    expect(createGrantRegistry({ store: grantStoreFailing('get') }).revoke('x').ok).toBe(false)

    for (const method of ['use', 'revoke'] as const) {
      const { store, breakIt } = breakableStore(createInMemoryGrantStore(), 'replace')
      const registry = createGrantRegistry({ store, now: () => NOW })
      const created = registry.create(NEW_GRANT)
      if (!created.ok) throw new Error('expected a grant')

      breakIt()
      expect(registry[method](created.value.id).ok).toBe(false)
    }
  })

  it('reports a listing it could not read', () => {
    const registry = createGrantRegistry({ store: grantStoreFailing('listByPrincipal') })

    expect(registry.list('usr_tyler').ok).toBe(false)
  })
})

describe('approvals', () => {
  const REQUEST = {
    principalId: 'usr_tyler',
    title: 'Send a follow-up email to Sarah Chen',
    riskClass: 'medium' as const,
    explanation: {
      what: 'Send the drafted message.',
      why: 'You asked me to follow up.',
      confidence: 0.8,
      risks: ['Sending an email cannot be undone.'],
      alternatives: ['Save it as a draft instead.'],
    },
    preview: { kind: 'text' as const, content: 'Hi Sarah.' },
    impact: {
      reversible: false,
      dataLeavesDevice: true,
      dataCategories: ['correspondence'],
      estimatedCostCents: null,
    },
    actor: AGENT,
    action: 'connector.gmail.message.send',
    resource: 'connector:gmail/messages/draft-1',
    decisionId: uuidv7(),
  }

  it('does not interrupt the owner with a question it could not record', () => {
    const registry = createApprovalRegistry({ store: approvalStoreFailing('put'), now: () => NOW })

    expect(registry.request(REQUEST).ok).toBe(false)
  })

  it('reports an answer it could not read the question for', () => {
    const registry = createApprovalRegistry({ store: approvalStoreFailing('get'), now: () => NOW })

    expect(registry.respond({ approvalId: uuidv7(), decision: 'approve', via: 'web' }).ok).toBe(
      false,
    )
  })

  it('never reports success on an answer it could not write down', () => {
    // ★ The worst one. Returning success here would tell the caller the owner
    // approved something FRIDAY has no record of them approving.
    const { store, breakIt } = breakableStore(createInMemoryApprovalStore(), 'replace')
    const registry = createApprovalRegistry({ store, now: () => NOW })

    const asked = registry.request(REQUEST)
    if (!asked.ok) throw new Error('expected a request')

    breakIt()
    const answered = registry.respond({
      approvalId: asked.value.id,
      decision: 'approve',
      via: 'web',
    })

    expect(answered.ok).toBe(false)
  })

  it('reports a lapse it could not write down', () => {
    let clock = NOW
    const { store, breakIt } = breakableStore(createInMemoryApprovalStore(), 'replace')
    const registry = createApprovalRegistry({ store, now: () => clock })

    const asked = registry.request({ ...REQUEST, lifetimeMs: 1_000 })
    if (!asked.ok) throw new Error('expected a request')

    clock += 2_000
    breakIt()

    // Both the sweep and a late answer have to settle the request, and neither
    // may claim to have done so when the write failed. The request stays
    // pending, which is the safe direction — it is still not approved.
    expect(registry.sweepExpired().ok).toBe(false)
    expect(
      registry.respond({ approvalId: asked.value.id, decision: 'approve', via: 'web' }).ok,
    ).toBe(false)
  })

  it('reports a sweep and a listing it could not read', () => {
    const registry = createApprovalRegistry({
      store: approvalStoreFailing('listPending'),
      now: () => NOW,
    })

    expect(registry.sweepExpired().ok).toBe(false)
    expect(registry.pending('usr_tyler').ok).toBe(false)
    expect(createApprovalRegistry({ store: approvalStoreFailing('get') }).get('x').ok).toBe(false)
  })
})

describe('the Guardian as a whole', () => {
  it('never answers allow or deny when it could not reach its records', async () => {
    // The property that matters. A decision is a claim that the rules were
    // consulted; a storage failure means they were not.
    const { createGuardian } = await import('@friday/guardian')
    const loaded = loadPolicySet(new URL('../../policies', import.meta.url).pathname)
    if (!loaded.ok) throw new Error('expected the shipped policies')

    const working = issuerOver(createInMemoryCapabilityStore())
    const issued = working.issue(CAPABILITY)
    if (!issued.ok) throw new Error('expected a token')

    // (a) the capability store is unreachable
    const blindToTokens = createGuardian({
      policies: loaded.value,
      capabilities: issuerOver(capabilityStoreFailing('get')),
      grants: createGrantRegistry({ store: createInMemoryGrantStore(), now: () => NOW }),
      now: () => NOW,
    })

    const first = blindToTokens.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: issued.value.token,
      ...SCOPE,
    })

    expect(first.ok).toBe(false)

    // (b) the grant store is unreachable
    const blindToGrants = createGuardian({
      policies: loaded.value,
      capabilities: working,
      grants: createGrantRegistry({ store: grantStoreFailing('listByPrincipal'), now: () => NOW }),
      now: () => NOW,
    })

    const second = blindToGrants.authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: issued.value.token,
      ...SCOPE,
    })

    expect(second.ok).toBe(false)
  })

  it('does not allow an action whose standing permission it could not count', async () => {
    // The subtlest one. Everything succeeds — the rules say ask, the owner's
    // standing permission covers it — and then counting the use fails. If that
    // were ignored, a permission capped at five uses would be uncapped, and
    // the owner's dashboard would under-report how often it was used.
    const { createGuardian } = await import('@friday/guardian')
    const loaded = loadPolicySet(new URL('../../policies', import.meta.url).pathname)
    if (!loaded.ok) throw new Error('expected the shipped policies')

    const { store, breakIt } = breakableStore(createInMemoryGrantStore(), 'replace')
    const grants = createGrantRegistry({ store, now: () => NOW })

    const created = grants.create({
      principalId: 'usr_tyler',
      actionPattern: 'connector.*.write',
      resourcePattern: 'connector:gmail/**',
      riskClass: 'medium',
      reason: 'Labelling my own inbox is fine.',
      expiresAt: NOW + 30 * DAY_MS,
      maxUses: 5,
    })
    if (!created.ok) throw new Error('expected a grant')

    const capabilities = issuerOver(createInMemoryCapabilityStore())
    const write = {
      action: 'connector.gmail.write',
      resource: 'connector:gmail/labels/inbox',
    }
    const issued = capabilities.issue({ principalId: 'usr_tyler', issuedTo: AGENT, ...write })
    if (!issued.ok) throw new Error('expected a token')

    breakIt()

    const decision = createGuardian({
      policies: loaded.value,
      capabilities,
      grants,
      now: () => NOW,
    }).authorize({
      actor: AGENT,
      principalId: 'usr_tyler',
      capability: issued.value.token,
      ...write,
    })

    expect(decision.ok).toBe(false)
  })
})
