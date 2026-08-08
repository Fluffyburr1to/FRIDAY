import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryKeyProvider, openStorage, type Storage, writeArchive } from '@friday/storage'
import Database from 'better-sqlite3'
import { parquetMetadata } from 'hyparquet'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The physical shape of an archive file.
 *
 * Chapter 10 promises that cold events stay queryable — "slower, not gone" —
 * and names DuckDB. That promise was checked against DuckDB v1.5.5 by hand,
 * reading a real archive produced by this code: every row, the exact
 * millisecond timestamps, unicode payloads, nulls, and a `GROUP BY` over the
 * file. The runbook records how to repeat it.
 *
 * ★ This file is the guard that keeps the promise true afterwards. It asserts
 * the *physical* types, encodings, and codec — which is what a reader outside
 * FRIDAY actually depends on, and what a library upgrade could silently
 * change. The other archive tests read files back with the same library that
 * wrote them, so they would not notice.
 *
 * DuckDB itself is deliberately not a dependency here. It is 114 MB of
 * embedded database, and paying that on every CI run to re-prove a stable
 * file-format claim is the trade Chapter 18 says not to make. If any assertion
 * below changes, re-run the runbook before assuming the new shape is fine.
 *
 * Reference: docs/runbooks/archive-format.md · docs/01-bible/10-event-bus.md
 */

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

/**
 * What DuckDB was verified against.
 *
 * `INT64` reads as BIGINT and `BYTE_ARRAY` + `UTF8` reads as VARCHAR. Those
 * two mappings are the whole of the compatibility promise.
 */
const EXPECTED_SCHEMA: Readonly<Record<string, 'INT64' | 'BYTE_ARRAY'>> = {
  seq: 'INT64',
  id: 'BYTE_ARRAY',
  type: 'BYTE_ARRAY',
  occurred_at: 'INT64',
  recorded_at: 'INT64',
  actor_type: 'BYTE_ARRAY',
  actor_id: 'BYTE_ARRAY',
  principal_id: 'BYTE_ARRAY',
  subject_type: 'BYTE_ARRAY',
  subject_id: 'BYTE_ARRAY',
  causation_id: 'BYTE_ARRAY',
  correlation_id: 'BYTE_ARRAY',
  trace_id: 'BYTE_ARRAY',
  payload: 'BYTE_ARRAY',
  payload_digest: 'BYTE_ARRAY',
  payload_version: 'INT64',
  sensitivity: 'BYTE_ARRAY',
  integrity_hash: 'BYTE_ARRAY',
  compacted_at: 'INT64',
  compaction_reason: 'BYTE_ARRAY',
}

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

/** An archive containing the awkward cases: unicode, nulls, a big payload. */
async function archive(): Promise<string> {
  let previous: string | undefined

  for (const note of ['first', 'sécond — with unicode ✓', 'third']) {
    const appended = storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: { type: 'user', id: 'usr_tyler' },
        principalId: 'usr_tyler',
        payload: { note, big: 'x'.repeat(200) },
        sensitivity: 'internal',
        ...(previous === undefined ? {} : { causationId: previous }),
      },
    })

    if (!appended.ok) throw new Error('could not append')
    previous = appended.value.id
  }

  storage.close()

  const db = new Database(join(directory, 'events.db'))

  try {
    const written = await writeArchive({
      db,
      fromSeq: 1,
      toSeq: 3,
      archiveDirectory: join(directory, 'archive'),
    })

    if (!written.ok) throw new Error(`archive failed: ${written.error.message}`)
    return written.value.path
  } finally {
    db.close()
    storage = open()
  }
}

function metadataOf(path: string) {
  const bytes = new Uint8Array(readFileSync(path))
  return parquetMetadata(bytes.buffer)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-format-'))
  storage = open()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('what an outside reader sees', () => {
  it('writes every column as the physical type DuckDB was verified against', async () => {
    const metadata = metadataOf(await archive())

    const written = Object.fromEntries(
      metadata.schema
        .filter((element) => element.type !== undefined)
        .map((element) => [element.name, element.type]),
    )

    expect(written).toEqual(EXPECTED_SCHEMA)
  })

  it('marks every text column as UTF8, so it reads as VARCHAR rather than bytes', async () => {
    // Without the annotation a reader gets an opaque blob. Unicode payloads
    // were part of the manual check for exactly this reason.
    const metadata = metadataOf(await archive())

    for (const element of metadata.schema) {
      if (element.type !== 'BYTE_ARRAY') continue
      expect(element.converted_type, `${element.name} is not marked as text`).toBe('UTF8')
    }
  })

  it('leaves every column nullable, because most of them are', async () => {
    const metadata = metadataOf(await archive())

    for (const element of metadata.schema) {
      if (element.type === undefined) continue
      expect(element.repetition_type, `${element.name} is not optional`).toBe('OPTIONAL')
    }
  })

  it('uses only encodings and a codec a standard reader supports', async () => {
    // The likeliest way a library upgrade breaks an outside reader. Snappy and
    // these two encodings are the widely supported baseline.
    const metadata = metadataOf(await archive())
    const group = metadata.row_groups[0]
    if (group === undefined) throw new Error('no row group')

    const encodings = new Set<string>()
    for (const column of group.columns) {
      for (const encoding of column.meta_data?.encodings ?? []) encodings.add(String(encoding))
      expect(String(column.meta_data?.codec)).toBe('SNAPPY')
    }

    expect([...encodings].sort()).toEqual(['PLAIN', 'RLE_DICTIONARY'])
  })

  it('records the row count in the footer, which is how a reader plans a scan', async () => {
    const metadata = metadataOf(await archive())

    expect(Number(metadata.num_rows)).toBe(3)
  })

  it('keeps timestamps exact, well past what a 32-bit column could hold', async () => {
    // The bug that would otherwise have appeared on an unpredictable future
    // date rather than immediately.
    const path = await archive()
    const metadata = metadataOf(path)

    const occurredAt = metadata.schema.find((element) => element.name === 'occurred_at')
    expect(occurredAt?.type).toBe('INT64')

    const db = new Database(join(directory, 'events.db'))

    try {
      const row = db.prepare('SELECT occurred_at FROM events WHERE seq = 1').get() as {
        occurred_at: number
      }

      expect(row.occurred_at).toBeGreaterThan(2 ** 31)
    } finally {
      db.close()
    }
  })
})
