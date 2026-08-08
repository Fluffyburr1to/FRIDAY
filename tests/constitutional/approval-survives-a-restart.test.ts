import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor } from '@friday/contracts'
import {
  createApprovalRegistry,
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  loadPolicySet,
  requiredAuthFor,
} from '@friday/guardian'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ CONSTITUTIONAL — Article III across a restart.
 *
 * Milestone 2's acceptance test, and the only one that proves the claim the
 * whole milestone rests on: *a plan can wait days for you.*
 *
 * Chapter 19's argument is that strict approval is only livable because
 * waiting costs nothing. If waiting meant holding a process open, the pressure
 * to add a timeout that proceeds anyway would be constant — and a system that
 * proceeds when it cannot reach you is not asking permission. That property is
 * not testable in a unit test with a map for a store, which is exactly why it
 * is tested here, against real files that are closed and reopened.
 *
 * "Restart" here means every handle is closed and the databases are opened
 * again from disk, with fresh Guardian objects built over them. Nothing is
 * carried across in memory except the paths and the signing key — which is
 * what the Keychain provides in a real restart.
 *
 * Reference: docs/00-foundation/constitution.md · docs/01-bible/19-approval-system.md
 */

const AGENT: Actor = { type: 'agent', id: 'agent:communications/send' }
const PRINCIPAL = 'usr_tyler'

const SEND = {
  action: 'connector.gmail.message.send',
  resource: 'connector:gmail/messages/draft-1',
}

const EXPLANATION = {
  what: 'Send the drafted message to sarah@example.com.',
  why: 'You asked me to follow up on the contract thread this morning.',
  confidence: 0.8,
  risks: ['Sending an email cannot be undone.'],
  alternatives: ['Save it as a draft instead.'],
}

const POLICY_DIR = new URL('../../packages/guardian/policies', import.meta.url).pathname

/** One signing key, held across restarts the way the Keychain holds it. */
const KEYS = createInMemoryKeyProvider({
  'capability-signing-key': Buffer.alloc(32, 9).toString('base64'),
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

let directory: string
let storage: Storage
let clock: number

/** Opens FRIDAY's storage and builds the Guardian over it. */
function boot() {
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
    now: () => clock,
  })
  if (!capabilities.ok) throw new Error('no capability issuer')

  const grants = createGrantRegistry({ store: storage.guardian.grants, now: () => clock })

  return {
    capabilities: capabilities.value,
    grants,
    approvals: createApprovalRegistry({ store: storage.guardian.approvals, now: () => clock }),
    guardian: createGuardian({
      policies: policies.value,
      capabilities: capabilities.value,
      grants,
      now: () => clock,
    }),
    decisions: storage.guardian.decisions,
  }
}

