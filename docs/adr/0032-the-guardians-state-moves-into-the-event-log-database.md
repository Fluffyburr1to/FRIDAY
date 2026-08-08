# ADR-0032 — The Guardian's state moves into `events.db`

- **Status:** accepted
- **Date:** 2026-08-08
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [Chapter 34 — Disaster Recovery](../01-bible/34-disaster-recovery.md),
  [ADR-0003 — SQLite](0003-sqlite.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md),
  [ADR-0018 — better-sqlite3 as the SQLite driver](0018-better-sqlite3-as-the-sqlite-driver.md),
  [ADR-0019 — The hash chain is computed inside the append transaction](0019-the-hash-chain-is-computed-inside-the-append-transaction.md),
  [ADR-0024 — Compaction and archival are Milestone 2](0024-compaction-and-archival-are-milestone-2.md),
  [ADR-0027 — The Guardian's stores are ports that can fail](0027-the-guardians-stores-are-ports-that-can-fail.md),
  **[ADR-0031 — The clerk records what the Guardian decided](0031-the-clerk-records-what-the-guardian-decided.md)**

---

## Context

[ADR-0031](0031-the-clerk-records-what-the-guardian-decided.md) establishes that a clerk records
what the Guardian decided. It leaves open the question that turned out to be the hard one: **an
approval is two writes, and they are to two different files.**

Answering an approval today writes one row, in `friday.db`
([`approvals.ts:222`](../../packages/guardian/src/approvals.ts) → `store.replace`). Recording that
the owner answered writes one event, in `events.db`. Verified facts:

| Claim | Verified at |
|---|---|
| `openStorage` opens **two separate connections** | [`database.ts:74-77`](../../packages/storage/src/database.ts) — two `openDatabase` calls |
| There is **no `ATTACH`** anywhere in `packages/storage` | grep across `packages/storage/src` returns nothing |
| The Guardian's four tables live in `friday.db` | `GUARDIAN_MIGRATION` is in `MAIN_MIGRATIONS` ([`main-migrations.ts:83`](../../packages/storage/src/migrations/main-migrations.ts)) |
| The append transaction is on the **events** connection only | [`event-store.ts:146`](../../packages/storage/src/repositories/event-store.ts) — `db.transaction` where `db` is the events drizzle instance |
| The sync lane runs **inside** that transaction | [`event-store.ts:186`](../../packages/storage/src/repositories/event-store.ts) — *"a throw here rolls the insert back"* |
| **WAL is mandated on every connection** | [`connection.ts:36`](../../packages/storage/src/connection.ts) — *"the single most important setting here"* |

better-sqlite3 transactions are per-connection. So the sync lane's rollback guarantee — the
mechanism that ADR-0004 relies on to keep the audit trail and system state from disagreeing — **does
not reach the Guardian's tables.**

### The storage layer already stated the invariant this violates

[`database.ts:14-27`](../../packages/storage/src/database.ts), written at M1:

> *"The cost of three files is that a transaction cannot span two of them. **The boundary is drawn
> where that does not bind:** the event log and the plan tables are never written in one atomic
> step, because a plan's state is derived from events rather than kept alongside them."*

That is a correct and careful justification. The Guardian's tables were then placed in `friday.db`
as **authoritative state written independently of the log** — which is precisely the case where the
boundary *does* bind. The docstring's premise ("state is derived from events") is not true of the
Guardian's state, and nothing recorded that as a decision.

### ADR-0004 rejected another design for exactly this hazard

ADR-0004 rejected Redis Streams with: *"a crash between the Redis write and the SQLite state change
leaves them disagreeing."* That hazard now exists inside FRIDAY, between her own two files. ADR-0004
also assigns *"audit, projections, plan state"* to the synchronous lane, i.e. state is a projection
committed with the event. The Guardian's store is the one piece of state that is neither.

### What we did not know

That `ATTACH` — the mitigation Chapter 09 names twice — does not work under the pragmas this
repository mandates. That is established below and it removes the option Chapter 09 was relying on.

## Decision

We will **move the Guardian's four tables (`approvals`, `standing_grants`, `capabilities`,
`guardian_decisions`) out of `friday.db` and into `events.db`, and write the state change inside the
event's append transaction via the existing synchronous lane.**

One connection. One transaction. One write that either happens or does not.

```
bus.publish({ type: 'approval.granted', causationId: <requested event id>, … })
   └─ events.db transaction BEGIN
        ├─ INSERT INTO events …                     (the record)
        └─ onRecorded → UPDATE approvals SET …      (the state)   ★ same transaction
      COMMIT
```

