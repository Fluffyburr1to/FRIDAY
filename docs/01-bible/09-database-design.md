# 09 — Database Design

> **Governing provisions:** Constitution Article I (The User — data belongs to the user), Article II
> (Transparency), Article IV (Privacy), Article V (Security), Article VI (Modularity); Manifesto
> Principle 4 (Privacy Is Fundamental).

---

## In plain language

The database is where everything FRIDAY knows is kept. Getting its design right early matters more
than almost anything else, because data outlives code. You will rewrite the agent system three
times over the next five years. You will not rewrite your data — you will migrate it, carefully,
every time, and every early mistake will be carried forward.

Three decisions define this chapter:

**One file.** FRIDAY's entire database is a single file on your Mac. Not a server, not a cloud
service — a file, like a document. You can copy it to a backup drive. You can see how big it is. If
you ever abandon this project, you can open it with free tools and read everything in it. That last
property is the practical meaning of "the user's data belongs to the user."

**Two kinds of data, kept apart.** There is the **record of what happened** — permanent,
append-only, never edited. And there is **current state** — your settings, cached calendar entries,
memory. The record is the truth; the state is a convenience derived from it. Keeping them
architecturally separate is what makes Article II's transparency guarantee real rather than a
promise.

**Sensitive data is encrypted separately from everything else.** Not the whole file — specific
fields, with keys held in your Mac's keychain. This means a stolen backup file does not expose your
credentials or your private notes.

---

## Recommendation

**SQLite** in WAL mode, accessed exclusively through **Drizzle ORM**, with **sqlite-vec** for
semantic search, and field-level encryption for sensitive columns.

Three separate database files, deliberately:

| File | Contents | Backup cadence | Growth |
|---|---|---|---|
| `friday.db` | Everything current: plans, memory, settings, connectors | Continuous | Moderate, bounded |
| `events.db` | The event log — every action FRIDAY has ever taken — **and the Guardian's authoritative state** | Continuous | Large, append-only |
| `cache.db` | Regenerable data: embeddings cache, API response cache | Never | Unbounded, disposable |

★ **The Guardian's four tables — `approvals`, `standing_grants`, `capabilities`, and
`guardian_decisions` — live in `events.db`, not in `friday.db`.** They are the one piece of state
that must be written in the *same transaction* as the event recording it: an approval that is
answered in one file and recorded in another can crash between the two, leaving either an authorized
action with no audit record or a log asserting an approval the state denies. Co-locating them makes
that window impossible rather than merely unlikely.
See [ADR-0032](../adr/0032-the-guardians-state-moves-into-the-event-log-database.md).

### Why three files rather than one

This is a small decision with large operational consequences.

**Different durability requirements.** The event log is irreplaceable — it is the audit trail. The
cache is worthless — delete it and it rebuilds. Backing them up together means backing up gigabytes
of disposable data continuously, and it means a corrupt cache page can jeopardize a backup of
irreplaceable records.

**Different write patterns.** The event log is append-only and write-heavy. Main data is
read-heavy with scattered updates. Separating them avoids write contention on SQLite's single-writer
lock, which is the main practical constraint of SQLite.

**Different growth rates.** The event log grows forever; main data plateaus. Separating them means
archiving old events is a self-contained operation that cannot disturb live data.

**The isolation cost:** you cannot write a transaction that spans two files. Accepted — the boundary
is drawn so that anything which must be written atomically with an event lives in `events.db`
alongside it. That is why the Guardian's state is there.

★ **`ATTACH` does not solve this, and an earlier version of this chapter said it did.** SQLite's
write-ahead-log documentation is explicit: *"Transactions that involve changes against multiple
ATTACHed databases are atomic for each individual database, but are not atomic across all databases
as a set."* Atomic commit across attached files depends on a super-journal, which is a rollback-mode
mechanism; WAL has no equivalent, and this chapter mandates WAL. The trap is that it *looks* like it
works — a cross-`ATTACH` transaction commits, and an explicit rollback correctly reverts both files.
Explicit rollback composes; crash atomicity does not. Co-location is the only remedy that holds.
See [ADR-0032](../adr/0032-the-guardians-state-moves-into-the-event-log-database.md).

---

## The core schema

Not exhaustive — the shapes that define the architecture. Full definitions live in
`packages/contracts` as Zod schemas, from which both TypeScript types and Drizzle tables are
derived.

### The event log — the foundation of everything

