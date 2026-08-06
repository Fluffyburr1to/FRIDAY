# 28 — Testing Strategy

> **Governing provisions:** Manifesto Engineering Culture ("testing over hope"), Principle 6
> (Architecture Is Sacred), Principle 9 (Fail Gracefully); Constitution Article VII (Reliability);
> Core Value 8 (Fail Safely).

---

## In plain language

Testing is how we know FRIDAY works — and, more importantly for a system built by AI assistants,
how we know a change did not quietly break something the person making the change never thought
about.

FRIDAY has an unusual testing problem that most software does not have, and it is worth being clear
about it.

**Half of FRIDAY is ordinary deterministic software.** Given the same input, the Guardian returns
the same decision every time. That half is tested conventionally: run it, check the answer.

**The other half involves AI, which is not deterministic.** Ask an agent to draft the same email
twice and you get two different emails. Both may be good. `assert(output === expected)` is not just
inadequate here — it is the wrong shape of instrument entirely.

So FRIDAY needs two different testing disciplines, applied to two different halves, and the boundary
between them is one of the reasons the architecture separates deterministic orchestration from AI
reasoning so carefully ([Chapter 12](12-chief-of-staff.md)). **The more logic that lives on the
deterministic side, the more of the system can be tested with certainty rather than with statistics.**

---

## The shape of the test suite

```
        ▲   Constitutional     ~40 tests    the founding guarantees
       ╱ ╲                                   ★ cannot be weakened
      ╱   ╲  End-to-end        ~30 tests    real journeys, real browser
     ╱     ╲
    ╱       ╲ Agent evals      ~15 suites   scored, not asserted
   ╱         ╲
  ╱           ╲ Integration    ~200 tests   components together, real DB
 ╱             ╲
╱               ╲ Unit         ~1500 tests  pure logic, fast, isolated
──────────────────
```

Deliberately not a standard pyramid. The constitutional tier sits above end-to-end because those
tests protect properties that matter more than any feature, and they are the ones a future
contributor is most likely to be tempted to weaken when they become inconvenient.

---

## Unit tests

**Vitest.** Fast, isolated, no I/O.

Priority is by *consequence of failure*, not by coverage percentage:

| Priority | What | Standard |
|---|---|---|
| **Critical** | Guardian, capability tokens, risk classification, budgets, encryption, redaction | **Exhaustive, including every edge case.** These are where a bug is a security incident. |
| High | Event ordering, plan state machine, memory conflict resolution, connector retry logic | Thorough, all branches |
| Normal | Departments, mappers, formatting | Reasonable |
| Low | UI presentation | Smoke only |

**Coverage target: 80% overall, 100% on Guardian and `packages/contracts`.**

The 100% requirement on the Guardian is not a vanity metric. An untested branch in the component
that decides whether actions are permitted is a branch nobody has verified — and that branch will
eventually execute. Every path through it is exercised deliberately.

**Coverage is measured but never optimized for.** A test written to raise a number is worse than no
test, because it creates false confidence and must be maintained forever. Reviews reject tests that
assert nothing meaningful.

---

## Integration tests

Components working together with a real (temporary) SQLite database, real event bus, and recorded
connector fixtures.

This is where FRIDAY's most valuable tests live, because most of what can go wrong is in the
*interaction* — the plan suspends for approval and resumes correctly; a failed step applies its
`onFailure` policy; a memory conflict is detected; a budget is exhausted mid-plan and everything
stops cleanly; the event log and the projections agree after a crash.

**Fault injection is part of this tier**, not a separate exercise. Article VII requires graceful
failure, which means failure must be *tested*, not assumed:

- Kill the process mid-plan → does it resume correctly from the event log?
- Connector times out → does the circuit breaker open and the plan degrade?
- Database is locked → does it retry and then fail cleanly?
- Disk full → does FRIDAY enter Safe Mode rather than acting unrecorded?
- Model returns malformed JSON → is it retried once and then failed cleanly?
- Duplicate event delivered → do idempotent handlers absorb it?

A resilience claim that has never been tested is a hypothesis.

---

## Agent evaluations — the unusual tier

This is the discipline most projects do not have and FRIDAY cannot do without.

### Why tests do not work here

Ask the drafting agent to write a follow-up email twice; you get two different emails. Neither
matches a fixed expected string. A conventional test would fail on a perfectly good result and pass
on a subtly bad one that happened to match.

### How evaluation works instead

Agents are **graded against scenario suites**. Each scenario provides an input and a rubric; each
run is scored; the suite produces a number; the number must not regress.

```
tools/evals/suites/draft-email/
├── scenarios/
│   ├── 001-simple-followup.yaml
│   ├── 002-ambiguous-recipient.yaml       ← should ASK, not guess
│   ├── 003-injection-attempt.yaml         ← should IGNORE embedded instructions
│   ├── 004-missing-context.yaml           ← should state uncertainty
│   └── ...
├── rubric.yaml
└── baseline.json                          ← the score to beat
```

**Scoring combines three methods**, because no single one is trustworthy:

| Method | Checks | Weight |
|---|---|---|
| **Deterministic assertions** | Output schema valid? Did it stay within budget? Did it request only permitted tools? Did it ask rather than guess where required? | 40% |
| **LLM-as-judge** | Is the tone right? Is the content accurate? Is it appropriately concise? | 40% |
| **Regression comparison** | Did this change alter behavior on previously-good cases? | 20% |

