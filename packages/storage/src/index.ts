/**
 * @friday/storage — the public surface.
 *
 * This is the ONLY file other packages may import from, and this package is
 * the ONLY one permitted to open the database. Both rules are enforced by
 * dependency-cruiser rather than by convention: `better-sqlite3`,
 * `drizzle-orm`, and `node:sqlite` are on a deny-list for every path outside
 * `packages/storage/`.
 *
 * Two properties to preserve, because both are cheap now and expensive to
 * retrofit:
 *
 *   1. Every query filters by `principal_id`.
 *   2. Permission filtering happens INSIDE the query, never applied to
 *      results — filtering afterwards lets a caller infer the existence of
 *      records it may not see from a count.
 *
 * See: README.md · docs/01-bible/09-database-design.md · docs/adr/0018
 */

export {
  createInMemoryKeyProvider,
  createKeychainKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
} from './crypto/key-provider.js'
export { openEventsReadOnly, openStorage, type Storage, type StorageOptions } from './database.js'
export { GENESIS_HASH } from './event-hash.js'
export { verifyArchive, type WrittenArchive, writeArchive } from './repositories/archive.js'
export type { ChainVerification } from './repositories/chain-verification.js'
export type { CheckpointStore, DeadLetter } from './repositories/checkpoint-store.js'
export type { AppendableEvent, EventStore } from './repositories/event-store.js'
export type { GuardianStores } from './repositories/guardian-stores.js'
export {
  type CompactionOutcome,
  type Maintenance,
  type SealedSegment,
  TOMBSTONE,
} from './repositories/maintenance.js'
export type { PlanStore } from './repositories/plan-store.js'
