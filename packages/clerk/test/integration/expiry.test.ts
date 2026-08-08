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
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  uuidv7,
} from '@friday/contracts'
import {
  type ApprovalStore,
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  loadPolicySet,
} from '@friday/guardian'
import { createEventBus, type EventBus } from '@friday/kernel'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * An approval that runs out of time says so.
 *
 * ★ Chapter 19's seventh absolute rule is that a timeout is never an approval.
 * Milestone 2 enforced that in state and left no trace of it: a request lapsed
 * silently, and the owner reading their history saw FRIDAY ask a question that
 * was never answered and never closed. Expiry is a *denial*, and a denial
 * nobody recorded is the one this system exists to prevent.
 *
 * Time is a variable here, never a wall clock. Every test moves `clock`
 * forward by an exact amount; nothing sleeps and nothing polls.
 *
 * Reference: docs/adr/0031 · docs/adr/0032 · Chapter 19
 */

const AGENT: Actor = { type: 'agent', id: 'agent:productivity/calendar' }
const PRINCIPAL = 'usr_tyler'

/** `medium`, so `requiredAuth` is `none` and nothing needs a step-up. */
const WRITE = {
  action: 'connector.calendar.write',
  resource: 'connector:calendar/events/team-sync',
}

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
    alternatives: ['Leave it where it is.'],
  },
  preview: { kind: 'text' as const, content: 'Team sync → Thursday 10:00' },
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

const STORAGE_DOWN: FridayError = fridayError({
  code: 'STORAGE_WRITE_FAILED',
  message: 'The approvals table could not be written.',
})

/** The real store, with the settling write breakable on command. */
function breakable(real: ApprovalStore) {
  let broken = false

  return {
    store: {
      put: (request) => real.put(request),
      replace: (request) => (broken ? err(STORAGE_DOWN) : real.replace(request)),
      get: (id) => real.get(id),
      listPending: (principalId) => real.listPending(principalId),
    } satisfies ApprovalStore,
    breakIt: () => {
      broken = true
    },
  }
}

let directory: string
let storage: Storage
let bus: EventBus
let clerk: ApprovalClerk
let authorizing: AuthorizingClerk
let clock: number

/** Opens storage and composes the clerk, the way a real boot would. */
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
  compose()
}

/**
 * Rebuilds the clerk over the storage that is already open.
 *
 * Separate from `boot` because swapping in a failing store must not open a
 * second handle to the same files — two writers on one SQLite database is a
 * different failure from the one under test, and it would masquerade as it.
 */
function compose(approvals?: ApprovalStore): void {
  const policies = loadPolicySet(POLICY_DIR)
  if (!policies.ok) throw new Error('the shipped policies do not load')

  const capabilities = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
    now: () => clock,
  })
  if (!capabilities.ok) throw new Error('no capability issuer')

  const grants = createGrantRegistry({ store: storage.guardian.grants, now: () => clock })

  clerk = createApprovalClerk({
    approvals: approvals ?? storage.guardian.approvals,
    bus,
    now: () => clock,
  })

  authorizing = createAuthorizingClerk({
    guardian: createGuardian({
      policies: policies.value,
      capabilities: capabilities.value,
      grants,
      now: () => clock,
    }),
    clerk,
    bus,
    decisions: storage.guardian.decisions,
  })
}

function ask(
  of: { action: string; resource: string },
  correlationId: string,
): AuthorizationRequest {
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
  if (!issued.ok) throw new Error('no capability')

  return {
    actor: AGENT,
    principalId: PRINCIPAL,
    action: of.action,
    resource: of.resource,
    capability: issued.value.token,
    correlationId,
  }
}

/** Raises one real approval through the production lifecycle. */
async function raise(
  of: { action: string; resource: string },
  correlationId: string,
): Promise<{ id: string; requestedEventId: string }> {
  const decided = await authorizing.authorize({ request: ask(of, correlationId), explain: EXPLAIN })
  if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval raised')

  return {
    id: decided.value.approval.request.id,
    requestedEventId: decided.value.approval.event.id,
  }
}

function loggedEvents(): readonly FridayEvent[] {
  const read = storage.events.readAfter({ afterSeq: 0 })
  if (!read.ok) throw new Error('could not read the log')
  return read.value
}

const typesOf = (events: readonly FridayEvent[]): readonly string[] => events.map((e) => e.type)

