# ADR-0046 — Durable execution stays hand-built at M5

- **Status:** proposed
- **Date:** 2026-08-17
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **answers a review trigger** on
  [ADR-0011](0011-plan-engine-state-machine.md)
- **Related:** [Chapter 12 — Chief of Staff](../01-bible/12-chief-of-staff.md) — which calls a
  workflow engine *"the strongest alternative in the Bible"*,
  [Chapter 05 — Backend Architecture](../01-bible/05-backend-architecture.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md),
  [ADR-0045 — The plan record is completed to Chapter 12 before the engine is built](0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md) — M5

---

## Context

[ADR-0011](0011-plan-engine-state-machine.md) decided that the Chief of Staff is a durable state
machine rather than a loop, and rejected a workflow engine — Temporal, Restate, Inngest — as the
mechanism. It did not reject it quietly. It marked the rejection as the one most likely to be wrong:

> **This is the strongest alternative in the Bible and it is explicitly flagged for reconsideration.**

[Chapter 12](../01-bible/12-chief-of-staff.md) says the same thing in its own words, and both name
the trigger: *"plan orchestration requires parallel branches with complex compensation."*

**M5 is the milestone that hand-builds the durable execution Temporal would have provided.** Writing
that code without first answering the question the Bible left open would be answering it by default
— and a decision taken by not looking at it is the kind this repository exists to prevent.

### What has changed since ADR-0011 was written

Three things, and only the third moves the argument.

**The plan record is now complete** ([ADR-0045](0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md)).
The step DAG, per-step failure actions, and plan-level approval are all in the schema. That makes
the shape of what a workflow engine would be running concrete for the first time.

**M4 shipped an installable artifact.** FRIDAY is now a thing that gets installed on a Mac by
extracting a tarball and running one command, and the launchd agent supervises a single Node
process. That is the deployment reality any dependency now has to fit inside.

**★ The estimate lesson from M4.** [Chapter 39](../01-bible/39-roadmap.md) recorded that M0–M3
compressed enormously because the Bible had settled their design, and M4 did not because packaging
was specified in a sentence. Durable execution is specified in Chapter 12 in considerable detail.
**That argues the hand-built path is cheap here, not expensive** — which is the opposite of what the
"we are rebuilding a solved problem" instinct suggests, and it is the fact that most affects this
decision.

---

## Decision

We will **keep durable execution hand-built for M5, and re-open this at M7.** The state machine is
written against the plan record ADR-0045 completed; no workflow engine is adopted.

The rejection is not renewed on the original grounds alone. Three things have to be true, and each
is checkable rather than rhetorical:

### 1. The trigger has not fired

ADR-0011's condition is *parallel branches with complex compensation*. M5 has parallel branches —
the step DAG — and **no compensation at all.** Compensation means undoing committed work when a
later step fails, and M5's two capabilities are `run-self-check`, which changes nothing, and
`compact-event-log`, which is a single guarded operation with no partner to unwind.

**Half a trigger is not a trigger**, and the half that is missing is the expensive half. Temporal's
central value is sagas and compensation. Adopting it for a DAG executor is paying for the part we do
not need.

### 2. It does not fit the machine FRIDAY runs on

Temporal requires a server and its own datastore, supervised separately from FRIDAY. The M4 artifact
is a tarball, one launchd agent, and one SQLite file. Adding a second daemon changes what
*installing FRIDAY* means, and it does so on the owner's laptop, where
[Chapter 05](../01-bible/05-backend-architecture.md) already rejected it on exactly this ground.

It also lands on the M4 evidence: the milestone that took a full week was the one about getting a
single process to start reliably at login. **A second supervised service would not be a library
choice; it would be another milestone.**

### 3. The durability requirement is genuinely small

Chapter 35 sizes it: ~50 plans a day typical, ~200 heavy, 2,000 as the ceiling. One user. One
machine. A state machine over a table.

