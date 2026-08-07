# ADR-0018 — `better-sqlite3` as the SQLite driver

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [ADR-0003 — SQLite](0003-sqlite.md),
  [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 02 — Technology Stack](../01-bible/02-technology-stack.md)

---

## Context

[Chapter 09](../01-bible/09-database-design.md) commits to **SQLite in WAL mode, accessed exclusively
through Drizzle ORM**, with **sqlite-vec** for semantic search at Milestone 5. It does not name the
driver — the library that actually opens the file — because at the time of writing that looked like
an implementation detail.

It is not, quite. The driver determines whether a native module has to compile on every machine and
every CI runner, whether SQLite extensions can be loaded at all, and which Drizzle dialect is
available. `.dependency-cruiser.cjs` already anticipated the question by putting
`better-sqlite3`, `node:sqlite`, `drizzle-orm`, `libsql`, and `@libsql/*` on a deny-list for every
path outside `packages/storage/` — but a deny-list is not a choice.

Two facts settled it, and both were established by checking rather than assuming:

1. **Drizzle ORM 0.45 ships no `node:sqlite` dialect.** Its SQLite drivers are `better-sqlite3`,
   `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `op-sqlite`, and `sqlite-proxy`. Since Chapter 09
   requires access to be exclusively through Drizzle, Node's built-in `node:sqlite` is not currently
   reachable without writing a custom dialect.
2. **`node:sqlite` itself is otherwise viable on the pinned runtime.** Verified on Node 24.19:
   `DatabaseSync` works without a flag and `loadExtension` is present. This is worth recording,
   because it is the argument for revisiting later.

What is not known: how long Drizzle will take to add a `node:sqlite` dialect, and whether
`@types/better-sqlite3` will be brought back in line with the runtime package (see below).

## Decision

We will **use `better-sqlite3` as the SQLite driver**, confined to `packages/storage/` by the
existing dependency-cruiser rule, with `@types/better-sqlite3` for type definitions.

## Constitutional review

- **Article VI (Modularity — subsystems must be replaceable):** honored structurally. The driver is
  reachable from exactly one package, behind the repository layer. Replacing it is a change inside
  `packages/storage/` and touches no caller.
- **Article VII (Reliability through fewer moving parts):** in genuine tension, and this is the
  honest cost. A native module is one more thing that can fail to build — on a new Mac, on a CI
  runner, after a Node major upgrade. `node:sqlite` would have had zero such failure modes. Accepted
  because Chapter 09's Drizzle requirement leaves no alternative today, and because better-sqlite3
  ships prebuilt binaries for the platforms this project targets.
- **Principle 10 (Simplicity Wins):** a synchronous API is the simpler model for this workload, and
  it is the one better-sqlite3 offers.

**The five questions:**

- [x] **Can the user see it?** — One dependency in one package's `package.json`.
- [x] **Can the user stop it?** — `packages/storage/` is a CODEOWNERS path.
- [x] **Can we replace it?** — Yes, and that is the point of the repository layer. See below.
- [x] **Can we explain it?** — This record.
- [ ] **Will this still be right in five years?** — **Probably not, and deliberately so.** The moment
      Drizzle ships a `node:sqlite` dialect, the calculus changes. This is recorded as a review
      trigger rather than pretended away.

## Alternatives considered

### `node:sqlite` — Node's built-in SQLite

**What it is.** Built into Node 24 LTS, the pinned runtime. No dependency, no native compilation, no
separate types package — `@types/node` covers it. Verified working on this machine, including
`loadExtension`, which sqlite-vec needs at M5.

**Advantages.** Strictly fewer moving parts, which Article VII asks for directly. No install script
to allow, no prebuilt-binary download, no compilation on a CI runner, and no possibility of the
types drifting from the runtime. Its support lifetime is Node's, which Chapter 02 treats as a
first-class architectural concern.

**Why rejected.** Drizzle ORM has no dialect for it. Using it would mean either writing and
maintaining a custom Drizzle dialect — a real, ongoing piece of work in the most load-bearing
package in the system — or bypassing Drizzle, which Chapter 09 forbids. **This is the alternative I
would choose the day that changes**, and it is the strongest argument against this ADR.

### `libsql` / `@libsql/client`

**What it is.** A SQLite fork with a first-class Drizzle dialect, embedded replicas, and an optional
hosted sync service.

**Advantages.** Actively developed, good Drizzle support, and its embedded-replica model would be
genuinely interesting if FRIDAY ever ran on both a Mac Mini and a laptop (a live question at M5).

**Why rejected.** It is a fork, not SQLite. Chapter 09's case for SQLite rests partly on it being
"the most thoroughly tested software of its kind in existence" and on its file format being a
Library of Congress recommended preservation format — properties that belong to SQLite, not to
things shaped like it. The hosted service is also exactly the vendor gravity Principle 5 warns
about, even when unused.

### `node-sqlite3` (the async, callback-based binding)

**What it is.** The older, more widely known Node SQLite binding.

**Advantages.** Long history, large user base.

**Why rejected.** Slower for this workload, an asynchronous API over a database that is synchronous
underneath, and no Drizzle dialect. better-sqlite3 exists because of these problems.

## Consequences

**Positive**

- The Drizzle path Chapter 09 requires works today, with the dialect Drizzle supports best.
- Synchronous API suits SQLite's actual execution model and removes a class of concurrency bug.
- `loadExtension` is well supported, which is what sqlite-vec needs at Milestone 5.

**Negative**

- **A native module.** It must build or fetch a prebuilt binary on every machine and every CI
  runner. `pnpm` blocks install scripts by default, so this required an explicit entry in
  `pnpm-workspace.yaml`'s `allowBuilds` — a decision recorded there rather than a default accepted
  silently.
- **The type definitions lag the runtime package.** `better-sqlite3` is at 13.x; the latest
  `@types/better-sqlite3` is 9.6.0, published against an older major. The API surface is very stable,
  so this is usually harmless — but it means the compiler may not know about newer options, and
  "the types say this is fine" is weaker evidence here than elsewhere in this codebase. Reviewed
  against the runtime docs when touching connection setup.
- **A rebuild is needed after a Node major upgrade.** Real operational friction for a system meant
  to run untended for years, and a genuine argument for `node:sqlite`.

**Neutral**

- The deny-list rule in `.dependency-cruiser.cjs` already named `better-sqlite3`, so no boundary
  change was needed. It also still names `node:sqlite`, which stays correct — nothing outside
  `storage/` may open the database by any route.

## Reversibility

- **Cost to reverse:** medium
- **How:** swap the driver and the Drizzle dialect inside `packages/storage/`. No caller changes,
  because everything goes through repository functions. The work is the connection setup, the
  migration runner, and the extension loading — not the queries.
- **Point of no return:** none for the driver. The reversibility is exactly what the repository
  layer is for; it degrades only if code outside `storage/` ever learns the driver exists, which the
  boundary rule prevents mechanically.

## Review triggers

- **Drizzle ORM ships a `node:sqlite` dialect** → revisit immediately. It removes the native module,
  the types skew, and the post-upgrade rebuild in one move.
- `@types/better-sqlite3` falls further behind, or a type error is traced to the skew → consider
  vendoring a corrected declaration file, or reconsider the driver.
- A prebuilt binary is unavailable for a platform FRIDAY needs to run on.
- sqlite-vec extension loading proves unreliable through this driver at Milestone 5.
- Node's SQLite API changes in a way that makes writing a Drizzle dialect trivial.

## Notes

The type-definition skew is the part of this decision I am least comfortable with. It is not
dangerous — better-sqlite3's API has been stable for years — but this project's entire safety
argument rests on the compiler catching mistakes before a non-programming owner sees them, and this
is one place where the compiler is working from a slightly stale map. Worth remembering when
reviewing `packages/storage` connection code specifically.

`sqlite-vec` is not installed. Chapter 39 puts the memory system at Milestone 5, and installing a
vector extension four milestones early would be carrying a dependency with no consumer.
