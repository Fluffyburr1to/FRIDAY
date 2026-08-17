# ADR-0044 — `apps/core` records that FRIDAY started, before she checks herself

- **Status:** accepted
- **Date:** 2026-08-17
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **narrows** [ADR-0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)
  by naming startup as the one place `apps/core` writes
- **Related:** [ADR-0035 — First-run provisioning is creation-only](0035-first-run-provisioning-is-creation-only.md)
  — §4 settled the shape of this record and carried it as a review trigger,
  [ADR-0021 — The CLI reads the event log in process](0021-the-cli-reads-the-event-log-in-process-until-m3.md)
  — the concern that keeps the bus private,
  [ADR-0031 — The clerk records what the Guardian decided](0031-the-clerk-records-what-the-guardian-decided.md),
  [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md) — the M4 deliverable this closes

---

## Context

`system.started` has existed since M1 — a registered core event type at
`maxSensitivity: 'internal'`, with a publisher, `announceStart()` in
[`packages/kernel/src/event-bus.ts`](../../packages/kernel/src/event-bus.ts), and kernel tests
covering both the success and the unwritable path. **Nothing called it outside tests.**

So FRIDAY's log never said she started. On a fresh machine the first event was `guardian.decided` —
her asking the Guardian's permission to verify a log that was empty. M4's done-when asks for
`friday verify` to pass *"against a log she started herself"*, and the record that says so was
missing.

[ADR-0035 §4](0035-first-run-provisioning-is-creation-only.md) had already reasoned this out and
declined to build it:

> The right shape for the record is `apps/core` publishing `system.started` on its first successful
> start… **Giving `system.started` its first production publisher is its own work** — it is a change
> to `apps/core`'s startup, not to init — and it is carried as a review trigger below.

This is that work.

### What constrains where the call can go

`apps/core` translates and does not store ([ADR-0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)).
Its `CoreContext` narrows the event store to five reading methods, at runtime as well as in types,
so a procedure that tried to record an event would not compile and could not be reached by an `as`
either. The bus is built inside `openContext` and stays there, for the reason
[ADR-0021](0021-the-cli-reads-the-event-log-in-process-until-m3.md) names: something that can write
directly to the log is a way to record an action FRIDAY did not take.

There is already one exception, and it is the pattern this follows. `authorizing` sits on
`OpenedContext` rather than `CoreContext` so that *"startup — which is not a request from anybody —
can put FRIDAY's own housekeeping through the Guardian, and no procedure can reach it."*

---

## Decision

### 1. `apps/core` publishes `system.started` on startup

`main()` calls it through the opened context. This is `system.started`'s first production publisher.

### 2. It happens before the startup self-check

The order is `openContext` → **announce** → `sweepExpired` → `runStartupSelfCheck` → `startServer`.

**It is a write-liveness gate, not a formality.** `announceStart` already returns
`EVENT_LOG_UNWRITABLE` carrying the sentence *"FRIDAY could not record that she started, so she has
not started"*, and [Chapter 10](../01-bible/10-event-bus.md) says *"She will not act if she cannot
record."* A gate that ran after the work it guards would not be a gate.

It also puts the log in the order the events happened: she started, then she asked to verify herself.
The alternative reads as though she verified before she started.

### 3. The existing minimal payload is kept

`{ version, nodeVersion, pid }`. `SystemStartedPayloadSchema` is unchanged and `payloadVersion`
is not bumped. §6 records what this defers.

`version` is read from the package's own manifest, because
[`tools/scripts/release.ts`](../../tools/scripts/release.ts) reads the artifact's `package.json` to
report what shipped — one answer rather than two. An unreadable manifest reports `unknown` and never
a guess, and is not fatal: FRIDAY not knowing her own version is worth recording honestly and is not
a reason to refuse to start.

### 4. Startup fails if the event cannot be recorded

`main()` writes the error and exits with the problem code, exactly as it does for every other startup
fault. It is not logged and continued, not downgraded to a warning, and the server is not started.

### 5. The capability is exposed through the startup-only boundary, and the bus is not

