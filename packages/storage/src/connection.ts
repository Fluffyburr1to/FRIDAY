import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import Database from 'better-sqlite3'

/**
 * Opening a database file.
 *
 * ★ This package is the ONLY one permitted to do this, and the rule is
 * enforced by dependency-cruiser rather than by trust: `better-sqlite3`,
 * `drizzle-orm`, and `node:sqlite` are all on a deny-list for every path
 * outside `packages/storage/`.
 *
 * The reason is not purity. One place enforces field encryption, one place
 * enforces `principal_id` isolation, and one place changes when SQLite is
 * eventually replaced with PostgreSQL — which Chapter 09 treats as "when, not
 * if".
 *
 * Reference: docs/01-bible/09-database-design.md · docs/adr/0018
 */

/** A live handle. Deliberately opaque outside this package. */
export type Connection = Database.Database

/**
 * The pragmas every FRIDAY database uses, and why each one is set.
 *
 * These are applied on every open rather than persisted, because several of
 * them are per-connection and a database opened without them behaves subtly
 * differently — which is the worst way for a database to behave.
 */
const PRAGMAS: readonly string[] = [
  // Readers do not block the writer and the writer does not block readers.
  // This is what makes `friday events tail` possible while the kernel is
  // writing, and it is the single most important setting here.
  'journal_mode = WAL',

  // Wait for the write lock rather than failing instantly. SQLite allows one
  // writer at a time; five seconds of patience turns a spurious SQLITE_BUSY
  // into a slightly slower write.
  'busy_timeout = 5000',

  // FULL would fsync on every commit — safest, and far slower than we need on
  // a laptop with WAL. NORMAL can lose the last transactions in a power cut,
  // never corrupt the file. Accepted: the event log's guarantee is that a
  // committed event is not lost to a *crash*, and WAL+NORMAL provides that.
  'synchronous = NORMAL',

  // ★ Off by default in SQLite, which surprises everyone. Without it the
  // foreign keys in the schema are documentation rather than constraints.
  'foreign_keys = ON',

  // 64 MB of page cache. Negative means kibibytes rather than pages.
  'cache_size = -64000',
]

export interface OpenOptions {
  /** The file to open. Its directory is created if missing. */
  path: string

  /** Read-only handles are how the CLI tails the log without taking a lock. */
  readonly?: boolean
}

/**
 * Opens a database file, creating its directory if needed.
 *
 * @param options - The path, and whether the handle is read-only.
 * @returns The connection, or a typed error. Never throws: a database that
 *   will not open is the case where the CLI's recovery commands have to keep
 *   working, and they cannot do that if opening throws on the way in.
 */
export function openDatabase(options: OpenOptions): Result<Connection, FridayError> {
  try {
    if (options.readonly !== true) {
      mkdirSync(dirname(options.path), { recursive: true })
    }

    const connection = new Database(options.path, { readonly: options.readonly ?? false })

    for (const pragma of PRAGMAS) {
      // A read-only handle cannot change the journal mode, and does not need
      // to — WAL is a property of the file, already set by whoever created it.
      if (options.readonly === true && pragma.startsWith('journal_mode')) continue
      connection.pragma(pragma)
    }

    return ok(connection)
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_UNAVAILABLE',
        message: `FRIDAY could not open her database at ${options.path}.`,
        detail: { path: options.path, readonly: options.readonly ?? false },
        cause,
      }),
    )
  }
}

/**
 * Closes a connection, ignoring the case where it is already closed.
 *
 * @param connection - The handle to close.
 */
export function closeDatabase(connection: Connection): void {
  if (connection.open) connection.close()
}
