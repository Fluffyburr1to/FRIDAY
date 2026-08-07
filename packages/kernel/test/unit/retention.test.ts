import type { FridayEvent } from '@friday/contracts'
import { uuidv7 } from '@friday/contracts'
import {
  DEFAULT_RETENTION,
  isProtectedType,
  PROTECTED_PATTERNS,
  planCompaction,
  protectedEventIds,
  type RetentionPolicy,
  RetentionPolicySchema,
  tierOf,
} from '@friday/kernel'
import { describe, expect, it } from 'vitest'

const NOW = 1_800_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

let seq = 0

function event(input: {
  type: string
  ageDays?: number
  causationId?: string
  payload?: Record<string, unknown>
}): FridayEvent {
  seq += 1
  const occurredAt = NOW - (input.ageDays ?? 0) * DAY_MS

  return {
    seq,
    id: uuidv7(1_700_000_000_000 + seq),
    type: input.type,
    occurredAt,
    recordedAt: occurredAt,
    actor: { type: 'agent', id: 'agent:communications/send' },
    principalId: 'usr_tyler',
    payload: input.payload ?? {},
    payloadVersion: 1,
    sensitivity: 'internal',
    integrityHash: 'a'.repeat(64),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  }
}

const CHATTY: RetentionPolicy = {
  ...DEFAULT_RETENTION,
  collapsible: ['diagnostics.heartbeat', 'test.event.emitted'],
  dropBodiesOverBytes: 100,
}

describe('what may never be compacted', () => {
  it('protects every class Chapter 10 names', () => {
    for (const type of [
      'approval.requested',
      'approval.granted',
      'guardian.decided',
      'grant.created',
      'capability.issued',
      'connector.gmail.message.send',
      'model.invoked',
      'engineering.change.merge',
      'credential.gmail.write',
    ]) {
      expect(isProtectedType(type), `${type} was not protected`).toBe(true)
    }
  })

  it('does not protect ordinary chatter', () => {
    expect(isProtectedType('diagnostics.heartbeat')).toBe(false)
    expect(isProtectedType('system.started')).toBe(false)
  })

  it('cannot be switched off by a retention policy', () => {
    // ★ The policy is for tuning what is kept. It is not the place to make the
    // record of every approval disposable, and a policy that tried is refused.
    for (const pattern of ['approval.granted', 'guardian.*', 'connector.gmail.message.send']) {
      const parsed = RetentionPolicySchema.safeParse({
        ...DEFAULT_RETENTION,
        collapsible: [pattern],
      })

      expect(parsed.success, `${pattern} was accepted as collapsible`).toBe(false)
    }
  })
})

describe('protection spreads along causation', () => {
  it('covers what led to a protected event', () => {
    // An approval on its own is not an audit trail. The approval plus what led
    // to it is.
    seq = 0
    const started = event({ type: 'system.started', ageDays: 400 })
    const heartbeat = event({
      type: 'diagnostics.heartbeat',
      ageDays: 400,
      causationId: started.id,
    })
    const approval = event({
      type: 'approval.requested',
      ageDays: 400,
      causationId: heartbeat.id,
    })

    const untouchable = protectedEventIds([started, heartbeat, approval])

    expect(untouchable.has(approval.id)).toBe(true)
    expect(untouchable.has(heartbeat.id)).toBe(true)
    expect(untouchable.has(started.id)).toBe(true)
  })

  it('covers what followed from one', () => {
    // An approval whose consequences were thinned away is an approval whose
    // meaning cannot be reconstructed.
    seq = 0
    const approval = event({ type: 'approval.granted', ageDays: 400 })
    const after = event({ type: 'diagnostics.heartbeat', ageDays: 400, causationId: approval.id })

    expect(protectedEventIds([approval, after]).has(after.id)).toBe(true)
  })

  it('leaves an unrelated branch alone', () => {
    // The rule is broad on purpose, but it is not "protect everything" — that
    // would make compaction pointless rather than safe.
    seq = 0
    const approval = event({ type: 'approval.granted', ageDays: 400 })
    const unrelated = event({ type: 'diagnostics.heartbeat', ageDays: 400 })

    const untouchable = protectedEventIds([approval, unrelated])

    expect(untouchable.has(approval.id)).toBe(true)
    expect(untouchable.has(unrelated.id)).toBe(false)
  })

  it('terminates on a log where two events cause each other', () => {
    seq = 0
    const first = event({ type: 'approval.granted', ageDays: 400 })
    const second = event({ type: 'diagnostics.heartbeat', ageDays: 400, causationId: first.id })
    const cyclic = { ...first, causationId: second.id }

    const untouchable = protectedEventIds([cyclic, second])

    expect(untouchable.size).toBe(2)
  })
})