```
events
─────────────────────────────────────────────────────────────
  seq             INTEGER PRIMARY KEY   monotonic, gapless, the ordering authority
  id              TEXT UNIQUE           UUIDv7 — sortable by time
  type            TEXT                  'plan.step.completed'
  occurred_at     INTEGER               unix millis, when it actually happened
  recorded_at     INTEGER               when we wrote it (differs on replay/import)
  actor_type      TEXT                  'user' | 'agent' | 'system' | 'schedule'
  actor_id        TEXT                  which one
  principal_id    TEXT                  WHOSE data this concerns (multi-user seam)
  subject_type    TEXT                  what it happened to
  subject_id      TEXT
  causation_id    TEXT                  the event that directly caused this one
  correlation_id  TEXT                  the root request this belongs to
  trace_id        TEXT                  links to OpenTelemetry
  payload         TEXT                  JSON, validated against a versioned schema
  payload_version INTEGER               schema version for this event type
  sensitivity     TEXT                  'public'|'internal'|'private'|'secret'
  integrity_hash  TEXT                  SHA-256 of (this row + previous hash)
```

Four columns here deserve explanation because they carry most of the architectural weight.

**`causation_id` and `correlation_id` are what make "why?" answerable.** Correlation groups every
event from one root request. Causation forms a tree showing what led to what. When you ask FRIDAY
why she sent an email, the system walks backward through causation links — email sent, because step
4 executed, because you approved it, because the Guardian required approval, because the plan
included it, because the Chief of Staff decomposed your request this way, because you said this.
That chain is **recorded fact**, not a model's recollection. Principle 7 requires explanations that
are true, and this is the only mechanism that guarantees it.

**`principal_id` is the multi-user seam, present from day one.** Every event, and every row of user
data anywhere in the schema, carries the ID of the person it concerns. Today there is exactly one
value in that column. When family members are added, the isolation mechanism already exists and has
been exercised by every query ever written. Retrofitting this later means auditing every query in
the system and getting it right in all of them — a classic source of data leakage between accounts.
The cost now is one column and one rule; the cost later is a security review.

**`integrity_hash` makes the log tamper-evident.** Each event's hash includes the previous event's
hash, forming a chain. Altering or deleting a historical event breaks every hash after it, and the
diagnostics system verifies the chain periodically. This is not protection against a determined
attacker with write access — they could recompute the chain — but it reliably detects corruption,
accidental modification, and buggy code writing where it should not. For an audit trail the
Constitution depends on, "we would know if it changed" is a meaningful property.

**Immutability is enforced by the database, not by convention.** A SQLite trigger raises an error
on any `UPDATE` or `DELETE` against this table. Not a code review rule — a database constraint.

### Plans — durable, resumable work

```
plans                          plan_steps
──────────────────────────     ─────────────────────────────
  id                             id
  principal_id                   plan_id
  intent            TEXT         sequence         INTEGER
  status            TEXT         status           TEXT
    draft                          pending | running | awaiting_approval
    running                        completed | failed | skipped
    awaiting_approval            action_type      TEXT
    completed | failed           action_payload   JSON
    cancelled                    risk_class       TEXT
  created_at                     approval_id      → approvals.id
  updated_at                     agent_id
  completed_at                   result           JSON
  correlation_id                 error            JSON
  budget_tokens                  started_at / completed_at
  budget_cents                   attempt          INTEGER
  spent_tokens                   idempotency_key  TEXT
  spent_cents
```

**A plan is a row, not a running function.** This is the single most important consequence of the
schema. Because a plan is data, it survives restarts, can wait days in `awaiting_approval`, can be
inspected mid-flight in the dashboard, and can be resumed exactly where it stopped. Article III's
approval requirement is only practical because waiting costs nothing.

**`idempotency_key` prevents the worst class of bug in this system.** If FRIDAY crashes between
sending an email and recording that she sent it, resuming must not send it twice. Every external
action carries a key derived from the plan step; connectors use it to deduplicate.

**Budget columns are on the plan, not global.** A runaway agent exhausts its own plan's budget and
halts. This is the bulkhead from Chapter 05, expressed in the schema.

### Approvals — Article III in table form

**In `events.db`**, with the rest of the Guardian's state, so that answering an approval and
recording that it was answered are one transaction. The `plan_step.approval_id` reference above
therefore crosses a file boundary; it is a soft reference and always has been, never an enforced
foreign key.

```
approvals
────────────────────────────────────────────────
  id
  principal_id
  plan_id / plan_step_id
  status              pending | granted | denied | expired | withdrawn
  risk_class          low | medium | high | critical | self_modification
  title               plain language, one line
  explanation         JSON — what, why, risks, alternatives, confidence
  requested_at
  expires_at          pending approvals do not live forever
  responded_at
  responded_via       'desktop' | 'mobile' | 'voice' | 'cli' | 'standing_grant'
  response_note       optional user comment
  grant_id            → standing_grants.id, if auto-approved
```

