# @friday/storage

**The only package permitted to open the database.**

Milestone: **M1** · Load-bearing: **yes**

## Charter

All persistence goes through here. One place enforces encryption, one place enforces `principal_id`
isolation, and one place changes when SQLite is eventually replaced.

## What lives here

- SQLite connection management (WAL mode), across the three database files
- Drizzle schema definitions, derived from `contracts`
- Repository functions — the API every other package uses
- Migrations (forward-only, with automatic pre-migration snapshots)
- Field-level AES-256-GCM encryption for `private` and `secret` data
- Keychain integration for key material

## What does NOT

- Business logic. Repositories read and write; they do not decide.
- Secrets. **No credential value is ever stored in the database** — only Keychain references.

## Rules

1. **Every query filters by `principal_id`.** Exercised by every query written from M1, so
   multi-user isolation has been under test for years before a second person exists.
2. **Migrations are forward-only.** Recovery from a bad migration is restore-from-snapshot, which is
   tested nightly.
3. **Additive by default.** Add columns; do not repurpose them.
4. **Permission filtering happens *inside* the query**, never applied to results — so a caller
   cannot infer the existence of records it may not see from a count.

Reference: [Chapter 09](../../docs/01-bible/09-database-design.md)