The clerk validates **before** publishing (is it still pending, has it expired, may this surface
answer it) using the Guardian's existing rules, then publishes. The state write happens in the sync
lane; if it fails it throws, the append rolls back, and **the event never happened**.

Consequently:

| Semantic | How it holds |
|---|---|
| A failed event publication is **not** a Guardian denial | The clerk returns the publish error. `authorize` was never asked again and no `deny` is fabricated. ADR-0027's rule, unchanged. |
| A failed state write is **never** reported as an approval | The write is inside the transaction. Its failure rolls back the event and surfaces as an error; there is no path where the caller is told "approved". |
| Fail-closed stays honest | The caller receives `EVENT_LOG_UNWRITABLE` or `STORAGE_UNAVAILABLE` — an infrastructure failure, reported as one. No policy decision is manufactured from it. |

`packages/guardian` stays pure and synchronous. Its store *ports* are unchanged (ADR-0027); only
which file backs them changes, which the Guardian cannot observe.

### Amendment, 2026-08-08 — how the synchronous lane is actually reached

**The architectural decision above is unchanged.** Authoritative Guardian state and the event that
records it commit atomically in one `events.db` transaction. This amendment fixes only the sentence
describing *how* the clerk reaches that transaction, which named a capability the interfaces did not
have.

The gap, found while implementing: `EventBus.publish` hardcodes its `onRecorded` to dispatch
registered sync subscribers, and a `SyncSubscriber` receives **only the `FridayEvent`**. That is
enough to project `approval.granted` (the row already exists), but not `approval.requested` — the
`approval.requested` payload carries `approvalId decisionId title riskClass action resource
expiresAt requiredAuth`, while the row additionally requires `principalId`, `explanation`,
`preview`, `impact`, `actor`, `planId`, `planStepId`, `correlationId`, and `createdAt`. A sync
subscriber cannot construct it. The same gap blocks `requestedEventId`, because the event id is
generated by `uuidv7()` *inside* the append transaction and is therefore knowable only from the
written event.

**`EventBus.publish` gains an optional per-publish transactional hook**, and forwards it to the
`onRecorded` parameter that `EventStore.append` already exposes:

1. `publish` takes an optional second argument, a callback receiving the written event.
2. `EventBus` forwards it to `EventStore.append`'s existing transactional `onRecorded`.
3. The callback runs **inside the same `events.db` transaction** as the event insert. A throw rolls
   both back, and the event never happened.
4. The callback receives the **actual written event**, including its generated `id`, `seq`, and
   `integrityHash`.
5. This is how the clerk performs the authoritative Guardian and approval state mutation atomically
   with the recording of the event that describes it.
6. **Every existing caller is unchanged.** The parameter is optional and additive; omitting it
   produces exactly today's behaviour.
7. **`EventBus` stays generic and domain-agnostic.** It gains a transactional extension point, not
   knowledge of approvals, the Guardian, or any other domain.
8. **The clerk enters through `EventBus.publish`.** It must not call `EventStore.append` directly.
9. Registry validation, Guardian event-type registration in the clerk's composition, ordinary sync
   subscribers, and async dispatch all remain intact and run as they do today.

Two things this amendment explicitly does **not** license:

- **The `approval.requested` payload is not widened** to carry the explanation, preview, impact, or
  actor merely to make the transaction reachable. The payload shape is a contract about what an
  event means, not a workaround for a missing extension point.
- **No second production event-writing path is introduced.** The clerk does not become a second
  writer alongside the bus; the bus remains the only way an event reaches the log.

The alternatives weighed and rejected were: widening the payload (contract distortion); a
clerk-scoped stateful sync subscriber whose correctness rests on implicit non-interleaving rather
than on anything visible in a signature; and having the clerk call `EventStore.append` directly,
which would bypass registry validation — the very mechanism that enforces ADR-0031's
registration-scoping property — and create the second writer named above.

## The alternatives, and their crash windows

Each option is described by the state an observer finds after a crash **between** the two writes.
"Observable state" means what the dashboard (which reads the store) and `explain()` (which reads the
log) would each say.

### A — Store, then publish

**What it is.** `store.replace(settled)` commits; then `bus.publish('approval.granted')`.

**Crash window.** After the `friday.db` commit, before the `events.db` commit.

