import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { type Connection, closeDatabase, openDatabase } from './connection.js'
import type { KeyProvider } from './crypto/key-provider.js'
import { EVENTS_MIGRATIONS } from './migrations/events-migrations.js'
import { MAIN_MIGRATIONS } from './migrations/main-migrations.js'
import { migrate } from './migrations/runner.js'
import { type CheckpointStore, createCheckpointStore } from './repositories/checkpoint-store.js'
import { createEventStore, type EventStore } from './repositories/event-store.js'
import { createPlanStore, type PlanStore } from './repositories/plan-store.js'

/**
 * Opening FRIDAY's storage.
 *
 * Three files, deliberately — different durability requirements, different
 * write patterns, different growth rates. `events.db` is irreplaceable and
 * append-only; `friday.db` plateaus; `cache.db` is worthless and is not opened
 * at Milestone 1 because nothing generates cacheable data yet.
 *
 * The cost of three files is that a transaction cannot span two of them. The
 * boundary is drawn where that does not bind: the event log and the plan
 * tables are never written in one atomic step, because a plan's state is
 * derived from events rather than kept alongside them.
 *
 * Reference: docs/01-bible/09-database-design.md
 */

export interface StorageOptions {
  /** `friday.db` — plans, and later approvals and memory. */
  mainDbPath: string

  /** `events.db` — the immutable log. */
  eventsDbPath: string

  keys: KeyProvider

  /** The Keychain reference for the key that encrypts `private` payloads. */
  fieldKeyReference: string
}

export interface Storage {
  readonly events: EventStore
  readonly checkpoints: CheckpointStore
  readonly plans: PlanStore

  /** Which migrations ran on this open. Reported by `friday status`. */
  readonly migrationsApplied: readonly string[]

  close(): void
}

/**
 * Opens both databases and brings their schemas up to date.
 *
 * @param options - Paths, key provider, and the field key reference.
 * @returns Storage, or a typed error. Never throws — a database that will not
 *   open is exactly when the CLI's recovery commands have to keep working.
 */
export function openStorage(options: StorageOptions): Result<Storage, FridayError> {
  const eventsConnection = openDatabase({ path: options.eventsDbPath })
  if (!eventsConnection.ok) return eventsConnection

  const mainConnection = openDatabase({ path: options.mainDbPath })
  if (!mainConnection.ok) {
    closeDatabase(eventsConnection.value)
    return mainConnection
  }

  const applied = migrateBoth({
    events: { connection: eventsConnection.value, path: options.eventsDbPath },
    main: { connection: mainConnection.value, path: options.mainDbPath },
  })

  if (!applied.ok) {
    closeDatabase(eventsConnection.value)
    closeDatabase(mainConnection.value)
    return applied
  }

  const eventsDb = drizzle(eventsConnection.value)
  const mainDb = drizzle(mainConnection.value)

  return ok({
    events: createEventStore({
      db: eventsDb,
      keys: options.keys,
      fieldKeyReference: options.fieldKeyReference,
    }),
    checkpoints: createCheckpointStore(eventsDb),
    plans: createPlanStore(mainDb),
    migrationsApplied: applied.value,
    close() {
      closeDatabase(eventsConnection.value)
      closeDatabase(mainConnection.value)
    },
  })
}

/**
 * Migrates `events.db` first, then `friday.db`.
 *
 * Order matters if either fails: the event log is the one FRIDAY cannot
 * operate without, so it is proved first rather than left half-open behind a
 * failure in the less critical file.
 */
function migrateBoth(input: {
  events: { connection: Connection; path: string }
  main: { connection: Connection; path: string }
}): Result<string[], FridayError> {
  const eventsResult = migrate({
    connection: input.events.connection,
    migrations: EVENTS_MIGRATIONS,
    databasePath: input.events.path,
  })
  if (!eventsResult.ok) return eventsResult

  const mainResult = migrate({
    connection: input.main.connection,
    migrations: MAIN_MIGRATIONS,
    databasePath: input.main.path,
  })
  if (!mainResult.ok) return mainResult

  return ok([
    ...eventsResult.value.applied.map((id) => `events:${id}`),
    ...mainResult.value.applied.map((id) => `main:${id}`),
  ])
}

/**
 * Opens `events.db` read-only, for reading without taking a write lock.
 *
 * This is how `friday events tail` and `friday verify` work while the kernel
 * is running. WAL mode is what makes it possible at all: readers do not block
 * the writer and the writer does not block readers.
 *
 * @param input - The events database path, key provider, and key reference.
 * @returns A read-only event store, or a typed error.
 */
export function openEventsReadOnly(input: {
  eventsDbPath: string
  keys: KeyProvider
  fieldKeyReference: string
}): Result<{ events: EventStore; close(): void }, FridayError> {
  const connection = openDatabase({ path: input.eventsDbPath, readonly: true })
  if (!connection.ok) {
    return err(
      fridayError({
        code: 'STORAGE_UNAVAILABLE',
        message:
          `FRIDAY's event log at ${input.eventsDbPath} could not be opened for reading. ` +
          'If she has never run, it does not exist yet.',
        detail: { path: input.eventsDbPath },
        cause: connection.error.cause,
      }),
    )
  }

  return ok({
    events: createEventStore({
      db: drizzle(connection.value),
      keys: input.keys,
      fieldKeyReference: input.fieldKeyReference,
    }),
    close: () => closeDatabase(connection.value),
  })
}