describe('tiers', () => {
  it('follows Chapter 10 — 90 days hot, two years warm', () => {
    seq = 0

    expect(tierOf(event({ type: 'x.y', ageDays: 0 }), DEFAULT_RETENTION, NOW)).toBe('hot')
    expect(tierOf(event({ type: 'x.y', ageDays: 89 }), DEFAULT_RETENTION, NOW)).toBe('hot')
    expect(tierOf(event({ type: 'x.y', ageDays: 91 }), DEFAULT_RETENTION, NOW)).toBe('warm')
    expect(tierOf(event({ type: 'x.y', ageDays: 800 }), DEFAULT_RETENTION, NOW)).toBe('cold')
  })

  it('refuses a policy whose warm tier starts before its hot tier ends', () => {
    const parsed = RetentionPolicySchema.safeParse({
      ...DEFAULT_RETENTION,
      hotDays: 90,
      warmDays: 30,
    })

    expect(parsed.success).toBe(false)
  })

  it('thins nothing by default', () => {
    // FRIDAY is the wrong judge of what is worth keeping about her own
    // behaviour, so nothing is collapsed until the owner says what is noise.
    expect(DEFAULT_RETENTION.collapsible).toEqual([])
    expect(DEFAULT_RETENTION.dropBodiesOverBytes).toBeNull()
  })
})

describe('planning a compaction', () => {
  it('never plans anything for a protected event, however old', () => {
    seq = 0
    const events = PROTECTED_PATTERNS.map((pattern) =>
      event({
        type: pattern.replace('*', 'something'),
        ageDays: 3_000,
        payload: { body: 'x'.repeat(5_000) },
      }),
    )

    expect(planCompaction({ events, policy: CHATTY, now: NOW })).toEqual([])
  })

  it('never plans anything for a hot event', () => {
    seq = 0
    const fresh = event({
      type: 'test.event.emitted',
      ageDays: 1,
      payload: { note: 'x'.repeat(500) },
    })

    expect(planCompaction({ events: [fresh], policy: CHATTY, now: NOW })).toEqual([])
  })

  it('collapses only what the owner listed', () => {
    seq = 0
    const listed = event({ type: 'test.event.emitted', ageDays: 200 })
    const unlisted = event({ type: 'system.started', ageDays: 200 })

    const plans = planCompaction({ events: [listed, unlisted], policy: CHATTY, now: NOW })

    expect(plans.map((plan) => plan.eventId)).toEqual([listed.id])
    expect(plans[0]?.collapse).toBe(true)
    expect(plans[0]?.tier).toBe('warm')
  })

  it('drops a body only when it is over the size the owner set', () => {
    seq = 0
    const big = event({ type: 'system.started', ageDays: 200, payload: { body: 'x'.repeat(500) } })
    const small = event({ type: 'system.started', ageDays: 200, payload: { body: 'x' } })

    const plans = planCompaction({ events: [big, small], policy: CHATTY, now: NOW })

    expect(plans.map((plan) => plan.eventId)).toEqual([big.id])
    expect(plans[0]?.dropBody).toBe(true)
  })

  it('plans nothing when the policy permits nothing', () => {
    seq = 0
    const old = event({
      type: 'system.started',
      ageDays: 3_000,
      payload: { body: 'x'.repeat(9_000) },
    })

    expect(planCompaction({ events: [old], policy: DEFAULT_RETENTION, now: NOW })).toEqual([])
  })

  it('protects a chatty event that a protected one caused', () => {
    // The whole point of computing protection over the graph. This event is
    // old, listed as collapsible, and still untouchable.
    seq = 0
    const approval = event({ type: 'approval.granted', ageDays: 900 })
    const chatter = event({
      type: 'test.event.emitted',
      ageDays: 900,
      causationId: approval.id,
    })

    expect(planCompaction({ events: [approval, chatter], policy: CHATTY, now: NOW })).toEqual([])
  })
})
