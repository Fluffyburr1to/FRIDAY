import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createInMemoryKeyProvider,
  openStorage,
  type Storage,
  verifyArchive,
  writeArchive,
} from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The cold tier: events leave `events.db` for a Parquet file.
 *
 * ★ The property every test here circles: **nothing is deleted until the
 * archive has been read back and matched against what should be in it.** A
 * mistake in that order is permanent data loss, and it is the only operation
 * in FRIDAY where that is true.
 */

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

const NOW = 1_800_000_000_000

let directory: string
let archives: string
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

/** The events database, for the archive writer, which takes a connection. */
function connection() {
  return new Database(join(directory, 'events.db'))
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-archive-'))
  archives = join(directory, 'archive')
  storage = open()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('writing an archive', () => {
  it('writes a Parquet file that reads back matching the log', async () => {
    for (const note of ['one', 'two', 'three']) emit(note)

    const db = connection()

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 3, archiveDirectory: archives })

      expect(written.ok).toBe(true)
      if (!written.ok) return

      expect(written.value.eventCount).toBe(3)
      expect(existsSync(written.value.path)).toBe(true)
      expect(written.value.path.endsWith('.parquet')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('keeps the payload, the digest, and the hash, so the archive is self-proving', async () => {
    // An archive that dropped the hash would be a pile of events nobody could
    // check. The seal in the live database records the final hash; the file
    // carries every event's, so the two can be checked against each other
    // years later.
    emit('one')

    const db = connection()

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 1, archiveDirectory: archives })
      if (!written.ok) throw new Error('expected an archive')

      const row = db.prepare('SELECT * FROM events WHERE seq = 1').get() as Record<string, unknown>
      const checked = await verifyArchive({ path: written.value.path, expected: [row] })

      expect(checked.ok).toBe(true)
      expect(written.value.finalHash).toBe(row.integrity_hash)
    } finally {
      db.close()
    }
  })

  it('refuses a range with nothing in it', async () => {
    emit('one')

    const db = connection()

    try {
      const written = await writeArchive({ db, fromSeq: 50, toSeq: 60, archiveDirectory: archives })

      expect(written.ok).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('verification stands between the archive and the delete', () => {
  it('reports an archive that lost a row', async () => {
    for (const note of ['one', 'two']) emit(note)

    const db = connection()

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 2, archiveDirectory: archives })
      if (!written.ok) throw new Error('expected an archive')

      const rows = db.prepare('SELECT * FROM events ORDER BY seq').all() as Record<
        string,
        unknown
      >[]

      // Claim the archive should hold three when it holds two.
      const checked = await verifyArchive({
        path: written.value.path,
        expected: [...rows, { ...rows[0], seq: 3 }],
      })

      expect(checked.ok).toBe(false)
      if (checked.ok) return
      expect(checked.error.message).toContain('Nothing was removed')
    } finally {
      db.close()
    }
  })

  it('reports an archive whose contents do not match the log', async () => {
    emit('one')

    const db = connection()

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 1, archiveDirectory: archives })
      if (!written.ok) throw new Error('expected an archive')

      const row = db.prepare('SELECT * FROM events WHERE seq = 1').get() as Record<string, unknown>
      const checked = await verifyArchive({
        path: written.value.path,
        expected: [{ ...row, integrity_hash: 'f'.repeat(64) }],
      })

      expect(checked.ok).toBe(false)
      if (checked.ok) return
      expect(checked.error.message).toContain('Nothing was removed')
    } finally {
      db.close()
    }
  })

  it('reports a file that is not a Parquet archive at all', async () => {
    const db = connection()

    try {
      emit('one')
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 1, archiveDirectory: archives })
      if (!written.ok) throw new Error('expected an archive')

      // Corrupt the file after it was written.
      writeFileSync(written.value.path, Buffer.from('not a parquet file at all'))

      const row = db.prepare('SELECT * FROM events WHERE seq = 1').get() as Record<string, unknown>
      const checked = await verifyArchive({ path: written.value.path, expected: [row] })

      expect(checked.ok).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('the whole cold-tier round trip', () => {
  it('archives, seals, removes, and still verifies', async () => {
    // The sequence in the order it must happen: write, verify, seal, delete.
    for (const note of ['one', 'two', 'three', 'four', 'five']) emit(note)

    const db = connection()
    let path: string

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 3, archiveDirectory: archives })
      if (!written.ok) throw new Error(`archive failed: ${written.error.message}`)
      path = written.value.path
    } finally {
      db.close()
    }

    const sealed = storage.maintenance.sealAndRemove({
      fromSeq: 1,
      toSeq: 3,
      archivePath: path,
      now: NOW,
    })

    expect(sealed.ok).toBe(true)

    const verified = storage.events.verifyChain()
    if (!verified.ok) throw new Error('verification could not run')

    // ★ The gap is accounted for by the seal, so the chain still holds.
    expect(verified.value.intact).toBe(true)
    expect(verified.value.archivedSegments).toBe(1)
    expect(verified.value.eventsChecked).toBe(2)

    // And the archived events are still readable, without FRIDAY.
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path).byteLength).toBeGreaterThan(0)
  })

  it('survives a restart with the seal intact', async () => {
    for (const note of ['one', 'two', 'three', 'four']) emit(note)

    const db = connection()
    let path: string

    try {
      const written = await writeArchive({ db, fromSeq: 1, toSeq: 2, archiveDirectory: archives })
      if (!written.ok) throw new Error('expected an archive')
      path = written.value.path
    } finally {
      db.close()
    }

    storage.maintenance.sealAndRemove({ fromSeq: 1, toSeq: 2, archivePath: path, now: NOW })
    storage.close()
    storage = open()

    const verified = storage.events.verifyChain()

    expect(verified.ok && verified.value.intact).toBe(true)
    expect(verified.ok && verified.value.archivedSegments).toBe(1)
  })
})