★ **And FRIDAY already has the hard half.** The event log is append-only, hash-chained, and
transactional ([ADR-0004](0004-event-sourced-core.md),
[ADR-0019](0019-the-hash-chain-is-computed-inside-the-append-transaction.md)), and the Guardian's
state shares its transaction ([ADR-0032](0032-the-guardians-state-moves-into-the-event-log-database.md)).
Durable execution over a durable log is a state machine. Most of what a workflow engine sells is a
durable log, and buying a second one would leave FRIDAY with two — which is the condition under
which they disagree.

### 4. What this decision does *not* claim

- **Not that Temporal is the wrong tool.** It is excellent, and if FRIDAY were a multi-tenant service
  this ADR would go the other way.
- **Not that hand-building is free.** It is the negative consequence below, and ADR-0011 already
  accepted it.
- **Not that this is settled forever.** §Review triggers is narrower and more testable than
  ADR-0011's was, deliberately.

---

## Constitutional review

- **Article VI (Modularity):** the point of the seam. Chapter 12 keeps the Chief of Staff replaceable
  behind an event interface, so this decision is reversible *by construction* — a workflow engine can
  be slid in later without touching a department.
- **Article IV (Privacy):** a self-hosted Temporal would not send plan contents anywhere, so this is
  neutral. **Temporal Cloud would not be**, and that option is foreclosed rather than weighed: plan
  payloads carry the owner's life.
- **Article VII (Reliability):** the honest tension. A mature engine has had its edge cases found by
  other people's outages; ours have not been found yet.

**The five questions:**

- [x] **Can the user see it?** — plan state is rows and events, inspectable without a second system's
      UI. An engine would put some of it somewhere the dashboard cannot reach.
- [x] **Can the user stop it?** — approvals suspend the plan; unchanged either way.
- [x] **Can we replace it?** — this is the whole argument. Chapter 12's seam is what makes deferring
      cheap.
- [x] **Can we explain it?** — the causal chain stays in one log rather than being split across two
      durable stores.
- [ ] **Will this still be right in five years?** — **unknown, and that is the honest answer.** It is
      right for M5. M8 gives FRIDAY her own Engineering department and long-running self-improvement
      work, which is the plausible point at which it stops being right.

---

## Alternatives considered

### A. Adopt Temporal now, at M5

**What it is.** Run a Temporal server beside FRIDAY; plans become workflows.

**Advantages, argued properly.** Durable execution done correctly by specialists, with retries,
timers, versioning, and compensation already solved. **We would stop writing the class of bug that
is hardest to test** — resume-after-crash-mid-step — and get a workflow history for free. It is the
alternative Chapter 12 calls strongest, and the instinct behind it is right: hand-rolled durability
is where subtle bugs live.

**Why rejected.** A server and a second datastore on a laptop, a second durable log that can disagree
with the event log, and a foundational dependency at the point Chapter 12 most wants replaceable —
paid at the milestone that needs the least of what it offers. The compensation half of the trigger
has not fired.

### B. Adopt a lighter embedded engine

**What it is.** Something in-process with no server — a durable-task library over SQLite.

**Advantages.** Most of the retry-and-timer machinery without the operational weight of A, which is
the strongest single objection to Temporal.

**Why rejected, and this is the closest call.** The interesting requirements are FRIDAY-specific:
suspension across an approval that may last days, Guardian mediation between steps, and every
transition published as an event in the same transaction as the state change. An embedded engine
gives us retries and timers — the easy parts — and we would still write the rest, now split across
two models of what a step is. **Reconsider first** if §Review triggers fires.

### C. Defer the decision to M6 or later without recording it

**What it is.** Build the state machine, say nothing.

**Why rejected.** The trigger is due now, and Chapter 39 rule 8 exists because the previous milestone
was demonstrated and released while the roadmap still described it as upcoming. A review trigger that
fires and is answered by silence is worse than one that never fired: it looks answered.