/** Past the seven-day default, by an exact amount. */
const PAST_THE_DEADLINE = 8 * 24 * 60 * 60 * 1000

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-expiry-'))
  clock = Date.UTC(2026, 7, 8, 9, 0, 0)
  boot()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('an approval that runs out of time', () => {
  it('records guardian.decided → approval.requested → approval.expired', async () => {
    const correlationId = uuidv7()
    const raised = await raise(WRITE, correlationId)

    clock += PAST_THE_DEADLINE

    const swept = await clerk.sweepExpired()
    expect(swept.ok).toBe(true)
    if (!swept.ok) return
    expect(swept.value).toHaveLength(1)

    const chain = buildCausalChain(correlationId, loggedEvents())

    expect(chain.orphaned).toEqual([])
    expect(typesOf(chain.events)).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.expired',
    ])

    const [decided, requested, expired] = chain.events as [FridayEvent, FridayEvent, FridayEvent]

    // ★ Causation on EVENT ids, all the way down.
    expect(requested.causationId).toBe(decided.id)
    expect(expired.causationId).toBe(requested.id)
    expect(expired.causationId).toBe(raised.requestedEventId)

    // ★ And never on a domain id.
    expect(expired.causationId).not.toBe(raised.id)
    expect(expired.causationId).not.toBe(requested.payload.decisionId)
    expect(expired.payload.approvalId).toBe(raised.id)

    for (const event of chain.events) expect(event.correlationId).toBe(correlationId)

    // Nobody answered, so there is no surface and no reason.
    expect(expired.payload.respondedVia).toBeNull()
    expect(expired.payload.reason).toBeNull()
    expect(expired.payload.timeToDecisionMs).toBe(PAST_THE_DEADLINE)
  })

  it('is explained without an unsupported claim', async () => {
    const correlationId = uuidv7()
    await raise(WRITE, correlationId)

    clock += PAST_THE_DEADLINE
    await clerk.sweepExpired()

    const chain = buildCausalChain(correlationId, loggedEvents())
    const explanation = explain(chain, { depth: 'full', registry: bus.registry })

    expect(unsupportedClaims(explanation, chain)).toEqual([])
    expect(explanation.omitted.unphrased).toEqual([])
    expect(explanation.orphaned).toEqual([])

    // ★ The owner's version of events ends with the truth about a timeout.
    expect(explanation.headline).toBe('Nobody answered in time, so FRIDAY did not act.')
    expect(explanation.lines.map((line) => line.eventType)).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.expired',
    ])
  })

  it('is never labelled as something the owner declined', async () => {
    await raise(WRITE, uuidv7())
    clock += PAST_THE_DEADLINE
    await clerk.sweepExpired()

    expect(typesOf(loggedEvents())).not.toContain('approval.declined')
  })
})

describe('expiry is atomic with its record', () => {
  it('writes no event when the state change cannot be made', async () => {
    const broken = breakable(storage.guardian.approvals)
    compose(broken.store)

    await raise(WRITE, uuidv7())
    clock += PAST_THE_DEADLINE
    broken.breakIt()

    const swept = await clerk.sweepExpired()

    expect(swept.ok).toBe(false)
    if (swept.ok) return
    expect(swept.error.code).toBe('STORAGE_WRITE_FAILED')

    // ★ No approval.expired anywhere, and the request is still pending.
    expect(typesOf(loggedEvents())).toEqual(['guardian.decided', 'approval.requested'])

    const pending = storage.guardian.approvals.listPending(PRINCIPAL)
    expect(pending.ok && pending.value).toHaveLength(1)
  })

  it('leaves the approval unexpired when the log cannot be written', async () => {
    const raised = await raise(WRITE, uuidv7())
    clock += PAST_THE_DEADLINE

    // ★ The log alone fails; the approvals table stays healthy. The state
    // change *could* have succeeded, and must not, because its event cannot.
    const unwritable: Storage = {
      ...storage,
      events: {
        ...storage.events,
        append: () =>
          err(
            fridayError({
              code: 'EVENT_LOG_UNWRITABLE',
              message: 'FRIDAY could not record an approval.expired event.',
            }),
          ),
      },
    }

    const brokenClerk = createApprovalClerk({
      approvals: storage.guardian.approvals,
      bus: registerClerkEventTypes(createEventBus({ storage: unwritable, principalId: PRINCIPAL })),
      now: () => clock,
    })

    const swept = await brokenClerk.sweepExpired()

    expect(swept.ok).toBe(false)
    if (swept.ok) return
    expect(swept.error.code).toBe('EVENT_LOG_UNWRITABLE')

    // ★ Still pending. An expiry that could not be recorded did not happen.
    const stored = storage.guardian.approvals.get(raised.id)
    expect(stored.ok && stored.value?.status).toBe('pending')
    expect(stored.ok && stored.value?.respondedAt).toBeNull()

    expect(typesOf(loggedEvents())).toEqual(['guardian.decided', 'approval.requested'])
  })
})

