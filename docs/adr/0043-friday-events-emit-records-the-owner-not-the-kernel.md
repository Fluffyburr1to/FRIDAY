# ADR-0043 — `friday events emit` records the owner, not the kernel

- **Status:** accepted
- **Date:** 2026-08-17
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **narrows** [ADR-0021](0021-the-cli-reads-the-event-log-in-process-until-m3.md)
  by settling what the one writing command may claim
- **Related:** [Article II — Transparency](../00-foundation/constitution.md),
  [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md) — the M4 deferral this closes,
  [`packages/contracts/src/actor.ts`](../../packages/contracts/src/actor.ts) — the distinction this restores

---

## Context

[Chapter 39](../01-bible/39-roadmap.md) deferred one question out of M3 and refused to let it pass
M4:

> A CLI that can append arbitrary events to the log is a way to record something FRIDAY did not do,
> which is an Article II problem, and packaging is what puts that command on the owner's machine. It
> must be settled *in* M4 — restricted, gated, or removed from the shipped surface.

The concern is right. **The mechanism it names is not**, and settling this correctly turns on the
difference.

### What `events emit` can actually do

Nothing about it is arbitrary. [`runEmit`](../../apps/cli/src/commands/events.ts) hardcodes the event
type as `test.event.emitted` and the sensitivity as `internal`. The only caller-controlled value is a
note, capped at 1024 characters by `TestEventPayloadSchema`.

Nor could it become arbitrary by adding a flag. `createEventBus` validates every publish against the
event registry before anything is appended — [Chapter 10](../01-bible/10-event-bus.md) rule 4, *"an
unregistered or invalid event fails loudly at the source"* — so only a registered type carrying a
schema-valid payload can enter the log at all. **The guard is in the bus, not in the command**, which
is why no amount of CLI surface could widen it.

### ★ The real defect, which is narrower and worse

The actor was `SYSTEM_ACTOR` — `{ type: 'system', id: 'system:kernel' }`. So when the owner typed
`friday events emit`, the log recorded that **FRIDAY's kernel emitted it**. A human action was
written down as a machine action.

[`actor.ts`](../../packages/contracts/src/actor.ts) says why that is the one thing this field must
not do:

> The *actor* is the thing that acted — you, an agent, the scheduler… separating them now is what
> lets "an agent acting on the owner's behalf" and "the owner acting" be told apart in an audit
> trail years from now.

`ACTOR_TYPES` already contained `user`. **This was the only place in the system that misattributed an
action, and it misattributed it in the direction that matters** — a human act wearing the system's
name. That, and not injection, is how this command recorded something FRIDAY did not do.

---

## Decision

We will **keep `friday events emit` in the shipped CLI and attribute its event to the owner.**

### 1. The actor is the owner

`runEmit` publishes with `{ type: 'user', id: config.principalId }`. The event type, the payload
shape, the sensitivity, the principal, and the bus's registry validation are all unchanged.

This is the whole of the correction, and it is small because the defect was small once located.

### 2. The command is not gated behind the Guardian

[`apps/cli/src/index.ts`](../../apps/cli/src/index.ts) states the CLI's governing property: it is not
a package because *"the recovery commands must work when everything else is broken."* Routing the
cheapest end-to-end check that the bus is alive through the heaviest subsystem in the system would
make that check unavailable in exactly the circumstances it exists for.

The Guardian authorizes actions with consequences. Appending a truthfully attributed test event has
none beyond log growth, which is bounded.

### 3. The command is not removed

[`event-types.ts`](../../packages/contracts/src/event-types.ts) already settled this, in a comment
written before the question was asked: *"`test.event.emitted` is not scaffolding to be removed
later… it stays as the cheapest possible end-to-end check that the bus is alive."* Removal would also
strand the tail's own guidance — *"There is no event log yet. Run `friday events emit` to create
one."*

### 4. What this does not license

A second writing command, a `--type` flag, an `--actor` flag, or any path that lets a caller choose
what the log says happened. **The bound is that the owner may record that the owner did something,
and nothing else.** Any widening is a new decision.