---

## Consequences

**Positive**

- M5 ships without a second daemon, so installing FRIDAY stays *extract and run one command*.
- One durable store, so there is no second history to reconcile with the event log.
- The Chief of Staff stays replaceable behind Chapter 12's event seam.
- The trigger is now specific enough to fire, which the original was not.

**Negative**

- **★ We write the resume-after-crash logic ourselves, which is the hardest thing here to test.** A
  workflow engine's core value is exactly the failure mode that is difficult to provoke deliberately,
  and this ADR accepts owning it. The idempotency key on every step
  ([ADR-0045](0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md)) is the
  mitigation, not the answer.
- **Timers, retry backoff, and step versioning all get hand-rolled**, in that order of likely regret.
- **The cost of switching rises with every plan that exists**, even behind a clean seam, because
  in-flight plans would have to be migrated or drained.

**Neutral**

- Nothing about the plan schema assumes this. ADR-0045's record is what a workflow engine would drive
  too.

---

## Reversibility

- **Cost to reverse:** medium at M5, and rising.
- **How:** the Chief of Staff is replaceable behind its event interface without touching a department
  (Chapter 12). Swapping the executor means reimplementing the state machine against a new runtime and
  draining or migrating in-flight plans.
- **Point of no return:** none structural. The seam is the insurance, and keeping it intact is a
  condition of this decision rather than a happy accident — **a Chief of Staff that a department
  imports directly has removed the only thing that makes this cheap to undo.**

---

## Review triggers

Narrower than ADR-0011's, because "complex compensation" was not testable enough to fire.

- **★ The first capability that needs compensating** — a step whose committed effect must be undone
  when a later step fails. This is the trigger. Alternative A becomes strong the day it exists.
- **A plan needs to wait on a timer FRIDAY does not own** — an external callback, a webhook, a
  scheduled resume days out. Hand-rolled timers are where this gets expensive.
- **Resume-after-crash produces a duplicated external effect**, once, in production. The idempotency
  key is supposed to make that impossible; if it happens, hand-built durability has failed at the one
  thing it had to get right.
- **M8's Engineering department runs plans lasting hours** across many steps and restarts, which is a
  different duty cycle from anything M5–M7 has.
- **Step versioning becomes real** — a plan in flight when the code that defines its steps changes.
  This is the problem Temporal's versioning exists for and the one most likely to be underestimated.
- **A second durable store appears for any reason.** At that point the "one log" argument in §3 is
  already lost and this should be re-argued from scratch.

---

## Notes

**This ADR mostly renews an existing decision, which is why it is short on new argument and long on
what would change it.** ADR-0011 did the reasoning; what was missing was a checkable trigger and an
answer recorded at the milestone that was due to give one.

**Uncertainty**, ranked by how likely I am to be wrong:

1. **That the compensation trigger will not fire before M8.** M5's two capabilities genuinely need
   none. M6 introduces a calendar connector, and *"create the event, then fail to notify"* is a
   compensation case wearing ordinary clothes. **I expect this to be re-opened at M6, not M7.**
2. **That hand-rolled timers stay cheap.** I have reasoned about them and not written one. Chapter 12
   describes suspension across approvals in detail and describes timers barely at all, which by M4's
   own lesson is where the estimate goes wrong.
3. **That Alternative B is genuinely worse rather than merely less familiar.** I rejected an embedded
   engine on the grounds that the FRIDAY-specific requirements dominate. That is an argument, not a
   measurement, and I did not prototype one.
4. **That "one durable store" is as decisive as §3 claims.** It is a real property and I may be
   weighting it because it is easy to state.

**What this does not settle:** how the state machine handles retry backoff, how timers are stored,
and what happens to a plan whose step definitions changed underneath it. Those belong with the
implementation — but the third is a review trigger above, because getting it wrong quietly is how a
plan resumes into code that no longer means what it did.
