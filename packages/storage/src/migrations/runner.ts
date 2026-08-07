import { createHash } from 'node:crypto'
import { copyFileSync, existsSync } from 'node:fs'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import type { Connection } from '../connection.js'

/**
 * The migration runner.
 *
 * Chapter 09's five rules, implemented rather than documented:
 *
 *   1. **Forward-only.** There are no down-migrations. Rolling back a schema
 *      change on live data is a reliable way to lose it; recovery from a bad
 *      migration is restore-from-snapshot.
 *   2. **Every migration is preceded by a snapshot**, and the runner refuses
 *      to proceed if the snapshot fails.
 *   3. Additive by default — a review rule, not something code can check.
 *   4. Event payloads are versioned, never rewritten.
 *   5. **Migrations run in a transaction**, so a failure leaves the schema
 *      exactly as it was.
 *
 * Plus one rule Chapter 09 implies but does not state: an already-applied
 * migration is checksummed, so editing one after it has run is caught here
 * rather than as a mysterious divergence between two machines months later.
 */

export interface Migration {
  /** Ordering key. Zero-padded so string ordering is numeric ordering. */
  readonly id: string

  /** Plain language, for the migration log and for `friday status`. */
  readonly name: string

  /** Forward SQL. May contain several statements. */
  readonly sql: string
}

export interface MigrationOutcome {
  readonly applied: readonly string[]
  readonly alreadyApplied: number
  readonly snapshotPath: string | undefined
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL,
    checksum   TEXT    NOT NULL
  ) STRICT;
`

interface LedgerRow {
  id: string
  checksum: string
}

/**
 * Applies every migration that has not run yet.
 *
 * @param input - The connection, the migrations in order, and the file path
 *   (used to take the pre-migration snapshot).
 * @returns Which migrations ran, or a typed error explaining what stopped.
 */
export function migrate(input: {
  connection: Connection
  migrations: readonly Migration[]
  databasePath: string
}): Result<MigrationOutcome, FridayError> {
  const { connection, migrations, databasePath } = input

  connection.exec(LEDGER)

  const applied = new Map(
    connection
      .prepare('SELECT id, checksum FROM _migrations')
      .all()
      .map((row) => {
        const { id, checksum } = row as LedgerRow
        return [id, checksum] as const
      }),
  )

  const drift = findDrift(migrations, applied)
  if (drift !== undefined) return err(drift)

  const pending = migrations.filter((migration) => !applied.has(migration.id))
  if (pending.length === 0) {
    return ok({ applied: [], alreadyApplied: applied.size, snapshotPath: undefined })
  }

  // Snapshot only when there is something to lose. `existsSync` is not the
  // test: opening a SQLite file creates it, so by the time we get here a
  // brand-new database always exists — and snapshotting it would leave an
  // empty `.snapshot` beside every fresh install. An empty ledger means no
  // migration has ever run, which means the file holds nothing of FRIDAY's.
  const snapshot = applied.size === 0 ? ok(undefined) : takeSnapshot(databasePath)
  if (!snapshot.ok) return snapshot

  try {
    connection.transaction(() => {
      const record = connection.prepare(
        'INSERT INTO _migrations (id, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      )

      for (const migration of pending) {
        connection.exec(migration.sql)
        record.run(migration.id, migration.name, Date.now(), checksum(migration))
      }
    })()
  } catch (cause) {
    return err(
      fridayError({
        code: 'MIGRATION_FAILED',
        message:
          `A database migration failed, and nothing was changed. ` +
          `${snapshot.value === undefined ? 'No snapshot was needed.' : `A snapshot is at ${snapshot.value}.`}`,
        detail: { pending: pending.map((migration) => migration.id) },
        cause,
      }),
    )
  }

  return ok({
    applied: pending.map((migration) => migration.id),
    alreadyApplied: applied.size,
    snapshotPath: snapshot.value,
  })
}

/**
 * Detects a migration that was edited after it ran.
 *
 * Forward-only migrations are only safe if they are also immutable. An edited
 * migration produces two machines with the same ledger and different schemas,
 * and the symptom appears somewhere else entirely.
 */
function findDrift(
  migrations: readonly Migration[],
  applied: ReadonlyMap<string, string>,
): FridayError | undefined {
  for (const migration of migrations) {
    const recorded = applied.get(migration.id)
    if (recorded !== undefined && recorded !== checksum(migration)) {
      return fridayError({
        code: 'MIGRATION_FAILED',
        message:
          `Migration ${migration.id} (${migration.name}) has changed since it was applied. ` +
          'Migrations are forward-only and immutable: add a new one instead of editing this.',
        detail: { id: migration.id },
      })
    }
  }

  return undefined
}

/**
 * Copies the database aside before anything is changed.
 *
 * The runner refuses to migrate if this fails. That is Chapter 09's rule and
 * it is the whole reason forward-only migrations are safe to adopt — without a
 * snapshot, "recovery is restore-from-backup" is not a plan.
 *
 * @returns The snapshot path, or `undefined` when the file is not there.
 */
function takeSnapshot(databasePath: string): Result<string | undefined, FridayError> {
  if (!existsSync(databasePath)) return ok(undefined)

  const path = `${databasePath}.${new Date().toISOString().replaceAll(':', '-')}.snapshot`

  try {
    copyFileSync(databasePath, path)
    return ok(path)
  } catch (cause) {
    return err(
      fridayError({
        code: 'MIGRATION_FAILED',
        message:
          'FRIDAY could not take a snapshot before migrating, so she did not migrate. ' +
          'A forward-only migration without a snapshot has no way back.',
        detail: { databasePath },
        cause,
      }),
    )
  }
}

function checksum(migration: Migration): string {
  // Whitespace-insensitive, so reformatting the SQL is not treated as drift
  // while a real change still is.
  const normalised = migration.sql.replaceAll(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalised).digest('hex')
}