**Observable state.** The approval row says `approved`, with `responded_at` and `responded_via` set.
The log contains `approval.requested` and no answer. The dashboard shows the approval as answered;
`explain()` shows FRIDAY asking and the owner never replying. If the action proceeded on the
strength of the store, **an authorized action exists with no audit record of the authorization.**

**Why rejected.** It is the worst of the four, and it fails silently. Article II is violated in the
direction that cannot be detected by reading either store on its own — each is internally
consistent. A later `sweepExpired` would eventually mark the log's dangling request as expired,
producing an `approval.expired` event for an approval the system already acted on.

### B — Publish, then store

**What it is.** `bus.publish('approval.granted')` commits; then `store.replace(settled)`.

**Crash window.** After the `events.db` commit, before the `friday.db` commit.

**Observable state.** The log says the owner approved. The approval row is still `pending`. The
dashboard offers the owner the same approval again, and answering it a second time writes a
**second** `approval.granted` for one request — two recorded consents to one act. `sweepExpired` may
later expire a request the log says was granted, adding `approval.expired` after `approval.granted`
in the same chain.

**Why rejected.** It never loses a record, which is genuinely better than A. But it duplicates
decisions, and a duplicated consent is worse than a missing one in a system whose whole claim is
that consent is specific. It also makes the log assert something the state denies, with no way for a
reader to tell which is right.

### C — Event log as the source of truth, projection in `friday.db`

**What it is.** ADR-0004's model applied across the existing file split: the event is the only
authoritative write; the `friday.db` tables become a projection rebuilt by a subscriber.

**Crash window.** After the `events.db` commit, before the projection catches up. Bounded by the
subscriber's lag, not by a single instruction.

**Observable state.** Same as B during the window — log says granted, projection says pending — but
with a decisive difference: **the divergence is repairable**, because the projection is derived and
can be rebuilt from the log. Nothing is lost; something is stale.

**Why rejected.** Honestly, this is the second-best option and it is architecturally correct. It is
rejected for two reasons. First, staleness in *this* projection is not benign: the projection is
what the clerk reads to decide whether an approval is still answerable, so a stale projection can
accept an answer to an approval the log already settled — the duplicate-consent failure from B,
reintroduced through the back door. Second, it converts the Guardian's stores from authoritative
state into derived state, which is a substantially larger rewrite of shipped M2 code than option E,
for a weaker guarantee. If the tables are going to be reworked, they should be reworked into a
design with no window at all.

**Note:** the *discipline* of C — the event is the write, the table is a projection — is adopted by
the chosen option. What is rejected is running it across two files.

### D — `ATTACH` the two databases and use one transaction

**What it is.** Chapter 09's stated mitigation, twice: *"the event-writing path uses SQLite's
`ATTACH` for the one case where it is (recording an event and updating a projection atomically)"*
(line 64), and *"`ATTACH` covers the one case that matters"* (line 391).

**Advantages.** No schema move, no migration, no change to the file layout the Bible describes. If
it worked it would be the cheapest correct answer by a wide margin.

**Why rejected — it does not work under WAL.** SQLite's write-ahead-log documentation states, under
the disadvantages of WAL mode:

> "Transactions that involve changes against multiple ATTACHed databases are atomic for each
> individual database, but are not atomic across all databases as a set."

Atomic commit across attached files relies on a super-journal, which is a rollback-mode mechanism;
WAL mode has no equivalent. `connection.ts:36` mandates `journal_mode = WAL` on every open and calls
it *"the single most important setting here"*, because WAL is what lets `friday events tail` read
while the kernel writes — the M1 demonstrable outcome. Abandoning WAL to make `ATTACH` atomic would
trade a crash window for a live-usability regression.

★ **This was tested rather than assumed, and the test is misleading.** A cross-`ATTACH` transaction
under WAL was run against this repository's own better-sqlite3 (13.0.3): a transaction spanning both
files commits, and an explicit `throw` rolls **both** back correctly. Explicit rollback composes;
crash atomicity does not. Anyone who verifies `ATTACH` the obvious way will conclude it works. That
is exactly how this would have shipped as a latent fault.

**Chapter 09 must be corrected.** Its claim is wrong for this codebase as configured, and it is the
kind of wrong that gets relied upon.

### E — Move the Guardian's tables into `events.db` (**chosen**)

**What it is.** `GUARDIAN_MIGRATION` moves from `MAIN_MIGRATIONS` to `EVENTS_MIGRATIONS`. The
Guardian's stores are constructed on the events connection. The state write happens in the sync
lane, inside the append transaction.