`OpenedContext` gains `announceStarted()` — **one closure over one call**, beside `authorizing` and
for the same reason. The raw `EventBus` remains private to `openContext` and appears on neither
`CoreContext` nor `OpenedContext`. Three tests hold the boundary: the context still has no `append`,
the announcement is absent from `CoreContext`, and no `bus` is reachable from either object.

### 6. What this does not decide

- **It does not add initialization or provisioning state to `system.started`.** ADR-0035 §4's
  suggestion that the record name *"what it found provisioned"* is **not implemented here** and
  remains that ADR's open review trigger. §7 restates it so it is carried rather than assumed closed.
- **It does not change the actor.** `system.started` stays `SYSTEM_ACTOR`. That is the correct half
  of the distinction [ADR-0043](0043-friday-events-emit-records-the-owner-not-the-kernel.md) settled
  the other half of: the owner running `friday events emit` is a `user` acting; FRIDAY's own
  machinery starting is not.
- **It does not expose the bus to `CoreContext`**, or create a second production publisher.
- **It does not change D2**, `friday events emit`, or `test.event.emitted`.

---

## Constitutional review

- **Article II (Transparency):** the point of the change. The log now records the one event every
  other event depends on, in the order it happened.
- **Article VI (Modularity):** preserved by §5. The exception is one function on the object startup
  already uses, not a widening of what procedures can reach.

**The five questions:**

- [x] **Can the user see it?** — `friday events tail` and `friday verify` both read it.
- [x] **Can the user stop it?** — not starting FRIDAY is how; the event exists because she did.
- [x] **Can we replace it?** — one closure calling one exported kernel function.
- [x] **Can we explain it?** — §2 is the explanation, and the log's order now carries it.
- [x] **Will this still be right in five years?** — **yes.** "Record that you started before you do
      anything else" is the same rule at any size.

---

## Consequences

**Positive**

- `system.started` has a production publisher, closing an M4 deliverable.
- A fresh machine's log now opens with `system.started`, so M4's *"a log she started herself"* is
  literally true.
- The write-liveness gate runs first, so an unwritable log stops FRIDAY at the earliest honest point.
- The boundary ADR-0029 draws is now tested in three places rather than two.

**Negative**

- **`system.started` is not protected from retention.** `isProtectedType('system.started')` is
  `false`. Retention is not wired into `apps/core` today, so nothing prunes it yet — but nothing
  guarantees the first record survives once something does.
- **A restart loop writes one per attempt.** launchd's `KeepAlive` is unconditional with
  `ThrottleInterval 10` ([Chapter 33](../01-bible/33-deployment-strategy.md)), so a fault *after* the
  announcement relaunches roughly every ten seconds and appends a `system.started` each time. With no
  retention consumer, that grows without bound. Placing the announcement earlier widens this window
  in exchange for the ordering §2 argues for; that trade was made deliberately and is recorded here
  rather than left to be discovered.

**Neither is solved here.** Both are named so the milestone that wires retention has them written
down.

---

## Review triggers

- **★ ADR-0035 §4's initialization record.** Whether the provisioning state init found — the policy
  directory, both keys — should ride on `system.started` is **still open**. This ADR published the
  event and deliberately did not answer that question.
- **Retention or compaction is wired into `apps/core`.** Decide then whether `system.started` should
  be a protected type, and what a restart loop's worth of them should cost.
- **A restart loop is observed in the wild.** If the launchd risk above stops being theoretical, the
  announcement's placement is worth re-reading against what it actually produced.
- **A second caller wants the bus.** One closure on `OpenedContext` is what makes §5 acceptable. A
  second holder is a design change, not a convenience.
- **`apps/core` gains a real version.** Today the manifest reads `0.0.0` and no tag claims otherwise
  ([ADR-0036](0036-packaging-delivers-friday-init-provisions.md) §6). When a release tag exists,
  confirm the number in the log and the number in the release report are still the same one.

## Notes

The failure path is tested against a closed database rather than a mock, so the assertion exercises
the same `EVENT_LOG_UNWRITABLE` that a full disk produces. The kernel's own tests already cover
`announceStart` in isolation; these cover it as `apps/core` actually calls it.