/** Closes every handle. What is on disk is all that survives. */
function shutdown(): void {
  storage.close()
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-restart-'))
  clock = 1_700_000_000_000
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('an approval waits across a restart', () => {
  it('is still pending, still explained, and still answerable', () => {
    // ── Before ────────────────────────────────────────────────────────────
    const before = boot()

    const slip = before.capabilities.issue({
      principalId: PRINCIPAL,
      issuedTo: AGENT,
      ...SEND,
    })
    if (!slip.ok) throw new Error('no permission slip')

    const decision = before.guardian.authorize({
      actor: AGENT,
      principalId: PRINCIPAL,
      capability: slip.value.token,
      ...SEND,
    })
    if (!decision.ok) throw new Error('the Guardian gave no decision')

    expect(decision.value.decision).toBe('needs_approval')
    expect(decision.value.riskClass).toBe('high')

    before.decisions.record(decision.value)

    const asked = before.approvals.request({
      principalId: PRINCIPAL,
      title: 'Send a follow-up email to Sarah Chen',
      riskClass: decision.value.riskClass,
      explanation: EXPLANATION,
      preview: { kind: 'text', content: 'Hi Sarah — following up on the contract.' },
      impact: {
        reversible: false,
        dataLeavesDevice: true,
        dataCategories: ['correspondence'],
        estimatedCostCents: null,
      },
      actor: AGENT,
      action: SEND.action,
      resource: SEND.resource,
      decisionId: decision.value.id,
    })
    if (!asked.ok) throw new Error(`the request was refused: ${asked.error.message}`)

    // ── FRIDAY stops ──────────────────────────────────────────────────────
    shutdown()

    // ── Three days pass ───────────────────────────────────────────────────
    clock += 3 * 24 * 60 * 60 * 1000

    // ── FRIDAY starts again ───────────────────────────────────────────────
    const after = boot()

    // Startup settles anything that lapsed while she was off. This one has
    // not: seven days, and three have passed.
    const swept = after.approvals.sweepExpired()
    if (!swept.ok) throw new Error('the sweep failed')
    expect(swept.value).toEqual([])

    const pending = after.approvals.pending(PRINCIPAL)
    if (!pending.ok) throw new Error('could not list pending approvals')

    expect(pending.value).toHaveLength(1)

    const waiting = pending.value[0]
    expect(waiting?.id).toBe(asked.value.id)
    expect(waiting?.status).toBe('pending')

    // ★ Still explained. An approval that survived as an id and lost its
    // reasoning would be a request the owner could not evaluate — which
    // Chapter 19 forbids at creation and must equally forbid after a restart.
    expect(waiting?.explanation.what).toBe(EXPLANATION.what)
    expect(waiting?.explanation.why).toBe(EXPLANATION.why)
    expect(waiting?.explanation.risks).toEqual(EXPLANATION.risks)
    expect(waiting?.explanation.alternatives).toEqual(EXPLANATION.alternatives)

    // ★ Still the actual artifact, not a summary of it.
    expect(waiting?.preview.content).toBe('Hi Sarah — following up on the contract.')

    // Still demanding the same proof it is you.
    expect(waiting?.requiredAuth).toBe(requiredAuthFor('high'))

    // ── And answerable ────────────────────────────────────────────────────
    const answered = after.approvals.respond({
      approvalId: asked.value.id,
      decision: 'approve',
      via: 'desktop',
      authenticatedAt: clock,
    })

    expect(answered.ok).toBe(true)
    if (!answered.ok) return
    expect(answered.value.status).toBe('approved')

    // ── And the answer itself survives ────────────────────────────────────
    shutdown()
    const later = boot()

    const settled = later.approvals.get(asked.value.id)
    if (!settled.ok) throw new Error('could not read the answered request')

    expect(settled.value?.status).toBe('approved')
    expect(settled.value?.respondedVia).toBe('desktop')
    expect(later.approvals.pending(PRINCIPAL)).toEqual({ ok: true, value: [] })
  })

  it('lapses on time even if FRIDAY was switched off when it ran out', () => {
    // Timeout means denied, and being switched off is not an extension. A
    // request that quietly stayed pending past its deadline would be one the
    // owner could approve believing it was still live.
    const before = boot()

    const asked = before.approvals.request({
      principalId: PRINCIPAL,
      title: 'Something routine',
      riskClass: 'medium',
      explanation: EXPLANATION,
      preview: { kind: 'text', content: 'A change to a label.' },
      impact: {
        reversible: true,
        dataLeavesDevice: false,
        dataCategories: [],
        estimatedCostCents: null,
      },
      actor: AGENT,
      action: 'connector.gmail.write',
      resource: 'connector:gmail/labels/inbox',
      decisionId: crypto.randomUUID(),
      lifetimeMs: 60_000,
    })
    if (!asked.ok) throw new Error('the request was refused')

    shutdown()

    clock += 120_000

    const after = boot()
    const swept = after.approvals.sweepExpired()
    if (!swept.ok) throw new Error('the sweep failed')

    expect(swept.value.map((request) => request.id)).toEqual([asked.value.id])

    const settled = after.approvals.get(asked.value.id)
    if (!settled.ok) throw new Error('could not read the lapsed request')

    expect(settled.value?.status).toBe('expired')
    expect(settled.value?.respondedVia).toBeNull()

    // And a late yes is refused, not honoured.
    const late = after.approvals.respond({
      approvalId: asked.value.id,
      decision: 'approve',
      via: 'desktop',
      authenticatedAt: clock,
    })

    expect(late.ok).toBe(false)
  })
})

describe('the rest of the Guardian survives a restart too', () => {
  it('keeps a permission slip usable, and keeps a withdrawn one withdrawn', () => {
    const before = boot()

    const kept = before.capabilities.issue({
      principalId: PRINCIPAL,
      issuedTo: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })
    const withdrawn = before.capabilities.issue({
      principalId: PRINCIPAL,
      issuedTo: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/alex',
    })
    if (!kept.ok || !withdrawn.ok) throw new Error('no permission slips')

    before.capabilities.revoke(withdrawn.value.capability.id, 'you cancelled the plan')
    shutdown()

    clock += 60_000
    const after = boot()

    expect(
      after.capabilities.verify({
        token: kept.value.token,
        actor: AGENT,
        action: 'memory.read',
        resource: 'memory:contacts/sarah-chen',
      }).ok,
    ).toBe(true)

    const replayed = after.capabilities.verify({
      token: withdrawn.value.token,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/alex',
    })

    expect(replayed.ok).toBe(false)
    if (replayed.ok) return
    expect(replayed.error.kind === 'rejected' && replayed.error.reason).toBe('capability_revoked')
  })

  it('keeps a standing permission, its expiry, and how often it was used', () => {
    const before = boot()

    const created = before.grants.create({
      principalId: PRINCIPAL,
      actionPattern: 'connector.*.write',
      resourcePattern: 'connector:gmail/**',
      riskClass: 'medium',
      reason: 'Labelling my own inbox is fine.',
      expiresAt: clock + 30 * 24 * 60 * 60 * 1000,
      maxUses: 5,
    })
    if (!created.ok) throw new Error('the grant was refused')

    before.grants.use(created.value.id)
    before.grants.use(created.value.id)
    shutdown()

    const after = boot()
    const listed = after.grants.list(PRINCIPAL)
    if (!listed.ok) throw new Error('could not list grants')

    expect(listed.value).toHaveLength(1)
    expect(listed.value[0]?.uses).toBe(2)
    expect(listed.value[0]?.reason).toBe('Labelling my own inbox is fine.')
    expect(listed.value[0]?.expiresAt).toBe(created.value.expiresAt)
  })

  it('keeps every decision, with the rules that produced it', () => {
    const before = boot()

    const slip = before.capabilities.issue({
      principalId: PRINCIPAL,
      issuedTo: AGENT,
      ...SEND,
    })
    if (!slip.ok) throw new Error('no permission slip')

    const decision = before.guardian.authorize({
      actor: AGENT,
      principalId: PRINCIPAL,
      capability: slip.value.token,
      ...SEND,
    })
    if (!decision.ok) throw new Error('no decision')

    before.decisions.record(decision.value)
    shutdown()

    const after = boot()
    const recorded = after.decisions.listByPrincipal(PRINCIPAL)
    if (!recorded.ok) throw new Error('could not read decisions')

    expect(recorded.value).toHaveLength(1)
    expect(recorded.value[0]?.summary).toBe(decision.value.summary)
    expect(recorded.value[0]?.matchedPolicies).toEqual(decision.value.matchedPolicies)
    expect(recorded.value[0]?.reason).toBe('approval_required')
  })
})