`responded_via` exists so the Guardian can enforce channel restrictions — `self_modification`
approvals are rejected from mobile clients, per Chapter 08.

The `explanation` column is structured JSON, not prose, so the interface can render it consistently
and so it can be validated: an approval request missing its risk analysis is rejected before it
reaches you. Principle 7, enforced at the data layer.

```
standing_grants          ← Article III's "unless the user has intentionally granted permission"
──────────────────────
  id, principal_id
  action_pattern         'calendar.event.create'
  resource_pattern       'calendar:personal/*'
  constraints            JSON — amount ceilings, time windows, rate limits
  granted_at
  expires_at             ★ NOT NULL. Every grant expires.
  revoked_at
  use_count / max_uses
  last_used_at
```

**Every standing grant has a mandatory expiry.** A permission granted once and never reviewed is
how "the user is in command" quietly becomes false over three years. Chapter 19 sets maximum
durations by risk class.

### Memory — four layers, one table shape

```
memories
──────────────────────────────────────────────────
  id, principal_id
  layer            'working' | 'episodic' | 'semantic' | 'procedural'
  content          TEXT
  content_hash     dedupe
  source_event_id  → events.id   ★ provenance
  confidence       REAL 0–1
  sensitivity      'public'|'internal'|'private'|'secret'
  created_at / last_accessed_at / access_count
  expires_at       working memory expires; semantic may not
  superseded_by    → memories.id
  embedding        via sqlite-vec virtual table
```

**`source_event_id` is the anti-hallucination mechanism.** Every fact FRIDAY believes points back to
the event where she learned it. When she says "your meeting with Sarah is at 3," she can show that
this came from a calendar sync at 9:14am, not from a plausible guess. A memory without provenance
is not stored. Full design in [Chapter 16](16-memory-system.md).

**`superseded_by` rather than deletion.** When a fact changes, the old one is marked superseded and
kept. This preserves the ability to explain past decisions that were made on now-outdated
information — which is exactly when you most want an explanation.

### Credentials — never in the database

```
credentials
─────────────────────────────────
  id, principal_id, connector_id
  keychain_ref     TEXT  ← a POINTER to the OS keychain
  scopes           JSON
  expires_at
  last_refreshed_at
  last_used_at
```

**No secret value is ever stored in SQLite.** The database holds a reference; the actual token lives
in the macOS Keychain, protected by the OS and your login. A stolen `friday.db` yields no
credentials. This is Article V's "protect user data by default," and it is why the backup strategy
in Chapter 34 can be as simple as it is.

---

## Encryption strategy

Field-level, not whole-database. Three tiers:

| Sensitivity | Treatment | Rationale |
|---|---|---|
| `public` / `internal` | Plaintext | Searchable, indexable; no meaningful exposure |
| `private` | AES-256-GCM, key in Keychain | Personal content — notes, message bodies, health data |
| `secret` | Never in the database at all | Credentials, tokens — Keychain only |

**Why not encrypt the entire file with SQLCipher?** It was the leading alternative. Whole-file
encryption is simpler to reason about and protects everything uniformly. It was rejected because it
makes the database opaque to standard tooling — you could no longer inspect your own data with an
ordinary SQLite browser, which undermines the "your data belongs to you" property in a practical
way. It also prevents indexing and searching encrypted columns, and it adds a native dependency
that complicates builds.

Field-level encryption keeps the file readable, keeps non-sensitive data queryable, and puts strong
protection exactly where it is needed. The cost is that the *classification* must be right — a field
misclassified as `internal` is stored in the clear. Mitigated by making sensitivity a required
property on every schema in `packages/contracts`, so it cannot be forgotten, only decided wrongly.

---

## Migrations

Drizzle Kit generates SQL migration files that are committed to the repository and applied in
order. Rules:

1. **Migrations are forward-only.** No down-migrations. Rolling back a schema change on live data
   is a reliable way to lose data. Recovery from a bad migration is restore-from-backup, which is
   tested (Chapter 34).
2. **Every migration is preceded by an automatic backup.** The core takes a snapshot before applying
   anything, keeps the last five, and refuses to migrate if the snapshot fails.
3. **Additive by default.** Add columns; do not repurpose them. Deprecate before removing, with at
   least one release in between.
4. **Event payloads are versioned, never rewritten.** Old events keep their original shape forever.
   Readers handle every version — an upcaster converts old payloads to the current shape at read
   time. Rewriting historical events would break the integrity chain and destroy the audit trail's
   credibility.
5. **Migrations run in a transaction** and are verified by a post-migration integrity check.

---

## Alternatives considered

### PostgreSQL

**Advantages:** genuinely better in most respects — true concurrent writers, richer types, `pgvector`
for embeddings, mature replication, and the obvious choice if FRIDAY ever runs for several people
across machines.

