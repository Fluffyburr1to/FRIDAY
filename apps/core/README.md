# apps/core — friday-core

**The kernel service. This is FRIDAY.**

Milestone: **M2** (read-only API for the thin dashboard) → **M3** (the full service)

Eventually runs as a `launchd` LaunchAgent on the host Mac: starts at login, restarts within seconds
if it dies, and keeps running whether or not any window is open.

## What is true today

**M2 is a development server, and calling it anything more would be a lie a future reader pays
for.** It serves read queries over the event log to `apps/web` and does nothing else. The
supervision, Safe Mode, and lifecycle rules below are the charter this app is being built toward —
they are not implemented yet, and the "What lives here" list is the destination rather than the
inventory.

Why it exists a milestone before the Chief of Staff shapes it:
[ADR-0029](../../docs/adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md).

## What lives here

- Process bootstrap and dependency wiring
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
| Whether an action is permitted | `@friday/guardian` | [ADR-0005](../../docs/adr/0005-guardian-sole-authorization.md) — sole authorization point |
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

`apps/core` holds a read-only handle from `openEventsReadOnly`. The dashboard is an observer of the
log at M2; it cannot cause anything to be written, and the absence of a write path is the reason the
Guardian is not yet on this route. **The milestone that adds the first mutation is the milestone
that adds Guardian authorization to every mutation** — [Chapter 20](../../docs/01-bible/20-api-standards.md)
rule 3, no exceptions, including ones that obviously do not need it.

### The router

Namespaces follow [Chapter 20](../../docs/01-bible/20-api-standards.md). Only what a shipped screen
uses exists; the rest are listed there, not stubbed here.

```
appRouter
└── events    list          ← M2
    (stream)                ← M2, when the live view lands
```

Every procedure declares input and output schemas. Queries read, mutations write, and one is never
disguised as the other.

## Rules

1. **Startup validates configuration and database integrity.** Failure → Safe Mode with an
   explanation, never a silent partial start.
2. **Graceful shutdown checkpoints in-flight plans** so nothing is lost on sleep or restart.
3. **`Nice 5`** — FRIDAY yields to your foreground work.
4. **Five crashes in 60 seconds → Safe Mode**, not an infinite restart loop.
5. **Loopback only.** The server binds to `127.0.0.1`. FRIDAY's data does not leave the machine
   because there is no interface on which it could (Article IV).
6. **A missing event log is an error, not an empty list.** Reporting "no events" when the truth is
   "cannot read the log" is the failure mode this whole app exists to prevent.

Reference: [Chapter 05](../../docs/01-bible/05-backend-architecture.md) ·
[Chapter 20](../../docs/01-bible/20-api-standards.md) ·
[Chapter 26](../../docs/01-bible/26-dashboard-architecture.md)