The deterministic 40% is the part I trust most, and it is deliberately weighted heavily. "Did the
agent ask instead of guessing about an ambiguous recipient" is a **checkable fact**, not a judgment
call — and it is exactly the behavior Principle 1 requires. Wherever a quality requirement can be
expressed as a deterministic assertion, it is.

**Variance is measured, not ignored.** Each scenario runs three times. High variance is itself a
finding — an agent that behaves inconsistently is unreliable even if its average score is good, and
Principle 3 says trust comes from predictability.

**Safety scenarios are pass/fail, not scored.** Prompt injection resistance, refusing to exceed
declared capabilities, and asking rather than guessing on consequential ambiguity are not graded on
a curve. They pass or the suite fails.

### In CI

Evals run when an agent, a prompt, or the Model Router changes. A score below baseline blocks the
merge. Baselines are updated deliberately, in their own commit, with a written justification —
never silently as part of another change.

Cost is capped at roughly $2 per full eval run, which is why they run conditionally rather than on
every commit.

---

## End-to-end tests

**Playwright**, real browser, real core, real database, fixture connectors.

Roughly thirty tests covering the journeys that must never break: approve an action from the
dashboard; decline one and see the plan handle it; restart the core mid-plan and watch it resume;
create a standing grant and see it applied; view an explanation and verify every claim links to an
event; enter and exit Safe Mode.

**Accessibility is tested here**, via `axe-core`. WCAG 2.2 AA violations fail the build
([Chapter 06](06-frontend-architecture.md)).

Kept deliberately few. E2E tests are slow and brittle; their value is in covering the handful of
paths where a break would be unacceptable, not in covering everything.

---

## Constitutional tests

The top tier. Listed in full in [Chapter 27](27-cicd-pipeline.md).

These assert that the founding documents' guarantees hold — that no action above `low` executes
unaudited, that `critical` actions cannot be pre-authorized, that agents have no ambient authority,
that memories cannot exist without provenance, that the audit log cannot be modified.

**Protected by CODEOWNERS. FRIDAY may never propose changes to them.** When one fails, the answer is
never to adjust the test.

---

## What is deliberately not tested

Honest scoping. Testing everything is how a test suite becomes a maintenance burden that gets
disabled.

| Not tested | Why |
|---|---|
| Third-party library internals | Their job |
| Exact model output text | Non-deterministic by nature; evals cover behavior |
| Live external APIs in the merge path | Fails for reasons unrelated to your code; runs nightly instead |
| Visual pixel-perfect appearance | High maintenance, low value at this scale |
| Performance in unit tests | Benchmarks run separately on the main branch |

---

## Alternatives considered

### Test-driven development throughout

**Advantages:** better design pressure, higher coverage, fewer defects.

**Rejected as a universal rule** because much of FRIDAY's early work is exploratory, and strict TDD
on code whose shape is still unknown is friction without benefit. **Required for the critical tier**
— Guardian, capabilities, budgets, encryption. Where a bug is a security incident, the test comes
first.

### Snapshot testing for agent output

**Advantages:** easy to write; catches unintended changes.

**Rejected** — snapshots of non-deterministic output either fail constantly or get regenerated
reflexively until they assert nothing. Evals with rubrics measure what actually matters.

### High coverage as the primary quality metric

**Rejected** — coverage measures execution, not verification. A 95%-covered codebase can have a
Guardian bug in the 5%, and chasing the number produces tests that assert nothing. Priority by
consequence is the better instrument.

### Mocking the database in integration tests

**Rejected** — SQLite is fast enough to use for real, and a mocked database does not catch
constraint violations, migration problems, transaction semantics, or the immutability trigger on the
events table, all of which are things we specifically need to verify.

### A hosted eval platform (LangSmith, Braintrust, Humanloop)

**Advantages:** genuinely good tooling; better analysis than we will build; less work.

**Rejected** — sending prompts and outputs to a third party conflicts with Article IV, and evals
contain representative user data by construction. Local evals are less polished and keep the data
where it belongs.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Evals cost real money** (~$2/run) and take minutes. | Accepted — run conditionally, with cheap models where the rubric permits. |
| **LLM-as-judge is itself non-deterministic**, so 40% of the score is fuzzy. | Accepted, and mitigated by the 40% deterministic component and by three-run variance measurement. |
| **100% Guardian coverage is demanding** to write and maintain. | Accepted without qualification — it is where bugs become security incidents. |
| **E2E tests are slow and occasionally flaky.** | Accepted; kept few, and flaky tests are fixed or deleted immediately. |
| **Fault injection tests are hard to write.** | Accepted — Article VII resilience claims are otherwise untested assertions. |
| **Not testing live APIs in CI** means provider changes are caught late. | Accepted — nightly smoke tests catch drift outside the merge path. |

---

## Review triggers

- Any constitutional test fails → **stop-the-line**
- Eval scores decline across releases → agent quality is degrading
- Eval variance exceeds ~15% on a scenario → the agent is unreliable, regardless of average
- Test suite exceeds 10 minutes locally → parallelize
- Coverage on critical paths falls below target
- A production bug had no corresponding test → add it before fixing, always

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
