import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayEvent, SYSTEM_ACTOR } from '@friday/contracts'
import { backoffFor, createEventBus, type EventBus } from '@friday/kernel'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The async lane.
 *
 * The behaviour under test is the isolation promise: a failing subscriber
 * accumulates a backlog and eventually dead-letters, and it cannot block the
 * publisher or any other subscriber. That is what lets a department be added
 * next year without any risk to the event log.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })
const PRINCIPAL = 'usr_owner'

const FAST_RETRY = { baseMs: 0, maxMs: 0, maxAttempts: 3 }

function aTestEvent(note: string) {
  return {
    type: 'test.event.emitted',
    actor: SYSTEM_ACTOR,
    principalId: PRINCIPAL,
    payload: { note },
    sensitivity: 'internal' as const,
  }
}

describe('the async lane', () => {
  let directory: string
  let storage: Storage
  let bus: EventBus

  function openBus(): EventBus {
    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value

    return createEventBus({
      storage,
      principalId: PRINCIPAL,
      retry: FAST_RETRY,
      sleep: async () => undefined,
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-async-lane-'))
    bus = openBus()
  })

  afterEach(async () => {
    await bus.stop()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('delivers events to a subscriber', async () => {
    const seen: FridayEvent[] = []
    bus.subscribeAsync({
      id: 'memory-ingest',
      pattern: '*',
      handle: async (event) => void seen.push(event),
    })

    await bus.publish(aTestEvent('one'))
    await bus.publish(aTestEvent('two'))
    await bus.stop()

    expect(seen.map((event) => event.payload.note)).toEqual(['one', 'two'])
  })

  it('records how far each subscriber has got', async () => {
    bus.subscribeAsync({ id: 'memory-ingest', pattern: '*', handle: async () => undefined })

    await bus.publish(aTestEvent('one'))
    await bus.publish(aTestEvent('two'))
    await bus.stop()

    expect(storage.checkpoints.lastAcked('memory-ingest')).toBe(2)
  })

  it('does not let one subscriber’s failure affect another', async () => {
    // ★ The isolation promise. Without it, adding a department would put the
    // whole system at risk of that department's bugs.
    const healthy: number[] = []

    bus.subscribeAsync({
      id: 'broken',
      pattern: '*',
      handle: () => Promise.reject(new Error('always fails')),
    })
    bus.subscribeAsync({
      id: 'healthy',
      pattern: '*',
      handle: async (event) => void healthy.push(event.seq),
    })

    await bus.publish(aTestEvent('one'))
    await bus.publish(aTestEvent('two'))
    await bus.stop()

    expect(healthy).toEqual([1, 2])
    expect(storage.checkpoints.lastAcked('healthy')).toBe(2)
  })

  it('does not let a failing subscriber block the publisher', async () => {
    bus.subscribeAsync({
      id: 'broken',
      pattern: '*',
      handle: () => Promise.reject(new Error('always fails')),
    })

    // The publish resolves regardless — the event is durable before dispatch.
    const published = await bus.publish(aTestEvent('one'))

    expect(published.ok).toBe(true)
    expect(bus.latestSeq()).toBe(1)
  })

  it('retries before giving up', async () => {
    let attempts = 0

    bus.subscribeAsync({
      id: 'flaky',
      pattern: '*',
      handle: () => {
        attempts += 1
        return attempts < 3 ? Promise.reject(new Error('not yet')) : Promise.resolve()
      },
    })

    await bus.publish(aTestEvent('one'))
    await bus.stop()

    expect(attempts).toBe(3)
    expect(storage.checkpoints.lastAcked('flaky')).toBe(1)
    expect(storage.checkpoints.countDeadLetters()).toBe(0)
  })

  it('dead-letters an event it cannot handle, and moves on', async () => {
    // Advancing past a poisoned event is deliberate: without it a restart
    // would replay it forever and the subscriber would never see anything
    // newer. The dead-letter record is what keeps that from being a silent
    // loss.
    const seen: number[] = []

    bus.subscribeAsync({
      id: 'poisoned',
      pattern: '*',
      handle: (event) => {
        if (event.seq === 1) return Promise.reject(new Error('cannot handle this one'))

        seen.push(event.seq)
        return Promise.resolve()
      },
    })

    await bus.publish(aTestEvent('poison'))
    await bus.publish(aTestEvent('fine'))
    await bus.stop()

    expect(storage.checkpoints.countDeadLetters()).toBe(1)
    expect(storage.checkpoints.listDeadLetters()[0]).toMatchObject({
      subscriberId: 'poisoned',
      eventSeq: 1,
      attempts: FAST_RETRY.maxAttempts,
    })
    expect(seen).toEqual([2])
  })

  it('announces that a subscriber has stopped keeping up', async () => {
    // Article II: the owner sees it. A subscriber that quietly gave up is the
    // kind of failure nobody notices until they wonder why something stopped
    // happening a month ago.
    const degraded: FridayEvent[] = []

    bus.subscribeSync({
      id: 'degradation-watcher',
      pattern: 'system.degraded',
      handle: (event) => void degraded.push(event),
    })

    bus.subscribeAsync({
      id: 'broken',
      pattern: 'test.event.emitted',
      handle: () => Promise.reject(new Error('always fails')),
    })

    for (let i = 0; i < 3; i += 1) await bus.publish(aTestEvent(`event ${i}`))
    await bus.stop()

    expect(degraded).toHaveLength(1)
    expect(degraded[0]?.payload.component).toBe('broken')
  })

  it('respects patterns', async () => {
    const seen: string[] = []

    bus.subscribeAsync({
      id: 'system-only',
      pattern: 'system.*',
      handle: async (event) => void seen.push(event.type),
    })

    await bus.publish(aTestEvent('ignored'))
    await bus.publish({
      type: 'system.degraded',
      actor: SYSTEM_ACTOR,
      principalId: PRINCIPAL,
      payload: { component: 'x', reason: 'y', recoverable: true },
      sensitivity: 'internal',
    })
    await bus.stop()

    expect(seen).toEqual(['system.degraded'])
  })

  it('refuses two subscribers with the same id', () => {
    // The id is the key the checkpoint is stored under. Two subscribers
    // sharing one would each skip the events the other acknowledged.
    bus.subscribeAsync({ id: 'twin', pattern: '*', handle: async () => undefined })

    expect(() =>
      bus.subscribeAsync({ id: 'twin', pattern: '*', handle: async () => undefined }),
    ).toThrow(TypeError)
  })

  it('delivers what a subscriber missed while it was not running', async () => {
    // ★ At-least-once across a restart. Without catch-up, "the audit trail is
    // the message bus" would only be true while the process was up.
    await bus.publish(aTestEvent('while down 1'))
    await bus.publish(aTestEvent('while down 2'))
    await bus.stop()
    storage.close()

    const restarted = openBus()
    const seen: number[] = []

    restarted.subscribeAsync({
      id: 'late-arrival',
      pattern: '*',
      handle: async (event) => void seen.push(event.seq),
    })

    await restarted.start()
    await restarted.stop()

    expect(seen).toEqual([1, 2])

    bus = restarted
  })

  it('does not redeliver what a subscriber already acknowledged', async () => {
    bus.subscribeAsync({ id: 'resumer', pattern: '*', handle: async () => undefined })
    await bus.publish(aTestEvent('handled'))
    await bus.stop()
    storage.close()

    const restarted = openBus()
    const seen: number[] = []

    restarted.subscribeAsync({
      id: 'resumer',
      pattern: '*',
      handle: async (event) => void seen.push(event.seq),
    })

    await restarted.start()
    await restarted.publish(aTestEvent('new'))
    await restarted.stop()

    expect(seen).toEqual([2])

    bus = restarted
  })
})

describe('backoffFor', () => {
  const policy = { baseMs: 1_000, maxMs: 300_000, maxAttempts: 8 }

  it('doubles each attempt', () => {
    expect(backoffFor(1, policy)).toBe(1_000)
    expect(backoffFor(2, policy)).toBe(2_000)
    expect(backoffFor(3, policy)).toBe(4_000)
  })

  it('caps at the ceiling', () => {
    // A broken subscriber retries hourly rather than never, and rather than
    // hammering a failing dependency every second forever.
    expect(backoffFor(20, policy)).toBe(300_000)
  })
})
