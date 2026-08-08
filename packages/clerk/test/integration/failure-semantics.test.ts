import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ApprovalClerk,
  type AuthorizingClerk,
  createApprovalClerk,
  createAuthorizingClerk,
  registerClerkEventTypes,
} from '@friday/clerk'
import {
  type Actor,
  type ApprovalRequest,
  type AuthorizationRequest,
  err,
  type FridayError,
  fridayError,
  type GuardianDecision,
  type Result,
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
 * What happens when a write does not happen.
 *
 * ★ Three properties, and each is a way the system could lie:
 *
 * - authoritative state claiming an approval that has no event;
 * - an event claiming an approval the state does not reflect;
 * - an infrastructure failure reported as a policy decision.
 *
 * Every failure here is injected deterministically — a store method that
 * returns an error, on demand. Nothing waits, nothing retries, and no test
 * depends on a clock.
 *
 * Reference: docs/adr/0027 · docs/adr/0032
 */

const AGENT: Actor = { type: 'agent', id: 'agent:productivity/calendar' }
const PRINCIPAL = 'usr_tyler'

const WRITE = {
  action: 'connector.calendar.write',
  resource: 'connector:calendar/events/team-sync',
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

/** The failure a store reports when it is told to fail. */
const STORAGE_DOWN: FridayError = fridayError({
  code: 'STORAGE_WRITE_FAILED',
  message: 'The approvals table could not be written.',
})

/**
 * Wraps the real approval store so a chosen write starts failing on command.
 *
 * The same shape as `packages/guardian/test/support/failing-stores.ts`, which
 * exists because ADR-0027 made every store method able to report failure and
 * that behaviour is unreachable without a store that can.
 */
function breakable(real: ApprovalStore, method: 'put' | 'replace') {
  let broken = false

  const store: ApprovalStore = {
    put: (request) => (broken && method === 'put' ? err(STORAGE_DOWN) : real.put(request)),
    replace: (request) =>
      broken && method === 'replace' ? err(STORAGE_DOWN) : real.replace(request),
    get: (id) => real.get(id),
    listPending: (principalId) => real.listPending(principalId),
  }

  return {
    store,
    breakIt: () => {
      broken = true
    },
  }
}

let directory: string
let storage: Storage
let bus: EventBus
let clock: number

function open(): void {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })
  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)
  storage = opened.value
  bus = registerClerkEventTypes(createEventBus({ storage, principalId: PRINCIPAL }))
}

function compose(approvals: ApprovalStore): {
  clerk: ApprovalClerk
  authorizing: AuthorizingClerk
} {
  const policies = loadPolicySet(POLICY_DIR)
  if (!policies.ok) throw new Error('the shipped policies do not load')

  const capabilities = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
    now: () => clock,
  })
  if (!capabilities.ok) throw new Error('no capability issuer')

  const grants = createGrantRegistry({ store: storage.guardian.grants, now: () => clock })
  const clerk = createApprovalClerk({ approvals, bus, now: () => clock })

  return {
    clerk,
    authorizing: createAuthorizingClerk({
      guardian: createGuardian({
        policies: policies.value,
        capabilities: capabilities.value,
        grants,
        now: () => clock,
      }),
      clerk,
      bus,
      decisions: storage.guardian.decisions,
    }),
  }
}

function ask(): AuthorizationRequest {
  const issuer = createCapabilityIssuer({
    store: storage.guardian.capabilities,
    keys: KEYS,
    now: () => clock,
  })
  if (!issuer.ok) throw new Error('no issuer')

  const issued = issuer.value.issue({
    principalId: PRINCIPAL,
    issuedTo: AGENT,
    action: WRITE.action,
    resource: WRITE.resource,
  })
  if (!issued.ok) throw new Error('no capability')

  return {
    actor: AGENT,
    principalId: PRINCIPAL,
    action: WRITE.action,
    resource: WRITE.resource,
    capability: issued.value.token,
    correlationId: uuidv7(),
  }
}

function loggedTypes(): readonly string[] {
  const read = storage.events.readAfter({ afterSeq: 0 })
  if (!read.ok) throw new Error('could not read the log')
  return read.value.map((event) => event.type)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-clerk-fail-'))
  clock = Date.UTC(2026, 7, 8, 9, 0, 0)
  open()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('a state write that fails takes the event with it', () => {
  it('records neither the request nor its event', async () => {
    const broken = breakable(storage.guardian.approvals, 'put')
    const { authorizing } = compose(broken.store)

    broken.breakIt()

    const decided = await authorizing.authorize({ request: ask(), explain: EXPLAIN })

    expect(decided.ok).toBe(false)
    if (decided.ok) return

    // ★ The store's own reason, not a wrapper — the caller learns what failed.
    expect(decided.error.code).toBe('STORAGE_WRITE_FAILED')

    // ★ The decision was recorded; the request was not. Nothing claims an
    // approval exists, and no approval.requested is stranded in the log.
    expect(loggedTypes()).toEqual(['guardian.decided'])

    const pending = storage.guardian.approvals.listPending(PRINCIPAL)
    expect(pending.ok && pending.value).toEqual([])
  })

  it('leaves an answer unrecorded in both places when settling fails', async () => {
    const broken = breakable(storage.guardian.approvals, 'replace')
    const { clerk, authorizing } = compose(broken.store)

    const decided = await authorizing.authorize({ request: ask(), explain: EXPLAIN })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval')

    const approvalId = decided.value.approval.request.id
    expect(loggedTypes()).toEqual(['guardian.decided', 'approval.requested'])

    broken.breakIt()

    const answered = await clerk.respond({ approvalId, decision: 'approve', via: 'web' })

    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.error.code).toBe('STORAGE_WRITE_FAILED')

    // ★ No approval.granted in the log …
    expect(loggedTypes()).toEqual(['guardian.decided', 'approval.requested'])

    // ★ … and the request is still pending, not quietly approved.
    const stored = storage.guardian.approvals.get(approvalId)
    expect(stored.ok && stored.value?.status).toBe('pending')
    expect(stored.ok && stored.value?.respondedAt).toBeNull()
  })
})

