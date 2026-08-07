import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ Tamper evidence.
 *
 * The chain is not protection against an attacker with write access — they
 * could recompute it from the tampered point forward. It reliably detects
 * corruption, accidental modification, and buggy code writing where it should
 * not, and for an audit trail the Constitution depends on, "we would know if
 * it changed" is a meaningful property.
 *
 * These tests tamper with the file directly, behind the repository's back,
 * because that is the only way to prove the guarantee is about the bytes on
 * disk rather than about the code path that wrote them.
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

describe('the integrity chain', () => {
  let directory: string
  let eventsDbPath: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-chain-'))
    eventsDbPath = join(directory, 'events.db')

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath,
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value

    for (const note of ['first', 'second', 'third', 'fourth']) {
      storage.events.append({ event: anEvent(note) })
    }
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('verifies an untouched log', () => {
    const result = storage.events.verifyChain()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.intact).toBe(true)
      expect(result.value.eventsChecked).toBe(4)
      expect(result.value.brokenAtSeq).toBeNull()
    }
  })

  it('verifies an empty log', () => {
    // The genesis case. A chain of nothing is intact, and reporting otherwise
    // would make a fresh install look corrupt.
    const empty = mkdtempSync(join(tmpdir(), 'friday-chain-empty-'))
    const opened = openStorage({
      mainDbPath: join(empty, 'friday.db'),
      eventsDbPath: join(empty, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    expect(opened.ok).toBe(true)
    if (opened.ok) {
      const result = opened.value.events.verifyChain()
      expect(result.ok && result.value.intact).toBe(true)
      expect(result.ok && result.value.eventsChecked).toBe(0)
      opened.value.close()
    }

    rmSync(empty, { recursive: true, force: true })
  })

  it('detects an altered payload', () => {
    storage.close()

    // Behind the repository's back, and around the triggers, by disabling them
    // the way a corrupting bug or a curious person with sqlite3 would not
    // manage — which is the point: even a deliberate edit is detected.
    tamper(eventsDbPath, (raw) => {
      raw.exec('DROP TRIGGER events_are_append_only_update')
      raw.prepare('UPDATE events SET payload = ? WHERE seq = 2').run('{"note":"altered"}')
    })

    const result = reopen(eventsDbPath, directory).events.verifyChain()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.intact).toBe(false)
      expect(result.value.brokenAtSeq).toBe(2)
      expect(result.value.reason).toContain('does not match')
    }
  })

  it('detects a deleted event as a gap, naming the missing one', () => {
    storage.close()

    tamper(eventsDbPath, (raw) => {
      raw.exec('DROP TRIGGER events_are_append_only_delete')
      raw.prepare('DELETE FROM events WHERE seq = 3').run()
    })

    const result = reopen(eventsDbPath, directory).events.verifyChain()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.intact).toBe(false)
      expect(result.value.brokenAtSeq).toBe(3)
      // "event 3 is missing" sends you somewhere very different at two in the
      // morning than "hash mismatch at 4" would.
      expect(result.value.reason).toContain('missing')
    }
  })

  it('detects an altered actor, not only an altered payload', () => {
    // Every column is in the canonical form. A field left out of the hash
    // could be changed without detection, which is the one failure this whole
    // mechanism exists to prevent.
    storage.close()

    tamper(eventsDbPath, (raw) => {
      raw.exec('DROP TRIGGER events_are_append_only_update')
      raw.prepare('UPDATE events SET actor_id = ? WHERE seq = 1').run('usr_someone_else')
    })

    const result = reopen(eventsDbPath, directory).events.verifyChain()

    expect(result.ok && result.value.brokenAtSeq).toBe(1)
  })

  it('can verify only the recent tail of the log', () => {
    // Chapter 29's periodic check does not re-read years of history every
    // time; it starts where it left off, and still chains to the event before.
    const result = storage.events.verifyChain({ fromSeq: 3 })

    expect(result.ok && result.value.intact).toBe(true)
    expect(result.ok && result.value.eventsChecked).toBe(2)
    expect(result.ok && result.value.fromSeq).toBe(3)
  })

  it('still detects a break when verifying only the tail', () => {
    storage.close()

    tamper(eventsDbPath, (raw) => {
      raw.exec('DROP TRIGGER events_are_append_only_update')
      raw.prepare('UPDATE events SET payload = ? WHERE seq = 4').run('{"note":"altered"}')
    })

    const result = reopen(eventsDbPath, directory).events.verifyChain({ fromSeq: 3 })

    expect(result.ok && result.value.intact).toBe(false)
    expect(result.ok && result.value.brokenAtSeq).toBe(4)
  })
})

describe('append-only enforcement', () => {
  let directory: string
  let eventsDbPath: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-append-only-'))
    eventsDbPath = join(directory, 'events.db')

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath,
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
    storage.events.append({ event: anEvent('only') })
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('refuses an UPDATE at the database level', () => {
    // ★ Enforced by the database, not by code review. A rule that depends on
    // everyone remembering is a rule that holds for about three months.
    storage.close()
    const raw = new Database(eventsDbPath)

    expect(() => raw.prepare('UPDATE events SET type = ? WHERE seq = 1').run('x.y.z')).toThrow(
      /append-only/,
    )

    raw.close()
  })

  it('refuses a DELETE at the database level', () => {
    storage.close()
    const raw = new Database(eventsDbPath)

    expect(() => raw.prepare('DELETE FROM events WHERE seq = 1').run()).toThrow(/append-only/)

    raw.close()
  })
})

/** Edits the file directly, with the repository closed. */
function tamper(path: string, edit: (raw: Database.Database) => void): void {
  const raw = new Database(path)
  edit(raw)
  raw.close()
}

function reopen(eventsDbPath: string, directory: string): Storage {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath,
    keys,
    fieldKeyReference: FIELD_KEY_REF,
  })

  if (!opened.ok) throw new Error(opened.error.message)
  return opened.value
}