---

## Constitutional review

- **Article II (Transparency):** strengthened. The log stops describing a human action as a machine
  action, which is the specific failure Chapter 39 named.
- **Article III (Approval):** unaffected. The command performs no action requiring approval; §2
  records why routing it through the Guardian would be the wrong trade.
- **Article VI (Modularity):** unchanged. The CLI still reaches the log through `@friday/storage` and
  gains no dependency on the Guardian.

**The five questions:**

- [x] **Can the user see it?** — the event appears in `events tail`, now with the right actor.
- [x] **Can the user stop it?** — the command is theirs to run or not run.
- [x] **Can we replace it?** — a single publish call inside one function.
- [x] **Can we explain it?** — the log now explains itself correctly, which is the change.
- [x] **Will this still be right in five years?** — **yes.** "An action is recorded as having been
      taken by whoever took it" does not expire. The bound in §4 is what keeps it true.

---

## Alternatives considered

### A. Gate the command behind the Guardian

**What it is.** `emit` requests authorization before appending; the decision is recorded.

**Advantages.** Every write to the log passes one authority, and it produces an authorization record
alongside the event — a stronger audit story than attribution alone.

**Why rejected.** It inverts the CLI's stated purpose. `apps/cli/src/index.ts` keeps the CLI free of
package dependencies so recovery commands work when everything else is broken; a liveness check that
requires a composed Guardian is unavailable precisely when the system is unhealthy. The cost is paid
in the one scenario the command exists for.

### B. Gate on environment

**What it is.** Refuse when `config.env` is `production`.

**Advantages.** Cheap, honest about intent, and keeps the command available in development.

**Why rejected.** An environment check is a speed bump, not an authorization boundary, and once §1
makes the record truthful there is nothing left to prevent. It remains available as a later addition
if deliberate log growth on a real machine becomes a problem.

### C. Remove it from the shipped surface

**What it is.** Delete `runEmit`; keep `test.event.emitted` registered for tests.

**Advantages.** Nothing human-triggered can enter the shipped log at all — the strongest possible
reading of the Chapter 39 requirement.

**Why rejected.** `event-types.ts` already decided the opposite in writing, and gave the reason: this
is the cheapest end-to-end proof the bus is alive, and it survives the milestone that created it.
Removal also deletes the documented way an event log first comes into existence on a fresh machine
and strands the tail's error message. It answers a hazard — arbitrary append — that this ADR
establishes was never real.

---

## Consequences

**Positive**

- The audit trail stops containing a false claim about who acted.
- The `user` / `system` distinction becomes load-bearing rather than theoretical, before there are
  agents to confuse it with.
- The cheapest liveness check survives packaging, still usable on a broken machine.
- No Guardian dependency is introduced into the recovery surface.

**Negative**

- A writable path remains in the shipped CLI. Bounded to one event type, one payload shape, 1024
  characters, and truthful attribution — but it is not zero.
- The owner can deliberately grow the event log, and there is no retention or compaction consumer yet
  that would notice.

---

## Review triggers

- **Another CLI command wants to write to the log.** §4's bound is gone; this ADR must be re-argued.
- **An actor-selection mechanism is proposed** — `--actor`, `--type`, or anything equivalent.
- **Retention or compaction lands.** Reassess whether owner-generated test events should be exempt
  from, or first in line for, compaction.
- **Agent execution arrives (M5).** The `user` / `agent` distinction starts carrying real weight;
  confirm nothing else in the system publishes under the wrong actor type.
- **Deliberate log growth becomes operationally significant.** Alternative B is the answer already
  worked out.

## Notes

Chapter 39's framing — *"arbitrary events"* — is not accurate about this command, and was written
before the implementation was re-read. The requirement attached to that framing was still correct,
which is why this ADR settles the question rather than dismissing it.

The test that holds this in place asserts the emitted actor from the CLI's own output. It lives in
`apps/cli/test/integration/` rather than `test/unit/` because asserting it requires appending to a
real log, and `tools/vitest-config` states the rule: *"Unit tests do no I/O."*