describe('an event that cannot be written is not a decision', () => {
  it('reports the log failure rather than denying or approving', async () => {
    const { clerk, authorizing } = compose(storage.guardian.approvals)

    const decided = await authorizing.authorize({ request: ask(), explain: EXPLAIN })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval')

    const approvalId = decided.value.approval.request.id

    // ★ The log alone becomes unwritable, while the approvals table stays
    // perfectly healthy. That is the case worth isolating: the state write
    // *could* have succeeded, and must not, because its event cannot be
    // recorded. Closing the whole database would break both and prove less.
    const unwritable: Storage = {
      ...storage,
      events: {
        ...storage.events,
        append: () =>
          err(
            fridayError({
              code: 'EVENT_LOG_UNWRITABLE',
              message: 'FRIDAY could not record an approval.granted event, so it did not happen.',
            }),
          ),
      },
    }

    const brokenBus = registerClerkEventTypes(
      createEventBus({ storage: unwritable, principalId: PRINCIPAL }),
    )

    const brokenClerk = createApprovalClerk({
      approvals: storage.guardian.approvals,
      bus: brokenBus,
      now: () => clock,
    })

    const answered = await brokenClerk.respond({ approvalId, decision: 'approve', via: 'web' })

    expect(answered.ok).toBe(false)
    if (answered.ok) return

    // ★ An infrastructure fault, reported as one. Never NOT_AUTHORIZED, and
    // never a silent success. A disk that will not take a write has decided
    // nothing about what the owner is permitted to approve.
    expect(answered.error.code).toBe('EVENT_LOG_UNWRITABLE')
    expect(answered.error.code).not.toBe('NOT_AUTHORIZED')

    // ★ And the authoritative state did not move. No approval was granted.
    expect(loggedTypes()).toEqual(['guardian.decided', 'approval.requested'])

    const stored = storage.guardian.approvals.get(approvalId)
    expect(stored.ok && stored.value?.status).toBe('pending')
    expect(stored.ok && stored.value?.respondedAt).toBeNull()

    void clerk
  })

  it('records no decision at all when the Guardian could not consult its rules', async () => {
    const { authorizing } = compose(storage.guardian.approvals)

    // A Guardian whose stores are unreachable returns an error, not a `deny`.
    // ADR-0027: the rules were never consulted, so there is no decision.
    const unreachable = createAuthorizingClerk({
      guardian: {
        authorize: (): Result<GuardianDecision, FridayError> =>
          err(
            fridayError({
              code: 'STORAGE_UNAVAILABLE',
              message: 'The Guardian could not reach its own records.',
            }),
          ),
      },
      clerk: compose(storage.guardian.approvals).clerk,
      bus,
      decisions: storage.guardian.decisions,
    })

    const result = await unreachable.authorize({ request: ask(), explain: EXPLAIN })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('STORAGE_UNAVAILABLE')

    // ★ Nothing recorded. A `guardian.decided` here would be a decision that
    // nobody made, sitting permanently in the audit trail.
    expect(loggedTypes()).toEqual([])

    void authorizing
  })

  it('does not record a decision when the decision store refuses it', async () => {
    const { clerk } = compose(storage.guardian.approvals)

    const policies = loadPolicySet(POLICY_DIR)
    if (!policies.ok) throw new Error('policies')

    const capabilities = createCapabilityIssuer({
      store: storage.guardian.capabilities,
      keys: KEYS,
      now: () => clock,
    })
    if (!capabilities.ok) throw new Error('issuer')

    const authorizing = createAuthorizingClerk({
      guardian: createGuardian({
        policies: policies.value,
        capabilities: capabilities.value,
        grants: createGrantRegistry({ store: storage.guardian.grants, now: () => clock }),
        now: () => clock,
      }),
      clerk,
      bus,
      decisions: { record: () => err(STORAGE_DOWN) },
    })

    const decided = await authorizing.authorize({ request: ask(), explain: EXPLAIN })

    expect(decided.ok).toBe(false)
    if (decided.ok) return
    expect(decided.error.code).toBe('STORAGE_WRITE_FAILED')

    // The event rolled back with the state write.
    expect(loggedTypes()).toEqual([])
  })
})

describe('the answer and the record cannot disagree', () => {
  it('never leaves an approved request without its event', async () => {
    const { clerk, authorizing } = compose(storage.guardian.approvals)

    const decided = await authorizing.authorize({ request: ask(), explain: EXPLAIN })
    if (!decided.ok || decided.value.approval === undefined) throw new Error('no approval')

    const answered = await clerk.respond({
      approvalId: decided.value.approval.request.id,
      decision: 'approve',
      via: 'web',
    })
    if (!answered.ok) throw new Error('refused')

    const stored: ApprovalRequest | undefined = storage.guardian.approvals.get(
      decided.value.approval.request.id,
    ).ok
      ? ((storage.guardian.approvals.get(decided.value.approval.request.id) as { value: unknown })
          .value as ApprovalRequest | undefined)
      : undefined

    expect(stored?.status).toBe('approved')

    // Both, or neither. Here it is both, and the event names the request.
    expect(loggedTypes()).toEqual(['guardian.decided', 'approval.requested', 'approval.granted'])
    expect(answered.value.event.causationId).toBe(stored?.requestedEventId)
  })
})