**Crash window.** **None.** One SQLite transaction on one connection. The event and the state change
commit together or neither does. A crash mid-transaction rolls back both; a crash after commit has
both.

**Why chosen.** It is the only option that removes the problem rather than managing it, and the
analysis below shows the cost is unusually low *right now* and rises with every week of delay.

## Analysing the chosen option honestly

### Migration

**There is no data to migrate.** Verified: no `.db` file exists anywhere in the repository or in
`~/.friday`, and `CHANGELOG.md` records that nothing has been released. Tests construct fresh
databases per run.

So the "migration" is: move one constant between two arrays, and construct the stores on the other
connection. There is no copy step, no dual-write period, no backfill, and no risk of a partial move
— which is fortunate, because moving a populated table between two SQLite files is itself a
non-atomic operation and would have needed its own recovery design.

**This is the cheapest moment this change will ever have**, and the cost is not linear: the first
real `approvals` row the owner cares about turns a constant edit into a data migration with a
recovery procedure, under forward-only migrations (Chapter 09) where a bad migration requires a
restore.

### Foreign keys

The obvious objection is that Chapter 09 line 142 shows `plan.approval_id → approvals.id`, and
`foreign_keys = ON` is set ([`connection.ts:51`](../../packages/storage/src/connection.ts)). A real
foreign key cannot cross files.

**Verified: no such foreign key exists.** In
[`main-migrations.ts:61`](../../packages/storage/src/migrations/main-migrations.ts),
`plan_steps.approval_id` is a bare `TEXT` column; the only `REFERENCES` on that table is `plan_id →
plans(id)`, which stays entirely within `friday.db`. Likewise `guardian_decisions.approval_id`,
`approvals.plan_id`, and `capabilities.plan_id`
([`guardian-migration.ts`](../../packages/storage/src/migrations/guardian-migration.ts) lines 169,
59, 132) are all bare `TEXT`. Every reference that would cross the proposed boundary is already
soft.

That is not luck — it is the M1 authors correctly anticipating that these tables might not share a
file. The objection dissolves.

### Locking and contention

Chapter 09's stated reason for splitting the files is write contention: SQLite allows one writer per
database, the log is append-heavy, and main data has scattered updates.

Moving the Guardian's tables into `events.db` puts approval writes behind the same write lock as
event appends. At FRIDAY's volume — a single user, *"thousands per day"* by Chapter 09's own
estimate — this is negligible, and `busy_timeout = 5000` absorbs transient contention. Under the
chosen design the approval write is not even a separate lock acquisition: it happens inside the
append transaction that was already being taken.

**The real contention risk is compaction.** ADR-0024 puts compaction and archival on the event log,
and those rewrite it in bulk while holding the write lock. Approval writes would now queue behind
them. This is a genuine negative and is recorded as such below; the mitigation is that compaction
must be incremental and batched, which Chapter 10 already requires for unrelated reasons.

### Recovery and disaster recovery

This is the strongest argument for the move, and it was not obvious at the outset.

Chapter 34 and M5 plan Litestream replication of `events.db`. Under the current split, the
Guardian's state and the log are two files replicated independently; a point-in-time restore can
land on a moment where they disagree, and **there is no way to make a two-file restore consistent**.
The divergence would be silent and permanent, in the records that matter most.

Under the move, the log and the Guardian's state are the same file. A restore lands on one
transaction boundary and yields a log and a state that agree by construction. Recovery gets simpler
and strictly more correct.

### Architectural consequences

- **Chapter 09 must be amended** in two places: the file-contents table (line 44 lists approvals
  under `friday.db`) and the `ATTACH` claims (lines 64–67 and 391). This is a Bible change and needs
  the owner's deliberate decision, not a passing edit.
- **`events.db` stops being purely append-only.** It gains four mutable tables. The `EventStore`
  itself remains append-only and `maintenance` remains the only path permitted to change the log
  ([`database.ts:51-58`](../../packages/storage/src/database.ts)), so the discipline survives — but
  it becomes a **per-table** discipline rather than a per-file one, which is weaker and easier to
  erode. This is the most real of the costs.
- **`openEventsReadOnly`** — the CLI's recovery handle — would also expose the Guardian's tables.
  Not harmful (it is read-only, and the CLI already reads approvals through storage elsewhere), but
  it widens what "open the log for reading" means.
- **The plan tables face the same question at M3.** This ADR deliberately does not move them. Plan
  state genuinely *is* derived from events per ADR-0004, so the `database.ts` justification holds
  for plans as written. If that turns out to be false when the plan engine lands, this ADR is the
  precedent for what to do.

