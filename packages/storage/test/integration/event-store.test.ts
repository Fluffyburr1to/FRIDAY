import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const FIELD_KEY_REF = 'field-encryption-key'
const PRINCIPAL = 'usr_owner'

const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

function anEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'test.event.emitted',
    actor: SYSTEM_ACTOR,
    principalId: PRINCIPAL,
    payload: { note: 'hello' },
    sensitivity: 'internal' as const,
    ...overrides,
  }
}

describe('the event log', () => {
  let directory: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-storage-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('runs its migrations on first open', () => {
    expect(storage.migrationsApplied).toEqual([
      'events:0001',
      'events:0002',

      // The Guardian's tables, in events.db rather than friday.db so an
      // approval and the event recording it share one transaction. ADR-0032.
      'events:0003',

      'main:0001',
      'main:0002',
    ])
  })

  it('starts empty', () => {
    expect(storage.events.latestSeq()).toBe(0)
    expect(storage.events.count()).toBe(0)
  })

  it('assigns gapless sequence numbers from 1', () => {
    // ★ Gapless is a stronger promise than monotonic, and it is what lets a
    // subscriber resume from "everything after 412" and know nothing between
    // 412 and where it restarted was skipped.
    for (let i = 0; i < 5; i += 1) {
      const appended = storage.events.append({ event: anEvent() })
      expect(appended.ok && appended.value.seq).toBe(i + 1)
    }

    expect(storage.events.count()).toBe(5)
  })

  it('assigns a sortable UUIDv7 and both timestamps', () => {
    const appended = storage.events.append({ event: anEvent() })

    expect(appended.ok).toBe(true)
    if (appended.ok) {
      expect(appended.value.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(appended.value.recordedAt).toBeGreaterThan(0)
      expect(appended.value.occurredAt).toBeGreaterThan(0)
    }
  })

  it('keeps a caller-supplied occurredAt distinct from recordedAt', () => {
    // They differ on replay and import, which is the whole reason there are
    // two columns rather than one.
    const appended = storage.events.append({ event: anEvent({ occurredAt: 1_700_000_000_000 }) })

    expect(appended.ok && appended.value.occurredAt).toBe(1_700_000_000_000)
    expect(appended.ok && appended.value.recordedAt).toBeGreaterThan(1_700_000_000_000)
  })

  it('reads events back with their payloads intact', () => {
    storage.events.append({ event: anEvent({ payload: { note: 'first' } }) })
    storage.events.append({ event: anEvent({ payload: { note: 'second' } }) })

    const read = storage.events.readAfter({ afterSeq: 0 })

    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.value.map((event) => event.payload.note)).toEqual(['first', 'second'])
    }
  })

  it('carries causation and correlation through unchanged', () => {
    // These are what make "why?" answerable from recorded fact rather than
    // from a model's recollection of its own reasoning.
    const root = storage.events.append({ event: anEvent() })
    expect(root.ok).toBe(true)
    if (!root.ok) return

    const child = storage.events.append({
      event: anEvent({ causationId: root.value.id, correlationId: root.value.id }),
    })

    expect(child.ok && child.value.causationId).toBe(root.value.id)
    expect(child.ok && child.value.correlationId).toBe(root.value.id)
  })

  it('reads the latest events newest first', () => {
    for (const note of ['a', 'b', 'c']) {
      storage.events.append({ event: anEvent({ payload: { note } }) })
    }

    const read = storage.events.readLatest({ limit: 2 })

    expect(read.ok && read.value.map((event) => event.payload.note)).toEqual(['c', 'b'])
  })

  it('filters by principal inside the query', () => {
    // ★ Never applied to results. Filtering afterwards lets a caller infer the
    // existence of records it may not see from a count.
    storage.events.append({ event: anEvent({ principalId: 'usr_owner' }) })
    storage.events.append({ event: anEvent({ principalId: 'usr_someone_else' }) })

    const mine = storage.events.readAfter({ afterSeq: 0, principalId: 'usr_owner' })

    expect(mine.ok && mine.value).toHaveLength(1)
    expect(mine.ok && mine.value[0]?.principalId).toBe('usr_owner')
  })

  it('honours the limit when reading', () => {
    for (let i = 0; i < 10; i += 1) storage.events.append({ event: anEvent() })

    const read = storage.events.readAfter({ afterSeq: 0, limit: 3 })

    expect(read.ok && read.value).toHaveLength(3)
  })
})
