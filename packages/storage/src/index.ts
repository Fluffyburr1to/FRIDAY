/**
 * @friday/storage — the public surface.
 *
 * This is the ONLY file other packages may import from, and this package is
 * the ONLY one permitted to open the database. Both rules are enforced by
 * dependency-cruiser rather than by convention: `better-sqlite3`,
 * `drizzle-orm`, and `node:sqlite` are on a deny-list for every path outside
 * `packages/storage/`.
 *
 * See: README.md · docs/01-bible/09-database-design.md · docs/adr/0018
 */

export {
  createInMemoryKeyProvider,
  createKeychainKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
} from './crypto/key-provider.js'
