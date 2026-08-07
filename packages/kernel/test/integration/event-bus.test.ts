import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayEvent, SYSTEM_ACTOR } from '@friday/contracts'
import { announceStart, createEventBus, type EventBus } from '@friday/kernel'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The event bus, end to end, against a real database.
 *
 * Mocked storage would prove nothing here: the guarantees under test —
 * durability before dispatch, the sync lane rolling back a write, gapless
 * ordering — are all properties of the transaction, and a fake transaction has
 * whichever properties the fake was given.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })
const PRINCIPAL = 'usr_owner'

/** Retries with no waiting, so a backoff test does not take eight seconds. */
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

describe('the event bus', () => {
  let directory: string
  let storage: Storage
  let bus: EventBus

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-kernel-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value

    bus = createEventBus({
      storage,
      principalId: PRINCIPAL,
      retry: FAST_RETRY,
      sleep: async () => undefined,
    })
  })

  afterEach(async () => {
    await bus.stop()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('records an event and returns it with its position', async () => {
    const published = await bus.publish(aTestEvent('hello'))

    expect(published.ok).toBe(true)
    if (published.ok) {
      expect(published.value.seq).toBe(1)
      expect(published.value.integrityHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('refuses an event type nobody registered', async () => {
    // Chapter 10 rule 4. AI assistants will add event types, and a malformed
    // one accepted quietly corrupts the log for every future reader.
    const published = await bus.publish({
      type: 'plan.created',
      actor: SYSTEM_ACTOR,
      principalId: PRINCIPAL,
      payload: {},
      sensitivity: 'internal',
    })

    expect(published.ok).toBe(false)
    if (!published.ok) expect(published.error.code).toBe('EVENT_TYPE_UNREGISTERED')
    expect(bus.latestSeq()).toBe(0)
  })

  it('refuses a payload that does not match its registered shape', async () => {
    const published = await bus.publish({
      type: 'test.event.emitted',
      actor: SYSTEM_ACTOR,
      principalId: PRINCIPAL,
      payload: { note: 42 },
      sensitivity: 'internal',
    })

    expect(published.ok).toBe(false)
    if (!published.ok) expect(published.error.code).toBe('EVENT_PAYLOAD_INVALID')
    expect(bus.latestSeq()).toBe(0)
  })

  it('lets a department register its own event type', async () => {
    // The registry is a registry, not a static list, because departments,
    // connectors, and plugins add their types as they load.
    const { z } = await import('zod')

    bus.registry.register({
      type: 'operations.backup.completed',
      payloadVersion: 1,
      schema: z.object({ bytes: z.int() }),
      maxSensitivity: 'internal',
      description: 'A backup finished.',
    })

    const published = await bus.publish({
      type: 'operations.backup.completed',
      actor: SYSTEM_ACTOR,
      principalId: PRINCIPAL,
      payload: { bytes: 1024 },
      sensitivity: 'internal',
    })

    expect(published.ok).toBe(true)
  })

  it('keeps the chain intact across many publishes', async () => {
    for (let i = 0; i < 20; i += 1) await bus.publish(aTestEvent(`note ${i}`))

    const verified = bus.verifyChain()

    expect(verified.ok && verified.value.intact).toBe(true)
    expect(verified.ok && verified.value.eventsChecked).toBe(20)
  })
})

describe('the sync lane', () => {
  let directory: string
  let storage: Storage
  let bus: EventBus

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-kernel-sync-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
    bus = createEventBus({
      storage,
      principalId: PRINCIPAL,
      retry: FAST_RETRY,
      sleep: async () => undefined,
    })
  })

  afterEach(async () => {
    await bus.stop()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('notifies matching subscribers before the publish returns', async () => {
    const seen: FridayEvent[] = []
    bus.subscribeSync({ id: 'audit', pattern: '*', handle: (event) => void seen.push(event) })

    await bus.publish(aTestEvent('hello'))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.seq).toBe(1)
  })

  it('respects patterns', async () => {
    const systemEvents: string[] = []
    bus.subscribeSync({
      id: 'system-watcher',
      pattern: 'system.*',
      handle: (event) => void systemEvents.push(event.type),
    })

    await bus.publish(aTestEvent('ignored'))
    await announceStart({ bus, principalId: PRINCIPAL, version: '0.0.0' })

    expect(systemEvents).toEqual(['system.started'])
  })

  it('rolls the event back when a sync subscriber throws', async () => {
    // ★ The guarantee: a projection that could not be updated means the event
    // did not happen. The audit trail and the system state cannot disagree.
    bus.subscribeSync({
      id: 'broken-projection',
      pattern: '*',
      handle: () => {
        throw new Error('projection is broken')
      },
    })

    const published = await bus.publish(aTestEvent('hello'))

    expect(published.ok).toBe(false)
    expect(bus.latestSeq()).toBe(0)
  })

  it('stops notifying after unsubscribe', async () => {
    let calls = 0
    const unsubscribe = bus.subscribeSync({
      id: 'counter',
      pattern: '*',
      handle: () => {
        calls += 1
      },
    })

    await bus.publish(aTestEvent('one'))
    unsubscribe()
    await bus.publish(aTestEvent('two'))

    expect(calls).toBe(1)
  })
})

describe('announceStart', () => {
  it('records that FRIDAY started', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'friday-kernel-start-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const bus = createEventBus({ storage: opened.value, principalId: PRINCIPAL })
    const started = await announceStart({ bus, principalId: PRINCIPAL, version: '0.1.0' })

    expect(started.ok).toBe(true)
    if (started.ok) {
      expect(started.value.type).toBe('system.started')
      expect(started.value.payload.version).toBe('0.1.0')
    }

    await bus.stop()
    opened.value.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('reports that she has not started when she cannot record it', async () => {
    // Chapter 10's most important line, at the one moment it matters most.
    const directory = mkdtempSync(join(tmpdir(), 'friday-kernel-nostart-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    vi.spyOn(opened.value.events, 'append').mockReturnValue({
      ok: false,
      error: { code: 'EVENT_LOG_UNWRITABLE', message: 'disk full' },
    })

    const bus = createEventBus({ storage: opened.value, principalId: PRINCIPAL })
    const started = await announceStart({ bus, principalId: PRINCIPAL, version: '0.1.0' })

    expect(started.ok).toBe(false)
    if (!started.ok) {
      expect(started.error.code).toBe('EVENT_LOG_UNWRITABLE')
      expect(started.error.message).toContain('has not started')
    }

    await bus.stop()
    opened.value.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
