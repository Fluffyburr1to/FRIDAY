/**
 * @friday/storage — the public surface.
 *
 * This is the ONLY file other packages may import from, and this package is
 * the ONLY one permitted to open the database. Both rules are enforced by
 * dependency-cruiser, not by convention: `better-sqlite3` and `drizzle-orm`
 * are on a deny-list for every path outside `packages/storage/`.
 *
 * ── Deliberately empty ──────────────────────────────────────────────────────
 *
 * Connection management across the three database files, the Drizzle schema
 * derived from `contracts`, the repository functions, forward-only migrations,
 * and field-level encryption all arrive at Milestone 1 (Heartbeat).
 *
 * See: README.md · docs/01-bible/09-database-design.md · docs/adr/0018
 */

export {}
