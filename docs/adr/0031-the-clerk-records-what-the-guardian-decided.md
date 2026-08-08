# ADR-0031 — The clerk records what the Guardian decided

- **Status:** accepted
- **Date:** 2026-08-08
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 19 — Approval System](../01-bible/19-approval-system.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0021 — The CLI reads the event log in-process until M3](0021-the-cli-reads-the-event-log-in-process-until-m3.md),
  [ADR-0027 — The Guardian's stores are ports that can fail](0027-the-guardians-stores-are-ports-that-can-fail.md),
  [ADR-0029 — `apps/core` begins at Milestone 2](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md),
  [ADR-0030 — Loopback identifies the machine, not the owner](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md),
  **[ADR-0032 — The Guardian's state moves into `events.db`](0032-the-guardians-state-moves-into-the-event-log-database.md)**

---

## Context

Milestone 2 shipped the Guardian, the approval registry, and the audit package. It did not connect
them to the event log. The gap was found while building the pending-approvals slice, and was
deliberately deferred rather than patched in passing.

The gap is wider than "one event type is missing". Verified against the code at `1441f07`:

| Claim | Verified at |
|---|---|
| The bus registers **only** core event types | [`event-bus.ts:94`](../../packages/kernel/src/event-bus.ts) — `registerCoreEventTypes` alone |
| `registerGuardianEventTypes` is called **only from tests** | [`guardian-event-types.ts:234`](../../packages/contracts/src/guardian-event-types.ts); callers are three test files |
| Publishing an unregistered type is **refused**, not merely absent | [`event-bus.ts:131`](../../packages/kernel/src/event-bus.ts) → [`event-registry.ts:117`](../../packages/contracts/src/event-registry.ts) returns `EVENT_TYPE_UNREGISTERED` |
| The Guardian has no publisher and is synchronous | [`guardian.ts:71`](../../packages/guardian/src/guardian.ts) — `GuardianOptions` is policies, capabilities, grants, clock |
| The approval registry has no publisher | [`approvals.ts:126`](../../packages/guardian/src/approvals.ts) — store and clock only |
| Nothing in production raises an approval | no non-test caller of `approvals.request` exists |
| Nothing in production records a decision | `decisions.record` is called only from `tests/constitutional/` |
| The only production publishers are `system.started`, `system.degraded`, and `test.event.emitted` | [`event-bus.ts:273`](../../packages/kernel/src/event-bus.ts), [`event-bus.ts:108`](../../packages/kernel/src/event-bus.ts), [`events.ts:137`](../../apps/cli/src/commands/events.ts) |

So all twelve Guardian event types — `guardian.decided`, `capability.*`, `approval.*`, `grant.*` —
are defined, phrased by `packages/audit`, and protected from compaction by
[`retention.ts:35`](../../packages/kernel/src/retention.ts), and **not one of them has ever been
written**. FRIDAY's audit trail contains no authorization history at all.

Three existing boundaries each forbid the obvious homes for the fix:

- `packages/guardian` — *"The Guardian decides; the kernel executes"*, and *"What does NOT: anything
  that performs an action."*
- `apps/core` — its context holds a narrowed `EventReader`
  ([`context.ts:35`](../../apps/core/src/context.ts)), so a procedure that tried to append **would
  not compile**. ADR-0021 names the concern: something that can write directly to the log is a way
  to record an action FRIDAY did not take.
- `packages/kernel` — *"What does NOT: any decision about whether something is allowed."*

Nothing claims the job of *recording what the Guardian decided*. That is the gap this ADR closes.

**What we did not know when M2 was designed:** that the two halves — a Guardian that decides and an
audit package that explains — would have no seam between them, and that the seam is where the
dual-write problem lives. That second problem is large enough to be its own decision and is settled
in [ADR-0032](0032-the-guardians-state-moves-into-the-event-log-database.md). This ADR assumes only
that *some* mechanism makes the event and the state change atomic; it does not depend on which.

## Decision

We will **add `packages/clerk`: a thin composition boundary that asks the Guardian, records what it
answered, and decides nothing.**

| Rule | |
|---|---|
| **The Guardian stays pure and synchronous.** | `Guardian.authorize` and the `ApprovalRegistry` interface are unchanged. Neither gains a publisher, a bus, or an `async`. |
| **The clerk is the only production caller** of the Guardian and the approval registry. | Nothing else composes them. |
| **The clerk registers the Guardian event types** at construction, via the existing `registerGuardianEventTypes`. | Not the kernel. See below. |
| **`guardian.decided` is emitted by the clerk**, immediately after `authorize` returns a decision, before the caller may act on it. | An `err` from `authorize` is **not** a decision and produces **no** event (ADR-0027). |
| **The envelope carries causation; the payload carries identity.** | `causationId` is always a recorded **event id**. `decisionId` and `approvalId` live in the payload and are never used as `causationId`. |
| **`ApprovalRequest` gains `requestedEventId`.** | Additive. It is how a `approval.granted` recorded days later can name the event that caused it. |
| **The clerk is not a policy engine.** | It may branch on `decision.decision` to choose *which event to write*. It may never compute a risk class, override a decision, or decide whether an action proceeds. |
| **`apps/core` keeps its `EventReader`.** | It gains the clerk, not the log. |

### Why the clerk, and not the kernel

Putting this in `packages/kernel` was the leading alternative and is argued below. The deciding
objection is coupling: everything depends on the kernel, so a kernel that imports the Guardian makes
every consumer of the event bus transitively depend on the authorization engine.

There is also a safety property that falls out of the clerk owning registration, and it is the real
reason this is not a matter of taste:

> ★ **Only a process that composed a clerk can record a Guardian event.** Registration happens in
> the clerk's constructor, and `publish` refuses unregistered types. A process that opens the bus
> without a clerk — `friday events emit`, a recovery tool, a future script — cannot write
> `approval.granted` even if someone changes the type string, because the type is not registered in
> that process. It fails with `EVENT_TYPE_UNREGISTERED`.

If the kernel registered the Guardian types, every process holding a bus could forge an approval.
That is precisely the hazard ADR-0021 names, and this arrangement closes it by construction rather
than by discipline.

### Naming

`clerk`, because a clerk records what the court decided and has no opinion about it — which is the
constraint this package must not lose. `recorder` was rejected: `packages/voice` handles audio, and
"the recorder" in this repository would be ambiguous forever. `registrar` and `scribe` were
considered and are equivalent; `authorization` was rejected outright, because a package with that
name invites exactly the second-policy-engine failure this ADR exists to prevent.

### The causal contract

The trap this contract exists to close: `ApprovalRequest.decisionId`
([`approval.ts:184`](../../packages/contracts/src/approval.ts)) and a `FridayEvent.id`
([`event.ts:130`](../../packages/contracts/src/event.ts)) are **both `UuidSchema`**. Assigning a
`decisionId` to `causationId` typechecks, produces no error, and silently orphans every chain —
`buildCausalChain` would report the approval as unplaceable
([`chain.ts:74`](../../packages/audit/src/chain.ts)) and the explanation would quietly lose the
answer.

The chain the audit package already expects
([`explain.test.ts:55-68`](../../packages/audit/test/unit/explain.test.ts)):

```
guardian.decided                     causationId → whatever prompted the request
  └── approval.requested             causationId = the guardian.decided EVENT id
        └── approval.granted         causationId = the approval.requested EVENT id
              └── (execution events) causationId = the approval.granted EVENT id
```

How each id is obtained:

1. `bus.publish()` returns `Result<FridayEvent>` — the **recorded** event, carrying its `id`. The
   clerk takes the causation id from that return value, never from a domain object.
2. For `approval.requested`, the cause is in hand: the clerk published `guardian.decided` moments
   earlier in the same call.
3. For `approval.granted` / `declined` / `expired`, the cause was recorded possibly days earlier.
   The clerk recovers it from `ApprovalRequest.requestedEventId`, persisted when the request was
   raised.

`requestedEventId` is an additive field on `ApprovalRequestSchema` and an added nullable column on
the `approvals` table. It is nullable because a request may exist for one instant before its event
id is known; a request that reaches a terminal state with a null `requestedEventId` is a bug, and
the acceptance criteria below assert it never happens.

### What `apps/core` may do

`CoreContext` keeps `events: EventReader` exactly as it is, and gains the clerk. The distinction
that makes this safe:

> `apps/core` can cause **specific, typed lifecycle transitions**. It cannot write **arbitrary
> events**.

`clerk.respondToApproval(...)` is not a general-purpose append. It records the one transition that
the owner's answer actually is, and only if the Guardian's rules accept the answer. ADR-0021's
concern — a way to record an action FRIDAY did not take — is unmet by construction, because there is
no method on the clerk that writes an event not caused by a real decision or a real answer.

`apps/core` continues never to set `authenticatedAt` (ADR-0030), so `high`, `critical`, and
`self_modification` approvals remain unanswerable from the loopback web surface, and no
`approval.granted` can be recorded for them from that surface.

## Constitutional review

- **Article II (Transparency):** the point of the decision. Authorization is currently the one
  subsystem the owner cannot see, and it is the one where "trust me, it was checked" is worth least.
- **Article III (Consent):** unchanged in substance — the Guardian's rules are untouched. What
  changes is that an approval becomes *visible* as well as durable.
- **Article V:** unchanged. The clerk issues nothing and widens nothing.
- **Principle 7 (Explainability):** `causationId` chains become real rather than hypothetical. The
  audit package has been able to explain an authorization since M2 and has never had one to explain.

**The five questions:**

- [x] **Can the user see it?** This is the decision that makes authorization visible at all.
- [x] **Can the user stop it?** Unchanged — the Guardian still decides, and the clerk records after
      the fact. A recorded decision is not a new power.
- [x] **Can we replace it?** The clerk is composition over three existing interfaces, none of which
      changes. Deleting it loses wiring.
- [x] **Can we explain it?** Yes, and that is the deliverable.
- [x] **Will this still be right in five years?** Yes. The seam — decide, then record, then act — is
      the one every later subsystem needs, and establishing it once is what makes plans, agents, and
      model calls cheap to record correctly.

**Notes:** The tension worth stating: a clerk that composes the Guardian is exactly where a future
contributor will add "just one check" under time pressure. The mitigations are structural (no access
to `PolicySet`, and `guardian-internals-are-private` in `.dependency-cruiser.cjs` already forbids
reaching into the policy engine), but the charter has to be written down or it will erode.

## Alternatives considered

### The Guardian emits its own events

**What it is.** Inject an `EventBus` into `createGuardian` and `createApprovalRegistry`.

**Advantages.** No new package. The decision and its record are made in one place, so they cannot
drift apart by omission. It is the shortest diff by a wide margin.

**Why rejected.** Three reasons, in order of weight.

`publish` is asynchronous and `authorize` is synchronous. Injecting a bus makes the sole
authorization authority `async`, which changes every call site, every constitutional test, and the
100%-coverage surface of the most safety-critical package in the system.

It puts the fail-closed dilemma in the wrong place. If the publish fails, does the Guardian return
`deny`? That is a policy decision manufactured from an infrastructure failure — the exact thing
[`guardian.ts:165`](../../packages/guardian/src/guardian.ts) already refuses to do for the analogous
capability-store case, per ADR-0027. The Guardian would have to grow a second failure vocabulary to
avoid it.

It ends the Guardian's purity, which is why it is testable at all. A pure decision function with an
injected clock is exhaustively testable; one that performs I/O is not.

### The kernel records Guardian decisions

**What it is.** `packages/kernel` imports the Guardian and exposes an `authorize` that records.

**Advantages.** Genuinely strong, and the closest call here. The kernel's charter already says
*"Records everything that happens, in order, permanently"*, and the Guardian's charter says *"the
kernel executes"*. No new package. The kernel already owns the registry, so registration is natural.

**Why rejected.** Coupling and forgeability. Every package that uses the event bus would
transitively depend on the authorization engine, which is a large increase in the dependency surface
of the one package everything imports. And if the kernel registers the Guardian types, then every
process holding a bus — including `friday events emit` and any recovery tool — is a process that can
write `approval.granted`. Moving registration to the clerk closes that by construction. The kernel's
charter also explicitly disclaims knowledge of *"whether something is allowed"*; even though the
kernel would only be transcribing, the file that composes the Guardian is the file that will
eventually be asked to interpret it.

### `apps/core` records them

**What it is.** Widen `CoreContext` from `EventReader` to the full `EventStore` and publish from the
tRPC procedures.

**Advantages.** No new package, and the approval answer arrives there already.

**Why rejected.** It is forbidden by two ADRs and one README, and for a reason that has not
weakened: ADR-0021 names direct log access as a way to record an action FRIDAY did not take,
ADR-0029 staked its reversibility on `apps/core` being deletable without losing logic, and the app's
own boundary rule is *"translates, never decides, computes, or stores."* Orchestrating
decide-then-record-then-ask is logic. It would also put the causal contract — the part that is easy
to get silently wrong — in the layer with the least test coverage.

### Emit only the approval events, and leave `guardian.decided` for later

**What it is.** The narrow reading of the parked issue: make `approval.granted` appear.

**Advantages.** Smallest possible change; satisfies the literal complaint.

**Why rejected.** It produces a chain with no root. `approval.requested` would have nothing to hang
from, so every approval would be reported as orphaned by
[`chain.ts:74`](../../packages/audit/src/chain.ts) — the audit package would be correct and the
history would be useless. The decision is the thing that explains why the owner was asked at all.

## Acceptance criteria

The slice this ADR unblocks is *"one authorization decision becomes a truthful causal chain."* These
are the assertions that prove this ADR was implemented rather than approximated.

1. **The chain reconstructs from real events.** Drive a `needs_approval` decision and an owner
   approval through the real bus and real storage; read the events back with `readAfter`;
   `buildCausalChain` returns `orphaned === []`, the tree is `guardian.decided → approval.requested
   → approval.granted` at depths 0/1/2, and `unsupportedClaims(explain(chain, …), chain)` is empty.
   Events must come from the bus, never hand-constructed — the existing audit tests build events by
   hand, so nothing yet proves the producer and consumer agree.
2. **`causationId` is an event id.** A test asserts that the `causationId` of `approval.requested`
   equals the recorded `guardian.decided` event's `id`, and **does not equal** the `decisionId` in
   its own payload. This is the one bug that is silent in production.
3. **A terminal approval always names its cause.** No `ApprovalRequest` reaches `approved`,
   `declined`, or `expired` with a null `requestedEventId`.
4. **An error is not a decision.** When `authorize` returns `err` (storage unavailable), no
   `guardian.decided` event is written, and the caller receives the error — not a `deny`.
5. **The Guardian is unchanged.** `tests/constitutional/approval-is-unavoidable.test.ts` and
   `approval-survives-a-restart.test.ts` pass **unmodified**. If either needed editing, the
   Guardian's semantics were bent to make recording convenient, which is the failure this ADR is
   meant to avoid.
6. **The clerk holds no policy.** `packages/clerk` does not import `PolicySet`, does not construct a
   risk class, and returns the Guardian's decision unmodified. Asserted by a unit test and by the
   existing `guardian-internals-are-private` boundary rule.
7. **Registration is scoped to the clerk.** A bus built without a clerk refuses `approval.granted`
   with `EVENT_TYPE_UNREGISTERED`.
8. **Loopback still cannot manufacture presence.** Answering a `high`-risk approval over the web
   surface fails `STEP_UP_REQUIRED` and writes **no** `approval.granted`.
9. **`apps/core` still cannot append.** `CoreContext.events` remains `EventReader`; a procedure
   calling `append` does not compile.

## Consequences

**Positive**

- Authorization becomes visible. `guardian.decided`, `approval.requested`, and `approval.granted`
  reach the log, and `packages/audit` explains them with **no modification whatsoever** — it is
  pure, already phrases all twelve types ([`phrasing.ts:49`](../../packages/audit/src/phrasing.ts)),
  and already falls back to the registry description for anything unphrased.
- `retention.ts`'s protection of `approval.*` and `guardian.*` stops being theoretical. Kernel
  README rule 5 becomes enforceable for the first time.
- The seam generalizes. Plans, agent steps, and model invocations all need decide-then-record; doing
  it once, correctly, is what makes the rest of M3 cheap.
- Forging a Guardian event requires composing a clerk, which is a visible act in a diff.

**Negative**

- **A new package for a small amount of code.** `packages/clerk` will be perhaps 150–250 lines
  behind a `package.json`, a `tsconfig`, a vitest config, and a README. That is real overhead, and
  someone will reasonably ask why it is not three functions in the kernel.
- **A contract and schema change.** `ApprovalRequest.requestedEventId` is additive but touches
  `packages/contracts`, the `approvals` table, and the approval store's row mapping. Additive
  migrations are cheap; the change is not free.
- **One more thing to compose at startup.** Anything that wants Guardian events must build a clerk.
  A component that forgets will silently produce no authorization history — the failure is an
  absence, which is the hardest kind to notice. Mitigated by there being exactly one composition
  root.
- **Double registration throws.** `EventRegistry.register` throws on a duplicate
  ([`event-registry.ts:99`](../../packages/contracts/src/event-registry.ts)). Two clerks on one bus
  is a crash at construction. That is the correct direction — it is a genuine bug — but it
  constrains the clerk to one per process and must be documented.
- **The clerk is a magnet for policy.** Named and structural mitigations exist; none of them is a
  guarantee.

**Neutral**

- `packages/guardian`, `packages/audit`, `packages/kernel`, and the `apps/core` router surface are
  unchanged in shape. The work is additive.
- The Guardian's stores keep their `Result`-returning port design from ADR-0027 unchanged.

## Reversibility

- **Cost to reverse:** low.
- **How:** the clerk is composition. Folding it into the kernel later is a file move plus a
  dependency edit; no data changes, because the events already written remain valid and correctly
  shaped either way. `requestedEventId` would remain as a harmless additive column.
- **Point of no return:** the first `guardian.decided` event written to a log the owner keeps. From
  that moment the *causal contract* is fixed — the shape of the chain is baked into recorded history
  and cannot be restructured without rewriting the log, which is forbidden. The package that
  produces it stays movable; the chain shape does not.

## Review triggers

- **A second component needs to record Guardian events** (the plan engine is the likely first). If
  the clerk needs a second entry point, re-examine whether it is still a thin seam.
- **The clerk exceeds ~300 lines**, or gains a branch on domain meaning beyond "which event does
  this decision produce". That is policy leaking in.
- **`packages/plans` or the Chief of Staff lands** and faces the same decide-then-record question.
  The answer should be the same shape, or this ADR is wrong.
- **A process other than the composition root needs to publish a Guardian event.** That would defeat
  the registration-scoping property and needs to be argued explicitly.
- **The event volume of `guardian.decided` becomes visible** once agents authorize at machine speed.
  One decision per authorization is right for a human-paced system and may not be for an agent-paced
  one.

## Notes

**ADR-0021's review triggers that this work activates.** Recorded here because this ADR is what
activates them; neither is fixed by this ADR, and neither should be fixed in passing.

1. *"`apps/core` ships (Milestone 3) — move `status`, `events tail`, and `verify` onto the API and
   keep the read-only path as the documented fallback."* Activated. **Not addressed here.** The
   read-only recovery path is orthogonal to the write path this ADR defines, and moving the CLI's
   reads is its own decision with its own risk (a status command that needs a daemon cannot tell you
   why the daemon will not start).
2. *"`events emit` … should be re-examined at M3: once a real service is publishing events, a CLI
   that can write directly to the log is a way to record something FRIDAY did not do."* Activated,
   and **narrower than it sounds.** Verified: `runEmit`
   ([`events.ts:137`](../../apps/cli/src/commands/events.ts)) has the type `'test.event.emitted'`
   hardcoded as a literal — it cannot emit a Guardian event today, and after this ADR it could not
   even if the literal were changed, because the Guardian types are not registered in the CLI's
   process. The residual hazard is that the command opens the log for writing at all.
   **Recommendation: leave it alone for this slice** and revisit when the CLI moves onto the API,
   which is when the command loses its reason to exist.

**What is deliberately not decided here.** The write mechanism. This ADR says the clerk records; it
does not say how the event and the state change are made atomic, because that question turned out to
have a much larger answer. See
[ADR-0032](0032-the-guardians-state-moves-into-the-event-log-database.md), which must be accepted
alongside this one — this ADR is not implementable without it.

**Uncertainty.** The package name is the weakest part of this document. `clerk` encodes the
constraint well and reads oddly next to `guardian` and `kernel`; it is the kind of choice that looks
obvious in one direction for about a year. It is trivially renameable before the first release and
should be settled by the owner rather than defaulted into.