describe('a sweep touches only what is genuinely past its deadline', () => {
  it('expires the lapsed one and leaves the fresh one pending', async () => {
    const oldOne = await raise(WRITE, uuidv7())

    // The second is raised a day later, so one deadline falls and one does not.
    clock += 24 * 60 * 60 * 1000
    const newOne = await raise(WRITE, uuidv7())

    // Lands exactly on the first deadline and a day short of the second.
    // `expiresAt` is inclusive — reaching it is lapsing — so this is the
    // boundary worth pinning rather than stepping safely past.
    clock += 6 * 24 * 60 * 60 * 1000

    const swept = await clerk.sweepExpired()
    expect(swept.ok).toBe(true)
    if (!swept.ok) return

    expect(swept.value.map((request) => request.id)).toEqual([oldOne.id])

    const expired = loggedEvents().filter((event) => event.type === 'approval.expired')
    expect(expired).toHaveLength(1)
    expect(expired[0]?.payload.approvalId).toBe(oldOne.id)

    expect(storage.guardian.approvals.get(oldOne.id).ok).toBe(true)
    const still = storage.guardian.approvals.get(newOne.id)
    expect(still.ok && still.value?.status).toBe('pending')
  })

  it('gives each lapsed approval exactly one event', async () => {
    const first = await raise(WRITE, uuidv7())
    const second = await raise(WRITE, uuidv7())

    clock += PAST_THE_DEADLINE

    const swept = await clerk.sweepExpired()
    expect(swept.ok && swept.value).toHaveLength(2)

    const expired = loggedEvents().filter((event) => event.type === 'approval.expired')
    expect(expired.map((event) => event.payload.approvalId).sort()).toEqual(
      [first.id, second.id].sort(),
    )
  })
})

describe('sweeping twice', () => {
  it('does not record the same expiry a second time', async () => {
    await raise(WRITE, uuidv7())
    clock += PAST_THE_DEADLINE

    const first = await clerk.sweepExpired()
    expect(first.ok && first.value).toHaveLength(1)

    // ★ Idempotent by construction: an expired request is no longer pending,
    // so the second sweep has nothing to find. Nothing is deduplicated.
    const second = await clerk.sweepExpired()
    expect(second.ok && second.value).toEqual([])

    expect(loggedEvents().filter((event) => event.type === 'approval.expired')).toHaveLength(1)
    expect(typesOf(loggedEvents())).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.expired',
    ])
  })
})

describe('answering after the deadline', () => {
  it('records the lapse rather than the answer', async () => {
    const raised = await raise(WRITE, uuidv7())
    clock += PAST_THE_DEADLINE

    const answered = await clerk.respond({
      approvalId: raised.id,
      decision: 'approve',
      via: 'web',
    })

    // The answer is refused — a yes after the deadline is a denial.
    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.error.code).toBe('APPROVAL_REQUIRED')

    // ★ And the lapse it caused is recorded, not silently applied.
    expect(typesOf(loggedEvents())).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.expired',
    ])

    const stored = storage.guardian.approvals.get(raised.id)
    expect(stored.ok && stored.value?.status).toBe('expired')
  })
})

describe('the expiry chain survives a restart', () => {
  it('rebuilds from events.db alone', async () => {
    const correlationId = uuidv7()
    await raise(WRITE, correlationId)

    clock += PAST_THE_DEADLINE

    storage.close()
    boot()

    const swept = await clerk.sweepExpired()
    expect(swept.ok && swept.value).toHaveLength(1)

    storage.close()
    boot()

    const chain = buildCausalChain(correlationId, loggedEvents())

    expect(chain.orphaned).toEqual([])
    expect(typesOf(chain.events)).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.expired',
    ])

    const explanation = explain(chain, { depth: 'full', registry: bus.registry })
    expect(unsupportedClaims(explanation, chain)).toEqual([])
  })
})

describe('nothing else about authorization changed', () => {
  it('still refuses a high-risk approval from the web', async () => {
    const correlationId = uuidv7()
    const raised = await raise(SEND, correlationId)

    const answered = await clerk.respond({
      approvalId: raised.id,
      decision: 'approve',
      via: 'web',
    })

    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.error.code).toBe('STEP_UP_REQUIRED')

    const stored = storage.guardian.approvals.get(raised.id)
    expect(stored.ok && stored.value?.status).toBe('pending')

    expect(typesOf(loggedEvents())).toEqual(['guardian.decided', 'approval.requested'])
  })

  it('still records a granted approval as granted', async () => {
    const raised = await raise(WRITE, uuidv7())

    clock += 1_000
    const answered = await clerk.respond({
      approvalId: raised.id,
      decision: 'approve',
      via: 'web',
    })

    expect(answered.ok).toBe(true)
    expect(typesOf(loggedEvents())).toEqual([
      'guardian.decided',
      'approval.requested',
      'approval.granted',
    ])
  })
})