### Reconciliation with ADR-0004

ADR-0004 promised three things. After this decision:

| ADR-0004's guarantee | Status |
|---|---|
| *"Every meaningful action is written and committed before it is acted upon"* | **Restored.** It was not true for authorization at all — no Guardian event was ever written. |
| *"A synchronous lane running in the same transaction as the event write (audit, projections, plan state)"* | **Made true for the Guardian's state**, which is currently the one piece of state outside it. |
| *"The audit trail is not a separate system that could drift — it is the bus"* | **Restored for authorization.** Today the Guardian's records and the log are two systems that cannot drift only because one of them is empty. |
| *Redis rejected because "a crash … leaves them disagreeing"* | **Consistent.** The objection applied to FRIDAY's own file split and is now removed rather than tolerated. |

Nothing in ADR-0004 is weakened. One of its guarantees was aspirational for the Guardian and becomes
literal.

## Constitutional review

- **Article II (Transparency):** the decision exists so that an approval cannot be true in one place
  and absent in another. A divergence between state and log is a transparency failure that no reader
  can detect.
- **Article III (Consent):** protects against the duplicate-consent failure in options B and C — one
  act, one recorded consent.
- **Article VII (Reliability):** removes a crash window rather than documenting it.
- **Principle 7 (Explainability):** an explanation assembled from a log that disagrees with state is
  a confident wrong answer, which is worse than no answer.

**The five questions:**

- [x] **Can the user see it?** Yes — and the point is that what they see cannot contradict what
      happened.
- [x] **Can the user stop it?** Unchanged. No authorization semantics move.
- [x] **Can we replace it?** SQLite is behind `packages/storage`. A PostgreSQL migration (Chapter
  09's
      "when, not if") makes this trivial, since one database with two schemas is the normal shape
      there.
- [x] **Can we explain it?** Yes.
- [x] **Will this still be right in five years?** Yes, with one caveat: if `events.db` growth forces
      aggressive archival, co-locating mutable state with an archived log deserves re-examination.
      Recorded as a review trigger.

**Notes:** The honest tension is with Chapter 09's file-split rationale, which is a good piece of
reasoning that did not anticipate authoritative state needing to be written atomically with the log.
The chapter is not wrong about growth and contention; it is wrong that the boundary was drawn where
the constraint does not bind.

## Acceptance criteria

1. **Atomicity under failure.** With the approval state write forced to fail inside the sync lane, a
   published `approval.granted` **does not appear in the log** and the approval row is
   **unchanged**. Asserted by reading both after the failure. The existing `breakableStore` helper
   ([`failing-stores.ts:90`](../../packages/guardian/test/support/failing-stores.ts)) is the pattern
   — deterministic failure injection, no sleeps, no retries.
2. **The reverse direction.** With the event insert forced to fail, the approval row is unchanged
   and the caller receives `EVENT_LOG_UNWRITABLE`.
3. **A failed publish is not a denial.** The caller receives the infrastructure error. No
   `guardian.decided` with `decision: 'deny'` is written, and `authorize` is not re-invoked.
4. **A failed state write is never an approval.** No code path returns a settled `ApprovalRequest`
   whose write did not commit.
5. **No duplicate consent.** Answering the same approval twice produces exactly one
   `approval.granted`; the second attempt fails with `APPROVAL_ALREADY_RESOLVED`.
6. **One file.** After migration, `friday.db` contains no `approvals`, `standing_grants`,
   `capabilities`, or `guardian_decisions` table, and `events.db` contains all four.
7. **The Guardian did not notice.** `tests/constitutional/` passes **unmodified**, including
   `approval-survives-a-restart.test.ts`, which exercises every Guardian store across a reopen.
8. **The log still verifies.** `verifyChain` passes over a log containing interleaved Guardian
   events and state updates — the hash chain (ADR-0019) is computed inside the same transaction and
   must be unaffected by the additional statement.
9. **Readers are not blocked.** `friday events tail` continues to read while approvals are written,
   proving WAL still does its job with mutable tables in the file.

## Consequences

**Positive**

- The dual-write problem is **removed**, not managed. There is no crash window, no reconciliation
  pass, and no eventual-consistency language anywhere in the design.
- Disaster recovery becomes consistent by construction: one file restores to one transaction
  boundary.
- ADR-0004's synchronous-lane guarantee becomes literally true for the Guardian's state.
- The change is a constant move plus a wiring change, because there is no data. It will never be
  this cheap again.
