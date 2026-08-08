import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { parquetReadObjects } from 'hyparquet'
import { parquetWriteBuffer } from 'hyparquet-writer'
import type { Connection } from '../connection.js'

/**
 * Writing a stretch of the log out to a Parquet file.
 *
 * Chapter 10's cold tier. Parquet rather than a private format so that "cold"
 * means slower rather than gone: the file is readable by DuckDB, pandas, and
 * anything else that speaks Parquet, without FRIDAY and without this code.
 * That is Article I applied to storage — the data stays the owner's even if
 * every line of this repository disappears.
 *
 * ★ **The order here is the whole of the safety.** Write the file, read it
 * back, compare it to what was supposed to be in it, and only then let the
 * rows be deleted. A single mistake in that sequence is permanent data loss,
 * so the verification is not optional and there is no flag to skip it.
 *
 * These two functions are async while the rest of this package is synchronous
 * ([ADR-0018](../../../docs/adr/0018-better-sqlite3-as-the-sqlite-driver.md)
 * chose a synchronous driver deliberately). That is safe precisely because of
 * the ordering above: both run BEFORE any maintenance window opens, so no
 * await ever happens with the event log writable. `sealAndRemove`, which does
 * open a window, stays synchronous.
 *
 * Reference: docs/01-bible/10-event-bus.md · ADR-0028
 */

/** What an archive holds. Flat, because Parquet columns are. */
interface ArchiveRow extends Record<string, unknown> {
  seq: number
  id: string
  type: string
  occurred_at: number
  recorded_at: number
  actor_type: string
  actor_id: string
  principal_id: string
  subject_type: string | null
  subject_id: string | null
  causation_id: string | null
  correlation_id: string | null
  trace_id: string | null
  payload: string
  payload_digest: string
  payload_version: number
  sensitivity: string
  integrity_hash: string
  compacted_at: number | null
  compaction_reason: string | null
}

/**
 * Every column, and the Parquet type it is written as.
 *
 * Declared rather than inferred, deliberately. Left to guess, the writer types
 * a millisecond timestamp as a 32-bit integer from its first value and then
 * refuses the first one that overflows — which would have made archival fail
 * at some unpredictable future date rather than immediately. Integers are
 * INT64 and carried as BigInt so nothing is rounded, and everything else is a
 * string, because that is what it is in the log.
 */
const COLUMNS: readonly { name: keyof ArchiveRow; type: 'INT64' | 'STRING' }[] = [
  { name: 'seq', type: 'INT64' },
  { name: 'id', type: 'STRING' },
  { name: 'type', type: 'STRING' },
  { name: 'occurred_at', type: 'INT64' },
  { name: 'recorded_at', type: 'INT64' },
  { name: 'actor_type', type: 'STRING' },
  { name: 'actor_id', type: 'STRING' },
  { name: 'principal_id', type: 'STRING' },
  { name: 'subject_type', type: 'STRING' },
  { name: 'subject_id', type: 'STRING' },
  { name: 'causation_id', type: 'STRING' },
  { name: 'correlation_id', type: 'STRING' },
  { name: 'trace_id', type: 'STRING' },
  { name: 'payload', type: 'STRING' },
  { name: 'payload_digest', type: 'STRING' },
  { name: 'payload_version', type: 'INT64' },
  { name: 'sensitivity', type: 'STRING' },
  { name: 'integrity_hash', type: 'STRING' },
  { name: 'compacted_at', type: 'INT64' },
  { name: 'compaction_reason', type: 'STRING' },
]

/** Parquet's INT64 takes BigInt; SQLite hands back a number. */
function forColumn(value: unknown, type: 'INT64' | 'STRING'): unknown {
  if (value === null || value === undefined) return null
  return type === 'INT64' ? BigInt(value as number) : value
}

/** What was written, and proof it reads back. */
export interface WrittenArchive {
  readonly path: string
  readonly fromSeq: number
  readonly toSeq: number
  readonly eventCount: number

  /** The integrity hash of the last event in the file. */
  readonly finalHash: string
}

