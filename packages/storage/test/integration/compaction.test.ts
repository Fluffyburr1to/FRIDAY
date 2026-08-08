import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryKeyProvider, openStorage, type Storage, TOMBSTONE } from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Compaction, and the property it exists to preserve.
 *
 * ★ **After content is removed, the chain still verifies.** That is the whole
 * of ADR-0028: "the content is gone, and here is the proof that is all that
 * changed." Before it, removing a payload was indistinguishable from someone
 * tampering with the log.
 */

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

const NOW = 1_800_000_000_000

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

function emit(note: string): string {
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
  return appended.value.id
}

function verify() {
  const verified = storage.events.verifyChain()
  if (!verified.ok) throw new Error('verification could not run')
  return verified.value
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-compaction-'))
  storage = open()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('compacting an event', () => {
  it('leaves the chain verifying and reports the removal', () => {
    // ★ The assertion the whole design exists for.
    const ids = ['one', 'two', 'three'].map(emit)
    const target = ids[1]
    if (target === undefined) throw new Error('no event to compact')

    const done = storage.maintenance.compact({
      eventIds: [target],
      reason: 'routine housekeeping',
      now: NOW,
    })

    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.value.compacted).toBe(1)

    const result = verify()

    expect(result.sequenceIntact).toBe(true)
    expect(result.contentRemoved).toBe(1)

    // The content check does not flag it: the row says its content was removed
    // on purpose, so it is exempt rather than failing.
    expect(result.contentIntact).toBe(true)
    expect(result.intact).toBe(true)
  })

  it('survives a restart with the chain still intact', () => {
    const ids = ['one', 'two', 'three'].map(emit)
    const target = ids[0]
    if (target === undefined) throw new Error('no event to compact')

    storage.maintenance.compact({ eventIds: [target], reason: 'housekeeping', now: NOW })
    storage.close()
    storage = open()

    const result = verify()

    expect(result.intact).toBe(true)
    expect(result.contentRemoved).toBe(1)
    expect(result.eventsChecked).toBe(3)
  })

  it('replaces the payload with a tombstone and records why', () => {
    const target = emit('secret')
    storage.maintenance.compact({ eventIds: [target], reason: 'you asked me to forget', now: NOW })

    const connection = new Database(join(directory, 'events.db'))

    try {
      const row = connection
        .prepare('SELECT payload, compacted_at, compaction_reason FROM events WHERE id = ?')
        .get(target) as { payload: string; compacted_at: number; compaction_reason: string }

      expect(row.payload).toBe(TOMBSTONE)
      expect(row.payload).not.toContain('secret')
      expect(row.compacted_at).toBe(NOW)
      expect(row.compaction_reason).toBe('you asked me to forget')
    } finally {
      connection.close()
    }
  })

  it('is safe to run twice', () => {
    // A sweep that runs on a timer will overlap with itself eventually.
    const target = emit('one')

    const first = storage.maintenance.compact({ eventIds: [target], reason: 'sweep', now: NOW })
    const second = storage.maintenance.compact({ eventIds: [target], reason: 'sweep', now: NOW })

    expect(first.ok && first.value.compacted).toBe(1)
    expect(second.ok && second.value.compacted).toBe(0)
    expect(verify().contentRemoved).toBe(1)
  })

  it('ignores an event that is not there', () => {
    emit('one')

    const done = storage.maintenance.compact({
      eventIds: ['01930000-0000-7000-8000-00000000ffff'],
      reason: 'sweep',
      now: NOW,
    })

    expect(done.ok && done.value.compacted).toBe(0)
    expect(verify().intact).toBe(true)
  })

  it('does nothing at all when given nothing', () => {
    emit('one')

    const done = storage.maintenance.compact({ eventIds: [], reason: 'sweep', now: NOW })

    expect(done.ok && done.value.compacted).toBe(0)
    expect(verify().contentRemoved).toBe(0)
  })
})

describe('the window closes behind it', () => {
  it('leaves the log append-only again afterwards', () => {
    // ★ If this ever fails, the log has been left writable by a routine job.
    const target = emit('one')
    storage.maintenance.compact({ eventIds: [target], reason: 'sweep', now: NOW })

    const connection = new Database(join(directory, 'events.db'))

    try {
      const row = connection.prepare('SELECT open FROM maintenance_window WHERE id = 1').get() as {
        open: number
      }

      expect(row.open).toBe(0)
      expect(() => connection.exec("UPDATE events SET payload = '{}' WHERE seq = 1")).toThrow(
        /append-only/,
      )
    } finally {
      connection.close()
    }
  })
})

describe('sealing a range away', () => {
  it('removes the events and leaves the chain accounted for', () => {
    for (const note of ['one', 'two', 'three', 'four', 'five']) emit(note)

    const sealed = storage.maintenance.sealAndRemove({
      fromSeq: 1,
      toSeq: 3,
      archivePath: '/archive/0001-0003.parquet',
      now: NOW,
    })

    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return
    expect(sealed.value.eventCount).toBe(3)

    const result = verify()

    // The gap is accounted for by the seal, so it is not a break.
    expect(result.intact).toBe(true)
    expect(result.archivedSegments).toBe(1)
    expect(result.eventsChecked).toBe(2)
  })

  it('still calls an unaccounted gap a break', () => {
    // The seal is what makes a gap legitimate. Without one, a missing range is
    // exactly what the chain is for.
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
  })

  it('refuses to seal a range whose last event is not there', () => {
    emit('one')

    const sealed = storage.maintenance.sealAndRemove({
      fromSeq: 1,
      toSeq: 99,
      archivePath: '/archive/nope.parquet',
      now: NOW,
    })

    expect(sealed.ok).toBe(false)

    // And nothing was removed on the way to failing.
    expect(verify().eventsChecked).toBe(1)
  })

  it('survives a restart', () => {
    for (const note of ['one', 'two', 'three', 'four']) emit(note)
    storage.maintenance.sealAndRemove({
      fromSeq: 1,
      toSeq: 2,
      archivePath: '/archive/0001-0002.parquet',
      now: NOW,
    })

    storage.close()
    storage = open()

    const result = verify()

    expect(result.intact).toBe(true)
    expect(result.archivedSegments).toBe(1)

    const segments = storage.maintenance.segments()
    expect(segments.ok && segments.value[0]?.archivePath).toBe('/archive/0001-0002.parquet')
  })
})
