import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCausalChain, explain, unsupportedClaims } from '@friday/audit'
import {
  type ApprovalClerk,
  type AuthorizingClerk,
  createApprovalClerk,
  createAuthorizingClerk,
  registerClerkEventTypes,
} from '@friday/clerk'
import {
  type Actor,
  type AuthorizationRequest,
  createEventRegistry,
  type FridayEvent,
  registerCoreEventTypes,
  uuidv7,
} from '@friday/contracts'
import {
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  type Guardian,
  loadPolicySet,
} from '@friday/guardian'
import { createEventBus, type EventBus } from '@friday/kernel'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * One authorization decision becomes a truthful causal chain.
 *
 * ★ Every event in this file is produced by the real bus and read back out of
 * the real `events.db`. Nothing is hand-constructed. That is the point: the
 * audit package has been able to explain an authorization since Milestone 2
 * and had never once been given a real one, so a test built from literals
 * would prove the two halves agree with each other's imagination.
 *
 * Reference: docs/adr/0031 · docs/adr/0032
 */

const AGENT: Actor = { type: 'agent', id: 'agent:productivity/calendar' }
const PRINCIPAL = 'usr_tyler'

/**
 * A `medium` action, chosen because `requiredAuthFor('medium')` is `none`.
 * The high-risk path is a separate test, and it must stay unanswerable here.
 */
const WRITE = {
  action: 'connector.calendar.write',
  resource: 'connector:calendar/events/team-sync',
}

/** The high-risk one, for the step-up boundary. */
const SEND = {
  action: 'connector.gmail.message.send',
  resource: 'connector:gmail/messages/draft-1',
}

const EXPLAIN = {
  title: 'Move the team sync to Thursday',
  explanation: {
    what: 'Move the team sync from Wednesday to Thursday at 10am.',
    why: 'You asked me to find a slot that works for everyone this week.',
    confidence: 0.9,
    risks: ['Everyone invited will be notified of the change.'],
    alternatives: ['Leave it where it is and ask people to move.'],
  },
  preview: { kind: 'text' as const, content: 'Team sync → Thursday 10:00–10:30' },
  impact: {
    reversible: true,
    dataLeavesDevice: true,
    dataCategories: ['calendar'],
    estimatedCostCents: null,
  },
}

const POLICY_DIR = new URL('../../../guardian/policies', import.meta.url).pathname

const KEYS = createInMemoryKeyProvider({
  'capability-signing-key': Buffer.alloc(32, 9).toString('base64'),
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

let directory: string
let storage: Storage
let bus: EventBus
let guardian: Guardian
let clerk: ApprovalClerk
let authorizing: AuthorizingClerk
let clock: number

/** Opens storage and composes the clerk over it, the way a real boot would. */
function boot(): void {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })
  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)
  storage = opened.value

  bus = registerClerkEventTypes(createEventBus({ storage, principalId: PRINCIPAL }))

  const policies = loadPolicySet(POLICY_DIR)
  if (!policies.ok) throw new Error('the shipped policies do not load')

  const capabilities = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
    now: () => clock,
  })
  if (!capabilities.ok) throw new Error('no capability issuer')

  const grants = createGrantRegistry({ store: storage.guardian.grants, now: () => clock })

  guardian = createGuardian({
    policies: policies.value,
    capabilities: capabilities.value,
    grants,
    now: () => clock,
  })

  clerk = createApprovalClerk({ approvals: storage.guardian.approvals, bus, now: () => clock })

  authorizing = createAuthorizingClerk({
    guardian,
    clerk,
    bus,
    decisions: storage.guardian.decisions,
  })
}

/** A ticket for one step, because an agent may not act without one. */
function ticket(of: { action: string; resource: string }): string {
  const issuer = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
    now: () => clock,
  })
  if (!issuer.ok) throw new Error('no issuer')

  const issued = issuer.value.issue({
    principalId: PRINCIPAL,
    issuedTo: AGENT,
    action: of.action,
    resource: of.resource,
  })
  if (!issued.ok) throw new Error(`no capability: ${issued.error.message}`)

  return issued.value.token
}