/**
 * Writes a range of events to a Parquet file and verifies it reads back.
 *
 * Deletes nothing. The caller seals and removes afterwards, and only if this
 * succeeded — which is why this returns the range and the final hash rather
 * than doing the removal itself.
 *
 * @param input - The connection, the range, and where the archive lives.
 * @returns What was written, or why nothing should be deleted.
 */
export async function writeArchive(input: {
  db: Connection
  fromSeq: number
  toSeq: number
  archiveDirectory: string
}): Promise<Result<WrittenArchive, FridayError>> {
  const { db, fromSeq, toSeq, archiveDirectory } = input

  const rows = db
    .prepare('SELECT * FROM events WHERE seq >= ? AND seq <= ? ORDER BY seq ASC')
    .all(fromSeq, toSeq) as ArchiveRow[]

  const last = rows.at(-1)
  if (rows.length === 0 || last === undefined) {
    return err(
      fridayError({
        code: 'NOT_FOUND',
        message: `There are no events between ${fromSeq} and ${toSeq} to archive.`,
        detail: { fromSeq, toSeq },
      }),
    )
  }

  const path = join(archiveDirectory, `events-${pad(fromSeq)}-${pad(toSeq)}.parquet`)

  try {
    mkdirSync(dirname(path), { recursive: true })

    const buffer = parquetWriteBuffer({
      columnData: COLUMNS.map((column) => ({
        name: String(column.name),
        type: column.type,
        data: rows.map((row) => forColumn(row[column.name], column.type)),
      })),
    })

    writeFileSync(path, Buffer.from(buffer))
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_WRITE_FAILED',
        message: `FRIDAY could not write the archive at ${path}, so nothing was removed.`,
        detail: { path },
        cause,
      }),
    )
  }

  // ★ Read it back before anyone deletes anything. An archive nobody has
  // opened is a backup nobody has restored.
  const verified = await verifyArchive({ path, expected: rows })
  if (!verified.ok) return err(verified.error)

  return ok({
    path,
    fromSeq,
    toSeq,
    eventCount: rows.length,
    finalHash: last.integrity_hash,
  })
}

/**
 * Reads an archive back and checks it against what should be in it.
 *
 * Compares every column of every row, not a count and not a checksum of the
 * file. The file being well-formed is not the question; whether it holds the
 * events is.
 *
 * @param input - The archive path and the rows it should contain.
 * @returns Ok when the archive matches, or what is wrong with it.
 */
export async function verifyArchive(input: {
  path: string
  expected: readonly Record<string, unknown>[]
}): Promise<Result<number, FridayError>> {
  let readBack: Record<string, unknown>[]

  try {
    // Copied into an exactly-sized ArrayBuffer. Node hands back a Buffer that
    // is a window onto a shared pool, and passing that pool through as-is
    // gives the reader a view whose offsets do not mean what it thinks.
    const bytes = new Uint8Array(readFileSync(input.path))

    readBack = (await parquetReadObjects({
      file: bytes.buffer,
      utf8: true,
    })) as Record<string, unknown>[]
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_UNAVAILABLE',
        message: `The archive at ${input.path} could not be read back, so nothing was removed.`,
        detail: { path: input.path },
        cause,
      }),
    )
  }

  if (readBack.length !== input.expected.length) {
    return err(
      fridayError({
        code: 'VALIDATION_FAILED',
        message:
          `The archive at ${input.path} holds ${readBack.length} events but should hold ` +
          `${input.expected.length}. Nothing was removed.`,
        detail: { path: input.path },
      }),
    )
  }

  for (const [index, expected] of input.expected.entries()) {
    const actual = readBack[index]

    for (const column of COLUMNS) {
      // Compared as strings because an INT64 comes back as a BigInt. The point
      // is whether the value survived, not which JavaScript type carries it.
      const wanted = expected[column.name as string] ?? null
      const found = actual?.[column.name as string] ?? null

      if (String(wanted) !== String(found)) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message:
              `The archive at ${input.path} does not match the log at event ` +
              `${String(expected.seq)}. Nothing was removed.`,
            detail: { path: input.path, column: String(column.name) },
          }),
        )
      }
    }
  }

  return ok(readBack.length)
}

function pad(seq: number): string {
  return String(seq).padStart(12, '0')
}
