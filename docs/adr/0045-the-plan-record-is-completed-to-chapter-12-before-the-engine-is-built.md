# ADR-0045 — The plan record is completed to Chapter 12 before the engine is built

- **Status:** proposed
- **Date:** 2026-08-17
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **completes** the plan shapes laid down at M1
- **Related:** [Chapter 12 — Chief of Staff](../01-bible/12-chief-of-staff.md) — the design this
  record is measured against,
  [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 11 — Agent Framework](../01-bible/11-agent-framework.md),
  [ADR-0011 — The Chief of Staff is a durable state machine, not a loop](0011-plan-engine-state-machine.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0031 — The clerk records what the Guardian decided](0031-the-clerk-records-what-the-guardian-decided.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md) — M5

---

## Context

`packages/contracts/src/plan.ts` and the `plans` / `plan_steps` tables were written at **Milestone
1**, deliberately ahead of the engine that would use them. The file says so in its own header:

> The plan *engine* arrives at M3. The shapes are here at M1 because storage needs the tables, and
> because a data model is the thing you cannot cheaply change later.

That was the right instinct and it is the reason this ADR is cheap rather than expensive. But the
shapes that landed are **a subset of what [Chapter 12](../01-bible/12-chief-of-staff.md) specifies**,
and the difference was never recorded as a gap. M5 is the milestone that builds the engine, so it is
the milestone that discovers it.

### What Chapter 12 asks for, and what exists

| Chapter 12 | In `plan.ts` today | Kind of difference |
|---|---|---|
| `intent` — *"the structured interpretation of what you asked"* | `intent: string` — the raw utterance | **Type change** |
| `rationale` — *"why this decomposition, in plain language"*, **required**, shown in the dashboard | absent | **New required field** |
| `status` includes `awaiting_plan_approval` | six statuses, plan-level approval absent | **New state** |
| `steps[].dependsOn[]` — *"a DAG, not just a list"* | `sequence` only | **New field, and it re-reads `sequence`** |
| `steps[].description` — *"plain language, shown to you"* | absent | **New required field** |
| `steps[].department` | `agentId` only | **New field** |
| `steps[].onFailure` — `retry \| skip \| abort \| ask_user \| alternate`, declared at planning time | absent | **New required field** |
| `explanation` — *"composed on completion"* | absent | **New nullable field** |
| `budget` includes a **deadline** | tokens and cents only | **New nullable field** |

Six of those nine are additive. Three are not, and they are the reason this is an ADR rather than a
pull request.

### ★ The fact that decides the cost: nothing has ever written a plan

**`createPlan` and `addStep` are called from exactly one place in this repository —
`packages/storage/test/integration/plan-store.test.ts`.** No CLI command, no `apps/core` procedure,
no department, and no migration seeds a row. The `plans` and `plan_steps` tables exist, are indexed,
and are **empty on every machine that has ever run FRIDAY, including the owner's `v0.1.0` install**.

So "non-additive" here is a question about *shape*, not about *data*. There are no rows to backfill,
no historical plans whose `intent` would have to be re-parsed, and no explanation ever composed that
would become untrue. **This is the last moment at which that is true**, and it is the whole argument
for doing it now rather than when the engine is half-written.

### Why not just widen it as the engine is built

Because the three non-additive changes each alter the meaning of a field that already exists, and a
field whose meaning changed silently is exactly the failure
[Chapter 38](../01-bible/38-documentation-standards.md) is about. `sequence` is the clearest case: it
is `UNIQUE (plan_id, sequence)` and indexed as the step ordering today. The moment `dependsOn[]`
exists, execution order comes from the graph and `sequence` becomes a *display* order. Nothing in the
schema would say so, and the next person to read `ORDER BY sequence` would reasonably conclude it is
the execution order it used to be.

---

## Decision

We will **complete the plan record to Chapter 12's specification in one change, before any Chief of
Staff code is written**, as a single migration replacing the M1 tables rather than a sequence of
`ALTER TABLE`s.

### 1. `intent` becomes structured, and the raw utterance is kept beside it

```
utterance   TEXT NOT NULL     ★ what the owner said, verbatim, never a paraphrase
intent      TEXT NOT NULL     the structured interpretation, JSON, Zod-validated
```

