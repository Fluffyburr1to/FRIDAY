import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The two guarantees ADR-0028 separates.
 *
 *   1. The sequence is intact — nothing inserted, removed, or reordered.
 *   2. Every payload still present is the payload that was recorded.
 *
 * The point of splitting them is that deliberately removing content fails the
 * second on purpose while passing the first, which is the difference between
 * "this was redacted" and "this log is corrupt". Before this change those were
 * indistinguishable, which is why compaction could not be built at all.
 */

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

let directory: string
let storage: Storage

function open(): Storage {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })
  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)
  return opened.value
}

function emit(note: string): void {
  const appended = storage.events.append({
    event: {
      type: 'test.event.emitted',
      actor: { type: 'user', id: 'usr_tyler' },
      principalId: 'usr_tyler',
      payload: { note },
      sensitivity: 'internal',
    },
  })

  if (!appended.ok) throw new Error(`could not append: ${appended.error.message}`)
}

function verify() {
  const verified = storage.events.verifyChain()
  if (!verified.ok) throw new Error('verification could not run')
  return verified.value
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-chain-'))
  storage = open()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('an untouched log', () => {
  it('satisfies both guarantees', () => {
    for (const note of ['one', 'two', 'three']) emit(note)

    const result = verify()

    expect(result.intact).toBe(true)
    expect(result.sequenceIntact).toBe(true)
    expect(result.contentIntact).toBe(true)
    expect(result.eventsChecked).toBe(3)
    expect(result.contentRemoved).toBe(0)
  })

  it('still verifies after being closed and reopened', () => {
    // The chain is a statement about the file, not about the process that
    // wrote it. Reopening is the only way to assert that.
    for (const note of ['one', 'two']) emit(note)
    storage.close()

    storage = open()

    expect(verify().intact).toBe(true)
  })
})

describe('the migration that moved the chain onto a digest', () => {
  it('leaves a log that verifies, and does not run twice', () => {
    // The migration rewrites every hash in the log. A log that did not verify
    // afterwards would mean the rewrite was wrong, and the only evidence would
    // be this test.
    for (const note of ['one', 'two', 'three']) emit(note)
    expect(verify().intact).toBe(true)

    storage.close()
    storage = open()

    // Nothing re-applied: the ledger already has it.
    expect(storage.migrationsApplied).toEqual([])
    expect(verify().intact).toBe(true)
    expect(verify().eventsChecked).toBe(3)
  })

  it('records a digest for every event', () => {
    // Not directly observable through the public surface, so it is asserted
    // through the property it exists for: content verification, which cannot
    // work without one.
    emit('one')

    expect(verify().contentIntact).toBe(true)
  })
})

describe('the log is still append-only', () => {
  /** The database's own guarantee, tested against the database. */
  function rawConnection() {
    // Reaching past the repository is the point here: this asserts what the
    // file itself refuses, which is the guarantee that still holds when the
    // code above it is wrong. Legitimate inside this package's own tests; the
    // boundary rule is about other packages.
    const openDatabase = new Database(join(directory, 'events.db'))
    return openDatabase
  }

  it('refuses an ordinary update, exactly as it did at Milestone 1', () => {
    // ★ ADR-0028 replaced the M1 trigger with one that consults a narrow,
    // deliberately opened window. It did not loosen it. Outside that window
    // the behaviour has to be identical, and this is what proves it.
    emit('one')

    const connection = rawConnection()

    try {
      expect(() => connection.exec("UPDATE events SET payload = '{}' WHERE seq = 1")).toThrow(
        /append-only/,
      )
      expect(() => connection.exec('DELETE FROM events WHERE seq = 1')).toThrow(/append-only/)
    } finally {
      connection.close()
    }
  })

  it('permits a change only while a maintenance window is open', () => {
    emit('one')

    const connection = rawConnection()

    try {
      connection.exec('UPDATE maintenance_window SET open = 1 WHERE id = 1')
      expect(() =>
        connection.exec("UPDATE events SET compaction_reason = 'testing' WHERE seq = 1"),
      ).not.toThrow()

      connection.exec('UPDATE maintenance_window SET open = 0 WHERE id = 1')
      expect(() => connection.exec("UPDATE events SET payload = '{}' WHERE seq = 1")).toThrow(
        /append-only/,
      )
    } finally {
      connection.close()
    }
  })

  it('leaves the window closed when nothing has opened it', () => {
    const connection = rawConnection()

    try {
      const row = connection.prepare('SELECT open FROM maintenance_window WHERE id = 1').get() as {
        open: number
      }

      expect(row.open).toBe(0)
    } finally {
      connection.close()
    }
  })
})

describe('the two guarantees fail independently', () => {
  /** Changes a payload the way corruption or a stray tool would. */
  function tamper(seq: number): void {
    const connection = new Database(join(directory, 'events.db'))

    try {
      connection.exec('UPDATE maintenance_window SET open = 1 WHERE id = 1')
      connection
        .prepare('UPDATE events SET payload = ? WHERE seq = ?')
        .run('{"note":"something else"}', seq)
      connection.exec('UPDATE maintenance_window SET open = 0 WHERE id = 1')
    } finally {
      connection.close()
    }
  }

  it('catches altered content while proving the sequence was untouched', () => {
    // ★ The claim ADR-0028 exists to make. Before it, this was simply "the
    // chain is broken" and there was no way to tell it apart from a deliberate
    // redaction — which is why compaction could not be built at all.
    for (const note of ['one', 'two', 'three']) emit(note)
    storage.close()

    tamper(2)
    storage = open()

    const result = verify()

    expect(result.intact).toBe(false)
    expect(result.sequenceIntact).toBe(true)
    expect(result.contentIntact).toBe(false)
    expect(result.contentBrokenAtSeq).toBe(2)
    expect(result.brokenAtSeq).toBe(2)
    expect(result.reason).toContain('does not match the content that was recorded')
  })

  it('never reports a tampered log as intact, whichever field a caller reads', () => {
    // The trap this shape has to avoid: a nightly check that reads one field
    // and gets "fine" from a damaged log.
    for (const note of ['one', 'two']) emit(note)
    storage.close()

    tamper(1)
    storage = open()

    const result = verify()

    expect(result.intact).toBe(false)
    expect(result.brokenAtSeq).not.toBeNull()
  })

  it('catches a removed event as a broken sequence, not as missing content', () => {
    for (const note of ['one', 'two', 'three']) emit(note)
    storage.close()

    const connection = new Database(join(directory, 'events.db'))
    try {
      connection.exec('UPDATE maintenance_window SET open = 1 WHERE id = 1')
      connection.exec('DELETE FROM events WHERE seq = 2')
      connection.exec('UPDATE maintenance_window SET open = 0 WHERE id = 1')
    } finally {
      connection.close()
    }

    storage = open()
    const result = verify()

    expect(result.intact).toBe(false)
    expect(result.sequenceIntact).toBe(false)
    expect(result.reason).toContain('missing')
  })
})