**Rejected for now** because it requires running and maintaining a server process on your Mac,
managing users and passwords, and taking on backup complexity — all to serve one user on one
machine. It adds a daemon that can fail independently, which Article VII's simplicity argument
disfavors.

**This is a "when, not if" decision.** Drizzle speaks both dialects, and all access is confined to
`packages/storage`. The documented migration triggers:

- More than three concurrent human users
- The core moves to a machine separate from the data
- Write contention appears in monitoring (measured, not suspected)
- `friday.db` exceeds ~50 GB

### DuckDB

**Advantages:** far better analytical query performance; excellent for audit log analysis.

**Rejected as primary** because it is optimized for reads over writes, and FRIDAY's workload is
write-heavy transactional. **Retained as a possible read-only analytics attachment** over archived
event files at M8 — DuckDB can query Parquet directly, which is a natural fit for cold event
archives.

### A dedicated vector database (Chroma, Qdrant, Weaviate, LanceDB)

**Advantages:** better vector search performance at scale, richer filtering, purpose-built indexes.

**Rejected** because it means a second data store: a second process, a second backup, a second
failure mode, a second thing to secure, and the permanent problem of keeping two stores consistent
— a memory row exists in SQLite but its vector is missing from Qdrant, and now recall silently
fails. sqlite-vec keeps them in one transaction.

At FRIDAY's scale — tens of thousands of memories, not tens of millions — sqlite-vec is comfortably
sufficient. Revisit above roughly one million vectors or if recall latency exceeds the Chapter 35
budget.

### A graph database (Neo4j, KùzuDB) for memory relationships

**Advantages:** genuinely the right model for a knowledge graph of entities and relationships, which
is what FRIDAY's semantic memory eventually wants to be.

**Rejected for now** as premature. Relationships are modeled as a normal join table, which handles
the queries we can currently name. **This is the alternative most likely to become correct later** —
if memory queries become deeply relational ("who did I meet through Sarah who works in
biotech"), KùzuDB is embeddable and would fit alongside SQLite without a server. Flagged for
reassessment at M8.

### Files on disk instead of a database

**Rejected.** No transactions, no querying, no integrity guarantees. Attractive for portability, and
that concern is better met by the export mechanism below.

---

## Data ownership guarantees

Article I says the user is the highest authority. That has concrete data implications, implemented
as commands rather than promises:

| Guarantee | Mechanism |
|---|---|
| **You can read your data without FRIDAY.** | SQLite files, open format, readable by free tools forever. |
| **You can take it with you.** | `friday export --all` produces JSON + Parquet + attachments, documented and complete. |
| **You can delete it, genuinely.** | `friday forget <subject>` removes memories, redacts event payloads (preserving the hash chain by recording a tombstone rather than deleting the row), and revokes derived data. |
| **You can see what is stored.** | The dashboard's memory browser shows everything FRIDAY knows about a subject, with provenance. |
| **Nothing is stored you did not cause.** | Every memory has a `source_event_id`; the diagnostics system flags orphans. |

The deletion mechanism deserves a note: **redaction, not row deletion**. Deleting an event row
would break the integrity chain and make the audit trail unverifiable. Instead the payload is
replaced with a tombstone recording that content was redacted, by whom, and when. The chain holds,
the content is gone, and the fact of the deletion is itself auditable. This is the only design that
satisfies both Article II and Article IV simultaneously.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **SQLite allows one writer at a time.** | Accepted — WAL mode allows concurrent readers, and single-user write volume is far below the limit. Monitored. |
| **The event log grows forever.** | Accepted — compaction and archival to Parquet designed in from M1 (Chapter 10). |
| **Field-level encryption depends on correct classification.** | Accepted — mitigated by making sensitivity mandatory in every contract schema. |
| **Forward-only migrations mean a bad migration requires a restore.** | Accepted — automatic pre-migration snapshots and a tested restore procedure make this a 10-minute inconvenience. |
| **`principal_id` everywhere is overhead for a single user today.** | Accepted deliberately — one column now versus a security audit later. |
| **Three files means no cross-file transactions**, and `ATTACH` does not provide atomicity across them under WAL. | Accepted — anything that must be written atomically with an event lives in `events.db` beside it, which is why the Guardian's state is there ([ADR-0032](../adr/0032-the-guardians-state-moves-into-the-event-log-database.md)). |

---

## Review triggers

- Any PostgreSQL migration trigger above is met
- Vector count exceeds ~1M or recall latency exceeds budget → dedicated vector store
- Memory queries become deeply relational → evaluate KùzuDB alongside SQLite
- Write contention appears in monitoring
- Event log exceeds 5 GB post-compaction

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
