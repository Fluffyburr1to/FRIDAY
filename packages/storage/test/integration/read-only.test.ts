import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import {
  createInMemoryKeyProvider,
  openEventsReadOnly,
  openStorage,
  type Storage,
} from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Reading the log while the kernel is writing to it.
 *
 * This is what `friday events tail` and `friday verify` do, and it is only
 * possible because of WAL mode: readers do not block the writer and the writer
 * does not block readers. Without it, tailing the log would stall every event
 * FRIDAY was trying to record — the tool for watching her would stop her.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

function anEvent(note: string) {
  return {
    type: 'test.event.emitted',
    actor: SYSTEM_ACTOR,
    principalId: 'usr_owner',
    payload: { note },
    sensitivity: 'internal' as const,
  }
}

describe('the read-only event view', () => {
  let directory: string
  let eventsDbPath: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-readonly-'))
    eventsDbPath = join(directory, 'events.db')

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath,
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

  it('sees events written by the open writer', () => {
    storage.events.append({ event: anEvent('first') })

    const reader = openEventsReadOnly({ eventsDbPath, keys, fieldKeyReference: FIELD_KEY_REF })
    expect(reader.ok).toBe(true)
    if (!reader.ok) return

    expect(reader.value.events.count()).toBe(1)

    // ★ The tail behaviour: the writer keeps writing while the reader is open.
    storage.events.append({ event: anEvent('second') })

    const later = reader.value.events.readAfter({ afterSeq: 1 })
    expect(later.ok && later.value.map((event) => event.payload.note)).toEqual(['second'])

    reader.value.close()
  })

  it('verifies the chain without taking a write lock', () => {
    for (const note of ['a', 'b', 'c']) storage.events.append({ event: anEvent(note) })

    const reader = openEventsReadOnly({ eventsDbPath, keys, fieldKeyReference: FIELD_KEY_REF })
    expect(reader.ok).toBe(true)
    if (!reader.ok) return

    const verified = reader.value.events.verifyChain()
    expect(verified.ok && verified.value.intact).toBe(true)

    // The writer is unaffected and can still record.
    expect(storage.events.append({ event: anEvent('d') }).ok).toBe(true)

    reader.value.close()
  })

  it('explains a log that does not exist yet', () => {
    // Before FRIDAY has ever run there is no file, and `friday status` has to
    // say so rather than reporting a database error.
    const reader = openEventsReadOnly({
      eventsDbPath: join(directory, 'never-created.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    expect(reader.ok).toBe(false)
    if (!reader.ok) {
      expect(reader.error.code).toBe('STORAGE_UNAVAILABLE')
      expect(reader.error.message).toContain('never run')
    }
  })
})

describe('migration drift', () => {
  let directory: string

  function open() {
    return openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-drift-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('refuses to run when an applied migration has changed', () => {
    // Forward-only migrations are only safe if they are also immutable. An
    // edited one produces two machines with the same ledger and different
    // schemas, and the symptom shows up somewhere else entirely.
    const first = open()
    expect(first.ok).toBe(true)
    if (first.ok) first.value.close()

    const raw = new Database(join(directory, 'events.db'))
    raw.prepare('UPDATE _migrations SET checksum = ? WHERE id = ?').run('deadbeef', '0001')
    raw.close()

    const second = open()

    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('MIGRATION_FAILED')
      expect(second.error.message).toContain('forward-only')
    }
  })
})