- `packages/guardian` is untouched: same ports, same purity, same synchronous `Result` contract.

**Negative**

- **`events.db` is no longer conceptually append-only.** Four mutable tables live beside an
  immutable log. The invariant survives as a per-table rule enforced by `EventStore`'s shape and by
  `maintenance` being the sole mutation path, but a per-file invariant was easier to hold in the
  head and harder to erode. This is the cost that will be felt years from now.
- **Compaction and archival now contend with approval writes** for one write lock. Negligible at
  single-user volume; a real consideration once compaction runs over a large log. Requires
  compaction to stay incremental.
- **Chapter 09 must be amended**, including a correction of a claim (`ATTACH`) that is simply wrong
  for this configuration. Amending the Bible is deliberately expensive.
- **Archival must learn to ignore four tables.** Anything that copies or prunes `events.db`
  wholesale must not treat the Guardian's state as archivable event data. A bug here would delete
  live approvals.
- **The clerk must validate before publishing**, so there is a read-then-write sequence. It is safe
  under SQLite's single-writer model in a single process, and it would not be safe if FRIDAY ever
  spans processes — at which point the validation must move inside the transaction.

**Neutral**

- The `friday.db` / `events.db` / `cache.db` split remains; only its contents change.
- Field encryption, `principal_id` isolation, and the migration runner are unaffected.
- A future PostgreSQL migration is made slightly easier, since the two files become two schemas in
  one database with real cross-schema transactions.

## Reversibility

- **Cost to reverse:** **low today, high after first real use.**
- **How:** today, move `GUARDIAN_MIGRATION` back to `MAIN_MIGRATIONS` and reconstruct the stores on
  the main connection — the same edit, reversed, with no data to move. After the owner has real
  approvals, reversing means copying four populated tables between two SQLite files, which is itself
  non-atomic and needs a recovery procedure.
- **Point of no return:** the first `approvals` row the owner would mind losing. Practically, the
  first real FRIDAY run after this ships.

This asymmetry is the argument for deciding now rather than deferring: the option is cheap in
exactly one direction and only for a short time.

## Review triggers

- **`events.db` exceeds ~10 GB**, or archival begins rewriting it in bulk — re-examine whether
  mutable state should live in an archived file.
- **Compaction is observed blocking an approval write.** Chapter 09 predicted contention as the main
  practical SQLite constraint; this is where it would show up.
- **FRIDAY spans processes** (Chapter 10 names NATS as the path). Cross-process, the validate-then-
  publish sequence stops being safe and the validation must move inside the transaction.
- **The plan engine needs the same atomicity.** If plan state turns out not to be derivable from
  events, the `database.ts` justification fails for plans too and they should follow.
- **Migration to PostgreSQL.** Most of this ADR becomes moot; cross-schema transactions are ordinary
  there.
- **Any proposal to relax WAL.** WAL is what makes `ATTACH` non-atomic; if it ever changed, option D
  would become viable and this decision should be re-argued rather than assumed.

## Notes

**On the owner's stated preference.** The owner asked for the table move to be considered seriously
without assuming it was the decision, and asked to be told if scope or cost made it wrong. It does
not. The two findings that settle it were not available at the outset: there is **no data to
migrate**, and **no enforced foreign key crosses the boundary**. Those reduce the change to a wiring
edit. The countervailing cost — `events.db` gaining mutable tables — is real and is the one thing
about this decision worth regretting later, but it is a conceptual cost weighed against four
permanently unfixable crash windows in the alternatives.

Had there been a year of production approvals in `friday.db`, the recommendation would have been
different: option C, with its repairable divergence, is the right answer when the move is expensive.

**On `ATTACH`.** The discovery that Chapter 09's mitigation does not work under this repository's
own pragmas is the most consequential finding in this document, and it was found by reading SQLite's
WAL documentation after an empirical test *appeared to show `ATTACH` working*. The test was
measuring explicit rollback, which composes across attached files, rather than crash atomicity,
which does not. Recorded in full because the next person to reach for `ATTACH` will run the same
test and get the same reassuring result.

**Uncertainty.** The compaction-contention consequence is reasoned, not measured — compaction is
implemented but has never run against a large log with concurrent approval writes. If it proves
material, the mitigation is batching, not reverting this decision. Second, `require`-level detail on
how archival enumerates tables in `events.db` has not been audited; the acceptance criteria assert
the four tables survive, which will catch it, but the archival code deserves a read before
implementation.
