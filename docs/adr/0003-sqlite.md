# ADR-0003 — SQLite as the primary datastore

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 09](../01-bible/09-database-design.md)

## Context

FRIDAY runs on the owner's Mac and holds their correspondence, calendar, memory, and the complete
audit trail of everything she has done. Data outlives code: the agent system may be rewritten three
times; the data will only ever be migrated.

## Decision

We will use **SQLite in WAL mode**, accessed exclusively through **Drizzle ORM** via a repository
layer in `packages/storage`, with **sqlite-vec** for semantic search and field-level encryption for
sensitive columns.

Three separate files: `friday.db` (current state), `events.db` (the immutable audit log), and
`cache.db` (regenerable, never backed up).

## Constitutional review

- **Article I (The User):** a single file in an open format the owner can read with free tools,
  forever — the practical meaning of "your data belongs to you."
- **Article IV (Privacy):** local by construction; no server, no port, no network exposure.
- **Article VII (Reliability):** fewer moving parts. No daemon that can fail independently.

- [x] Can we replace it? — Yes. All access is confined to `packages/storage`, and Drizzle speaks
      PostgreSQL. The migration is real work but not a rewrite.

## Alternatives considered

### PostgreSQL
**Advantages.** Genuinely better in most respects: true concurrent writers, richer types, pgvector,
mature replication. The obvious choice if FRIDAY ever serves several people across machines.
**Why rejected (for now).** Requires running and maintaining a server process, managing users and
passwords, and taking on backup complexity — to serve one user on one machine. This is a "when, not
if" decision with documented triggers rather than a permanent rejection.

### DuckDB
**Advantages.** Far better analytical query performance; excellent for audit log analysis.
**Why rejected.** Optimized for reads over writes; FRIDAY's workload is write-heavy transactional.
Retained as a possible read-only analytics attachment over archived Parquet at M8.

### A dedicated vector database (Chroma, Qdrant, Weaviate, LanceDB)
**Advantages.** Better vector search at scale; richer filtering.
**Why rejected.** A second data store means a second process, backup, failure mode, and thing to
secure — plus the permanent problem of keeping two stores consistent. A memory row present in
SQLite whose vector is missing from Qdrant means recall silently fails. sqlite-vec keeps both in
one transaction.

### A graph database for memory relationships
**Advantages.** Genuinely the right model for a knowledge graph.
**Why rejected as premature.** Relationships are a join table for now. **This is the alternative
most likely to become correct later**; KùzuDB is embeddable and would sit beside SQLite.

### Files on disk
**Why rejected.** No transactions, querying, or integrity guarantees. Its one virtue — portability
— is better served by the export mechanism.

## Consequences

**Positive**
- One file to back up, copy, and inspect. Litestream makes RPO 0 achievable for the audit trail.
- No server to secure or keep alive.
- The file format is a Library of Congress recommended preservation format.

**Negative**
- One writer at a time. Acceptable far below single-user volume; monitored.
- No cross-file transactions between the three databases. Boundaries were drawn where this does not
  bind; `ATTACH` covers the one case that matters.
- Field-level encryption depends on correct sensitivity classification.

## Reversibility

- **Cost to reverse:** medium
- **How:** Drizzle targets PostgreSQL; rewrite the connection layer and migrate data. Contained to
  one package.
- **Point of no return:** none, provided the repository layer holds.

## Review triggers

- More than three concurrent human users
- The core moves to a machine separate from the data
- Write contention appears in monitoring (measured, not suspected)
- `friday.db` exceeds ~50 GB
- Vector count exceeds ~1M or recall latency exceeds budget