function ask(
  of: { action: string; resource: string },
  correlationId: string,
): AuthorizationRequest {
  return {
    actor: AGENT,
    principalId: PRINCIPAL,
    action: of.action,
    resource: of.resource,
    capability: ticket(of),
    correlationId,
  }
}

/** Every event in the log, read back the way the dashboard reads it. */
function loggedEvents(): readonly FridayEvent[] {
  const read = storage.events.readAfter({ afterSeq: 0 })
  if (!read.ok) throw new Error('could not read the log back')
  return read.value
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-clerk-'))
  clock = Date.UTC(2026, 7, 8, 9, 0, 0)
  boot()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('one authorization decision becomes a causal chain', () => {
  it('records the decision, the question, and the answer, each caused by the last', async () => {
    const correlationId = uuidv7()

    const decided = await authorizing.authorize({
      request: ask(WRITE, correlationId),
      explain: EXPLAIN,
    })

    expect(decided.ok).toBe(true)
    if (!decided.ok) return

    expect(decided.value.decision.decision).toBe('needs_approval')
    expect(decided.value.decision.riskClass).toBe('medium')

    const approval = decided.value.approval
    expect(approval).toBeDefined()
    if (approval === undefined) return

    clock += 4_000

    const answered = await clerk.respond({
      approvalId: approval.request.id,
      decision: 'approve',
      via: 'web',
    })

    expect(answered.ok).toBe(true)
    if (!answered.ok) return

    // ── The chain, rebuilt from the log and nothing else ──────────────────
    const chain = buildCausalChain(correlationId, loggedEvents())

    expect(chain.orphaned).toEqual([])

    const types = chain.events.map((event) => event.type)
    expect(types).toEqual(['guardian.decided', 'approval.requested', 'approval.granted'])

    const [decidedEvent, requestedEvent, grantedEvent] = chain.events as [
      FridayEvent,
      FridayEvent,
      FridayEvent,
    ]

    // ★ Causation runs on EVENT ids.
    expect(decidedEvent.causationId).toBeUndefined()
    expect(requestedEvent.causationId).toBe(decidedEvent.id)
    expect(grantedEvent.causationId).toBe(requestedEvent.id)

    // ★ And never on the Guardian's decision id, which is a different thing.
    expect(requestedEvent.causationId).not.toBe(decided.value.decision.id)
    expect(requestedEvent.payload.decisionId).toBe(decided.value.decision.id)
    expect(decided.value.decision.id).not.toBe(decidedEvent.id)

    for (const event of chain.events) expect(event.correlationId).toBe(correlationId)

    // One straight line: decided → requested → granted.
    expect(chain.roots).toHaveLength(1)
    const depths = [decidedEvent, requestedEvent, grantedEvent].map((event) =>
      chain.events.indexOf(event),
    )
    expect(depths).toEqual([0, 1, 2])

    // ── And the explanation says nothing the log does not support ─────────
    const explanation = explain(chain, { depth: 'full', registry: bus.registry })

    expect(unsupportedClaims(explanation, chain)).toEqual([])
    expect(explanation.omitted.unphrased).toEqual([])
    expect(explanation.orphaned).toEqual([])
    expect(explanation.lines.map((line) => line.eventType)).toEqual(types)
    expect(explanation.headline).toContain('You approved it')
  })

  it('stores the request event id on the request, not the decision id', async () => {
    const correlationId = uuidv7()

    const decided = await authorizing.authorize({
      request: ask(WRITE, correlationId),
      explain: EXPLAIN,
    })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval raised')

    const stored = storage.guardian.approvals.get(decided.value.approval.request.id)
    expect(stored.ok).toBe(true)
    if (!stored.ok || stored.value === undefined) return

    expect(stored.value.requestedEventId).toBe(decided.value.approval.event.id)
    expect(stored.value.requestedEventId).not.toBe(stored.value.decisionId)
  })

  it('gives an approved action a guardian.decided ancestor in the log', async () => {
    const correlationId = uuidv7()

    const decided = await authorizing.authorize({
      request: ask(WRITE, correlationId),
      explain: EXPLAIN,
    })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval raised')

    const answered = await clerk.respond({
      approvalId: decided.value.approval.request.id,
      decision: 'approve',
      via: 'web',
    })
    if (!answered.ok) throw new Error('the answer was refused')

    // Walk back up from the grant, through the log, to the decision.
    const events = new Map(loggedEvents().map((event) => [event.id, event]))

    let cursor: FridayEvent | undefined = answered.value.event
    const ancestry: string[] = []

    while (cursor !== undefined) {
      ancestry.push(cursor.type)
      cursor = cursor.causationId === undefined ? undefined : events.get(cursor.causationId)
    }

    expect(ancestry).toEqual(['approval.granted', 'approval.requested', 'guardian.decided'])
  })
})

describe('the chain survives a restart', () => {
  it('rebuilds from events.db alone, with nothing kept in memory', async () => {
    const correlationId = uuidv7()

    const decided = await authorizing.authorize({
      request: ask(WRITE, correlationId),
      explain: EXPLAIN,
    })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval raised')

    const approvalId = decided.value.approval.request.id

    // ★ Everything closes. New objects, new bus, new clerk — the only things
    // that cross are the files on disk and the signing key.
    storage.close()
    boot()

    const answered = await clerk.respond({ approvalId, decision: 'approve', via: 'web' })
    expect(answered.ok).toBe(true)

    storage.close()
    boot()

    const chain = buildCausalChain(correlationId, loggedEvents())

    expect(chain.orphaned).toEqual([])
    expect(chain.events.map((event) => event.type)).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.granted',
    ])

    const explanation = explain(chain, { depth: 'full', registry: bus.registry })
    expect(unsupportedClaims(explanation, chain)).toEqual([])
  })
})

