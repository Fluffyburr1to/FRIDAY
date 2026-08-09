# apps/core — friday-core

**The kernel service. This is FRIDAY.**

Milestone: **M2** (the thin dashboard's API) → **M3** (the full service)

Eventually runs as a `launchd` LaunchAgent on the host Mac: starts at login, restarts within seconds
if it dies, and keeps running whether or not any window is open.

## What is true today

**M2 is a development server, and calling it anything more would be a lie a future reader pays
for.** It serves the event log to `apps/web`, and lets the owner answer the approvals that do not
require proving they are present. The supervision, Safe Mode, and lifecycle rules below are the
charter this app is being built toward — they are not implemented yet, and the "What lives here"
list is the destination rather than the inventory.

Why it exists a milestone before the Chief of Staff shapes it:
[ADR-0029](../../docs/adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md).

## What lives here

- Process bootstrap and dependency wiring — including composing the Guardian
- The tRPC API server and WebSocket event stream
- Static serving of `apps/web`
- Sidecar process supervision (whisper, Piper, Ollama)
- Signal handling, graceful drain, sleep/wake handling, Safe Mode entry

## What does NOT

- **Any business logic.** This app is composition only. Everything of substance lives in
  `packages/` and `departments/`.

---

## The boundary

The rule that keeps "composition only" from eroding one convenience at a time:

> **`apps/core` translates. It never decides, computes, or stores.**

A procedure in this app is allowed to do four things: validate its input against a schema from
`packages/contracts`, call into a package, map the result onto the wire, and map a failure onto an
error code. Anything else belongs in a package.

| Concern | Owner | Why not here |
|---|---|---|
| Opening the database, SQL, decryption | `@friday/storage` | Enforced by `.dependency-cruiser.cjs` — the SQLite drivers are deny-listed outside `packages/storage` |
| The shape of an event, an approval, an error code | `@friday/contracts` | Defined once, or it drifts ([Chapter 20](../../docs/01-bible/20-api-standards.md)) |
| Whether an action is permitted | `@friday/guardian` | [ADR-0005](../../docs/adr/0005-guardian-sole-authorization.md) — sole authorization point. This app **composes** the Guardian and **asks** it; it never answers for it. |
| Reconstructing why something happened | `@friday/audit` | Derived from the causal chain, never narrated |
| Publishing events, subscriptions | `@friday/kernel` | The log is the bus |
| Configuration and paths | `@friday/config` | Validated once at startup |

The test: **if a procedure body contains a rule, a calculation, or a branch on domain meaning, it is
in the wrong file.** Deleting `apps/core` should lose wiring and nothing else — that is what makes
the M3 reshaping cheap, and it is what [ADR-0029](../../docs/adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)
staked its reversibility on.

### The data path

One direction, no shortcuts:

```
  apps/web  ──tRPC/HTTP──▶  apps/core  ──▶  @friday/storage  ──▶  events.db
   (renders)                (translates)      (owns the data)      (the truth)
```

`apps/core` opens storage read-write, because answering an approval writes. Two things keep that
from becoming a licence:

**The context cannot append to the event log.** It holds an `EventReader` — the event store with
every writing method removed from the type — so a procedure that tried to record an event would not
compile. ADR-0021 names the concern exactly: something that can write directly to the log is a way
to record an action FRIDAY did not take.

**The Guardian is on the mutation route, and it is the only thing on it.** This app supplies the
answer and the surface it arrived on. Chapter 19's rules — including whether a browser may answer
this request at all — are applied by `@friday/guardian`, and a refusal is its refusal.

### The router

Namespaces follow [Chapter 20](../../docs/01-bible/20-api-standards.md). Only what a shipped screen
uses exists; the rest are listed there, not stubbed here.

```
appRouter
├── approvals pending · respond    ← M2
└── events    list                 ← M2
    (stream)                       ← M2, when the live view lands
```

Every procedure declares input and output schemas. Queries read, mutations write, and one is never
disguised as the other.

## Rules

1. **Startup validates configuration and database integrity.** Failure → Safe Mode with an
   explanation, never a silent partial start. The authorization rules load **first**
   ([ADR-0033](../../docs/adr/0033-authorization-rules-are-loaded-from-a-configured-directory.md)),
   before any database is opened, so a run that cannot start leaves no trace of having tried.
   Storage opens next, then the Guardian is composed — which reads the capability signing key from
   the Keychain and fails startup if it is not there.
2. **Graceful shutdown checkpoints in-flight plans** so nothing is lost on sleep or restart.
3. **`Nice 5`** — FRIDAY yields to your foreground work.
4. **Five crashes in 60 seconds → Safe Mode**, not an infinite restart loop.
5. **Loopback only.** The server binds to `127.0.0.1`. FRIDAY's data does not leave the machine
   because there is no interface on which it could (Article IV).
6. **An unreadable log is an error, never an empty list.** Reporting "no events" when the truth is
   "cannot read the log" is the failure mode this whole app exists to prevent. An empty answer is
   reserved for a log that really is empty — which, since this app creates its databases on first
   run, is what a new machine legitimately has.
7. **`authenticatedAt` is never supplied by this app.** A loopback connection establishes that the
   request came from the owner's machine, not that the owner is present, so high-risk approvals are
   refused by the Guardian rather than waved through here.
   See [ADR-0030](../../docs/adr/0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md).

Reference: [Chapter 05](../../docs/01-bible/05-backend-architecture.md) ·
[Chapter 20](../../docs/01-bible/20-api-standards.md) ·
[Chapter 26](../../docs/01-bible/26-dashboard-architecture.md)