**Both, not one.** Chapter 12 asks for a structured Intent; the M1 comment insists the raw words
survive because *"the explanation of what FRIDAY did has to be traceable to what was actually said,
not to how a model restated it."* Those are not in conflict and collapsing them would lose one of
them. The structured form is what routing reads; the utterance is what an explanation quotes.

`intent` is a validated object, not free JSON — an `Intent` schema in `packages/contracts` with at
minimum a kind, the resolved entities, and the ambiguities the parser declined to guess at
(Chapter 12's ambiguity ladder, rung 4). **The parser's uncertainty is data, not prose.**

### 2. `rationale` is required, and `explanation` is nullable

`rationale` is written at planning time and is `NOT NULL`. Chapter 12 makes it required and shown in
the dashboard, and a plan that cannot say why it decomposed the way it did is not reviewable —
which makes plan approval ceremonial, which is the failure Article III exists against.

`explanation` is `NULL` until the plan reaches a terminal state, then composed **deterministically
from recorded events** (Chapter 12, responsibility 5). It is a cache of a derivation, never a
source: if it disagrees with the events, the events are right.

### 3. `awaiting_plan_approval` is a distinct status from `awaiting_approval`

```
draft | awaiting_plan_approval | running | awaiting_approval
      | completed | failed | cancelled
```

These must not be merged. `awaiting_plan_approval` means *no step has run and you are approving the
shape of the work*. `awaiting_approval` means *steps have run and one of them needs you*. Chapter 12
draws the distinction precisely because a sequence of individually-low-risk steps can be collectively
consequential, and the dashboard has to be able to tell the owner which of the two he is looking at.

A plan enters `awaiting_plan_approval` when it contains any `high`+ step, exceeds a cost threshold,
or touches a resource class marked sensitive. **Those conditions are evaluated by the Guardian, not
by the planner** — §6.

### 4. `dependsOn[]` is the execution order; `sequence` becomes presentation only

`depends_on` is a JSON array of step ids within the same plan. The engine executes the topological
order; independent steps may run concurrently.

**`sequence` is retained and demoted**, with its comment and its index rewritten to say so. It keeps
`UNIQUE (plan_id, sequence)` because a stable display order is worth having and gaplessness is a
cheap invariant. It is no longer what the executor reads.

Two invariants are enforced at plan validation, not discovered at runtime:

- **The graph is acyclic.** A cycle is a rejected plan, not a hung executor.
- **Every `dependsOn` id exists in the same plan.** Cross-plan dependencies are not expressible;
  sub-plans are the mechanism for that, per ADR-0011's depth bound.

### 5. `description`, `department`, and `onFailure` are required per step

- **`description`** — `NOT NULL`, plain language, written for someone who does not read code. It is
  what the owner reads when approving. A step that cannot describe itself cannot be approved
  meaningfully.
- **`department`** — `NOT NULL`. Routing is deterministic capability lookup (Chapter 12,
  responsibility 3), so the department is known at planning time. `agent_id` stays nullable: which
  agent picks the step up is a runtime fact.
- **`onFailure`** — `NOT NULL`, one of `retry | skip | abort | ask_user | alternate`. Chapter 12
  requires it to be *declared at planning time* rather than improvised, which is Article VII made
  concrete. There is no default: a planner that did not decide has produced an invalid plan.

### 6. Risk is still assigned by the Guardian, and this ADR does not touch that

`risk_class` stays on the step and stays `NOT NULL`. **The planner proposes `action_type` and
payload; the Guardian classifies.** Nothing here gives the planner a way to write a risk class, and
the plan-approval trigger in §3 reads classifications the Guardian produced. This is the small
load-bearing rule ADR-0011 and Chapter 12 both single out, and it is restated here because a data
model is exactly where it would erode — a writable `risk_class` column looks harmless in a diff.

### 7. One migration that replaces the tables, not a chain of `ALTER TABLE`s

Because the tables are empty (see Context), the migration **drops and recreates** `plans` and
`plan_steps` at their final shape. SQLite's `ALTER TABLE` cannot add a `NOT NULL` column without a
default, and inventing defaults for `rationale`, `description`, and `onFailure` would put exactly the
meaningless placeholder values into the schema that §2 and §5 exist to forbid.

**The migration asserts both tables are empty and fails loudly if they are not.** If some future
machine has rows, this ADR's central premise is false there and the change must stop rather than
discard the owner's plans. That assertion is the whole safety argument and it is not optional.

`budget_deadline_ms` is added in the same migration, nullable.

### 8. What this does not change

- **The event log.** Plans are projections and working state; the log is the record
  ([ADR-0004](0004-event-sourced-core.md)). Nothing here touches `events.db`, the hash chain, or
  retention.
- **`principal_id` filtering.** Every query keeps it in the `WHERE` clause.
- **`idempotency_key`.** Unchanged, and still the defence against replaying an external action.
- **The Guardian, the clerk, and approvals.** `approval_id` on a step keeps its meaning; plan-level
  approval creates an approval through the same clerk, against the plan rather than a step.

---

## Constitutional review

- **Article II (Transparency):** the decisive one. `rationale`, `description`, and `explanation` are
  the fields that make a plan legible to someone who does not read code. Without them a plan is
  inspectable only in the sense that a JSON blob is inspectable.
- **Article III (Approval):** §3 is what makes plan-level approval expressible at all. Today there is
  no state in which the owner approves the shape of work before it starts.
- **Article VII (Reliability):** §5's `onFailure` is failure behaviour decided in advance rather than
  improvised, which is what the Article asks for.
- **Principle 1 (The User Is Always In Command):** §1 keeps the owner's actual words, so an
  explanation can quote him rather than a model's restatement of him.

**The five questions:**

- [x] **Can the user see it?** — the added fields are almost entirely *for* seeing: why this plan,
      what this step does, what happened.
- [x] **Can the user stop it?** — §3 adds a stop *before* the first step, which does not exist today.
- [x] **Can we replace it?** — the Chief of Staff remains replaceable behind the event interface
      (Chapter 12); this is its state, not its logic.
- [x] **Can we explain it?** — `explanation` is derived from events and never trusted over them.
- [ ] **Will this still be right in five years?** — **the fields will; the `Intent` schema will
      not.** §1 is the part most exposed to how model capability changes, and it is deliberately the
      least specified thing here.

---

## Alternatives considered

### A. Widen incrementally as the Chief of Staff is built

**What it is.** Add each field in the pull request that first needs it.

**Advantages.** Each change is small, individually reviewable, and justified by working code rather
than by a specification. It is the repository's normal rhythm and it avoids designing against
Chapter 12 in the abstract.

**Why rejected.** The three non-additive changes are not independent — `dependsOn[]` re-reads
`sequence`, plan approval re-reads `status`, and structured intent re-reads `intent`. Arriving at
them one at a time means the schema passes through states where a column's meaning has changed and
nothing says so, and it means the migration-with-an-emptiness-assertion in §7 stops being available
after the first plan is written. **The window is now, and it closes quietly.**

### B. Adopt Chapter 12's shape wholesale, including sub-plans

**What it is.** Also model parent/child plans and the depth-3 bound from ADR-0011 in this change.

**Advantages.** ADR-0011 caps plans at 20 steps and depth 3 and says larger work decomposes into
sub-plans, so the model is arguably incomplete without it.

**Why rejected for now.** Nothing at M5 generates a sub-plan, and a `parent_plan_id` with no producer
is a column that will be designed wrong precisely because nothing exercises it. The 20-step bound is
enforceable at validation without it. **Recorded as owed** — see review triggers.

### C. Store the plan as a single JSON document

**What it is.** One `plans` row holding the whole structure, steps included.

**Advantages.** No migration problem ever again; the shape becomes a Zod schema and nothing else.
Genuinely simpler, and the DAG is naturally nested.

**Why rejected.** Steps are queried across plans — *"what is awaiting approval right now"* is the
dashboard's main question, and `idempotency_key` needs a unique index across every step ever created.
Both become table scans over JSON. Chapter 09 puts relational structure where it is queried, and this
is queried.

### D. Leave the M1 shape and make the Chief of Staff work within it

**What it is.** No plan approval, no DAG, sequential steps, no rationale.

**Advantages.** No migration, no ADR, and M5 starts a week earlier.

**Why rejected.** It is not the Chief of Staff Chapter 12 specifies; it is the sequential executor
the chapter explicitly argues against. The DAG is not an optimisation — Chapter 12's own example
("prepare me for Thursday's meeting") is three independent reads that would run three times slower.
And a plan with no rationale cannot be approved meaningfully, which removes the point of plan
approval.

---

## Consequences

**Positive**

- The plan record matches the design it was written for, before any code depends on the mismatch.
- Plan-level approval becomes expressible, which is the Article III mechanism Chapter 12 describes
  and the repository currently has no state for.
- The migration is free exactly once, and this is that time.
- `sequence`'s demotion is written down rather than inferred by the next reader.

**Negative**

- **A destructive migration, on tables the owner's installed `v0.1.0` machine already has.** The
  emptiness assertion makes it safe, and it is still a `DROP TABLE` in a shipped product, which is
  the sort of thing that is fine until the one time it is not.
- **It is designing against a specification rather than against working code**, which is the
  failure mode ADR-0036 demonstrated when its build command turned out not to work. The `Intent`
  schema in §1 is the part most likely to be wrong, and it is the part with the least evidence.
- **`onFailure` with no default makes every planner output more verbose**, and the first thing a
  frustrated implementer will want is a default. That want is the review trigger below.
- Contracts, schema, migration, store, and their tests all change in one pull request, which is a
  wider diff than this repository likes.

**Neutral**

- No runtime behaviour changes on merge. Nothing reads these tables yet.
- `CHANGELOG.md` gains nothing: there is no user-visible change until the engine exists.

---

## Reversibility

- **Cost to reverse:** low today, high after the first real plan is written.
- **How:** today, the inverse migration restores the M1 shape and loses nothing, because there is
  nothing to lose. After a plan exists, reversing means discarding `rationale`, `description`, and
  the graph — which is discarding the plan's reviewability, not its storage layout.
- **Point of no return:** **the first plan created by anything other than a test.** That is also the
  moment §7's emptiness assertion stops being satisfiable, and the two are the same event on purpose.

---

## Review triggers

- **Sub-plans are needed** — Alternative B, owed. Expected when a plan first hits the 20-step bound.
- **A default for `onFailure` is proposed.** Re-read §5 first: the absence of a default is the
  mechanism, not an oversight.
- **`risk_class` is proposed as planner-writable**, in any form, including "just a hint the Guardian
  can override." That is §6 eroding, and §6 is the reason a manipulated planner cannot mark a money
  transfer low-risk.
- **The `Intent` schema is changed more than twice in one milestone** → §1 was specified too early
  and should be loosened to a validated envelope rather than a fixed shape.
- **`explanation` is ever read in preference to the events it was composed from** → §2 has inverted
  and the cache has become a source.
- **A plan needs to depend on a step in another plan** → the sub-plan mechanism is being worked
  around; see Alternative B rather than widening `dependsOn`.

---

## Notes

**This ADR exists because M5's investigation found the gap, not because anything failed.** The M1
decision to lay the tables down early was correct and is what makes this a schema edit on empty
tables rather than a data migration. The only thing that went wrong is that the difference between
the M1 shapes and Chapter 12 was never written down, so it had to be rediscovered by reading both.

**Uncertainty**, ranked by how likely I am to be wrong:

1. **The `Intent` schema (§1).** I have specified that it exists and roughly what it holds, and not
   what it is. It is the field most coupled to how well a model parses an utterance, and I have not
   run a single parse. If one thing here is redesigned during M5, it is this.
2. **That `onFailure` should be required with no default.** Chapter 12 says declared at planning
   time, which I have read as strictly required. A planner that emits `retry` for everything
   satisfies the letter and defeats the purpose, so the requirement may be buying less than it costs.
3. **That `department` is knowable at planning time in every case.** Deterministic routing says yes.
   Deterministic routing does not exist yet, and ADR-0040 lists its adequacy as an open question.
4. **The destructive migration (§7).** I am confident the tables are empty — the only writer is a
   test file — but "I grepped for the writers" is a weaker claim than "I checked the owner's
   database", and I have not done the second.

**Not settled here:** how intent parsing is prompted, how the planner is bounded, how capability
routing resolves a department, and what an `Intent` actually contains. Those belong with the
implementation and none of them may contradict §6.