describe('the loopback surface still cannot manufacture presence', () => {
  it('refuses a high-risk approval from the web and records no grant', async () => {
    const correlationId = uuidv7()

    const decided = await authorizing.authorize({
      request: ask(SEND, correlationId),
      explain: EXPLAIN,
    })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval raised')

    expect(decided.value.decision.riskClass).toBe('high')
    expect(decided.value.approval.request.requiredAuth).toBe('biometric')

    // The web surface never supplies `authenticatedAt`, exactly as apps/core
    // never supplies it. ADR-0030.
    const answered = await clerk.respond({
      approvalId: decided.value.approval.request.id,
      decision: 'approve',
      via: 'web',
    })

    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.error.code).toBe('STEP_UP_REQUIRED')

    // ★ Still pending, and no grant anywhere in the log.
    const stored = storage.guardian.approvals.get(decided.value.approval.request.id)
    expect(stored.ok && stored.value?.status).toBe('pending')

    expect(loggedEvents().map((event) => event.type)).toEqual([
      'guardian.decided',
      'approval.requested',
    ])
  })
})

describe('Guardian event types belong to the clerk that registered them', () => {
  it('refuses an approval event from a bus that never composed a clerk', async () => {
    // A second bus over the same storage, built the way any other process
    // would build one — `friday events emit`, a recovery script, anything.
    const unrelated = createEventBus({ storage, principalId: PRINCIPAL })

    const forged = await unrelated.publish({
      type: 'approval.granted',
      actor: AGENT,
      principalId: PRINCIPAL,
      payload: {
        approvalId: uuidv7(),
        action: WRITE.action,
        resource: WRITE.resource,
        respondedVia: 'web',
        reason: null,
        timeToDecisionMs: 1,
      },
      sensitivity: 'private',
    })

    expect(forged.ok).toBe(false)
    if (forged.ok) return
    expect(forged.error.code).toBe('EVENT_TYPE_UNREGISTERED')

    // And nothing reached the log.
    expect(loggedEvents()).toEqual([])
  })

  it('registers core types on every bus, so the isolation is specific', () => {
    const unrelated = createEventBus({ storage, principalId: PRINCIPAL })

    expect(unrelated.registry.has('system.started')).toBe(true)
    expect(unrelated.registry.has('approval.granted')).toBe(false)
    expect(bus.registry.has('approval.granted')).toBe(true)
  })

  it('leaves a bare registry without Guardian types at all', () => {
    const bare = registerCoreEventTypes(createEventRegistry())

    expect(bare.has('guardian.decided')).toBe(false)
    expect(bare.has('approval.requested')).toBe(false)
  })
})
