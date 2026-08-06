# 35 — Performance Goals

> **Governing provisions:** Manifesto — The User Experience ("calm... make complexity disappear"),
> Principle 10 (Simplicity Wins); Constitution Article IX (Respect — for the user's time).

---

## In plain language

This chapter sets the numbers FRIDAY must hit. Not aspirations — **budgets**, enforced by automated
benchmarks that fail the build when they are exceeded.

The reason to write these down now, before any code exists, is that performance is not something you
add later. A system that became slow gradually cannot be made fast without redesign, because the
slowness is distributed across a thousand small decisions each of which seemed fine. A system with a
stated budget from the beginning stays fast, because every change that would break the budget is
caught the day it lands.

Two things shape FRIDAY's targets specifically:

**She shares your laptop.** Every megabyte of memory and every percent of CPU FRIDAY uses is taken
from what you are actually doing. A personal assistant that makes your Mac feel slow has failed the
Manifesto regardless of how good her answers are. This constrains resource usage far more tightly
than a server application would be constrained.

**Latency perception is not linear.** Below about 100ms, an interaction feels instant. Around a
second, it feels responsive. Past about three seconds, attention breaks and you switch to something
else. The targets below are set at these perceptual boundaries, not at round numbers.

---

## Interaction latency

Measured from user action to visible response, on an M-series Mac.

| Interaction | Target (p50) | Budget (p95) | Hard limit |
|---|---|---|---|
| Dashboard first paint | 300 ms | 800 ms | 2 s |
| Dashboard navigation | 50 ms | 150 ms | 400 ms |
| Event appears in live view | 100 ms | 300 ms | 1 s |
| Approve / decline | 100 ms | 300 ms | 1 s |
| Menu bar popover opens | 80 ms | 200 ms | 500 ms |
| Command bar opens (`⌥Space`) | **50 ms** | 120 ms | 300 ms |
| Memory search (10k memories) | 80 ms | 250 ms | 1 s |
| Audit query (100k events) | 200 ms | 800 ms | 3 s |
| Plan detail loads | 100 ms | 300 ms | 1 s |

**The command bar's 50 ms target is the tightest in the table and it is deliberate.** It is the
interaction you will perform most often, from inside other applications, when you have a thought you
want to capture. If it is not instant, you will stop using it — and a feature you stop using because
it is slow is worse than one that does not exist, because you paid to build it.

**Approve/decline at 100 ms matters for a different reason.** Approval is where Article III lives.
Friction there does not just annoy — it pushes you toward broad standing grants to avoid the
friction, which weakens the guarantee itself. **Making approval fast is a safety measure.**

---

## Voice latency

| Stage | Target | Hard limit |
|---|---|---|
| Wake word detection | 200 ms | 500 ms |
| End-of-speech detection | 300 ms | 600 ms |
| Transcription (10s of audio) | 500 ms | 1.5 s |
| Intent → first spoken word | 1.5 s | 3 s |
| **Perceived total** | **< 2 s** | **4 s** |

Voice is the least forgiving surface. A pause beyond about two seconds reads as broken rather than
thoughtful, and there is no visual affordance to indicate work is happening.

**Streaming synthesis is what makes this achievable.** FRIDAY begins speaking the first sentence
while later sentences are still being generated. Without it, a 4-second model response means 4
seconds of silence. See [Chapter 25](25-voice-architecture.md).

---

## Backend

| Operation | Target (p50) | Budget (p95) |
|---|---|---|
| Event publish (durable write) | 1 ms | 5 ms |
| Guardian evaluation | 2 ms | 10 ms |
| Capability token issue/verify | 0.5 ms | 2 ms |
| Simple database read | 1 ms | 5 ms |
| Vector search (10k) | 20 ms | 80 ms |
| Vector search (100k) | 80 ms | 300 ms |
| Agent spawn (worker thread) | 5 ms | 20 ms |
| Plan creation (excluding model) | 20 ms | 100 ms |
| Connector call overhead (excl. network) | 3 ms | 15 ms |

**Guardian evaluation at 2 ms is the number to protect.** It runs on every single action in the
system. If it becomes slow, everything becomes slow, and the pressure to bypass it for
"performance reasons" begins — which is exactly how safety architecture erodes. Keeping it fast
keeps it uncontroversial.

**Event publish at 1 ms is what makes "record before acting" affordable.** If durable writes cost
50 ms, someone would eventually propose making them asynchronous, and the audit guarantee would
quietly become best-effort. SQLite in WAL mode makes this a non-issue.

---

## Resource usage

The constraints that follow from sharing your laptop.

| Resource | Idle | Active | Hard limit |
|---|---|---|---|
| **Core memory** | 150 MB | 400 MB | **800 MB** |
| **Core CPU** | **< 1%** | < 25% | 50% sustained |
| **Desktop app memory** | 80 MB | 200 MB | 400 MB |
| Menu-bar-only mode | 40 MB | — | 100 MB |
| Disk (excl. data) | 300 MB | — | 1 GB |
| Battery impact | Negligible | Moderate | Never "significant energy" in Activity Monitor |

**Idle CPU under 1% is the most important resource number.** FRIDAY runs all day, every day. A
background process consuming 5% CPU continuously is measurably worse battery life and a fan that
runs — and it is exactly the kind of thing that makes people uninstall software regardless of its
value.

**"Never shows as significant energy usage" is a real, checkable requirement.** macOS surfaces that
label to users, and FRIDAY appearing there would be a visible failure of the Manifesto's promise to
quietly disappear into the background.

Local model processes (whisper, Ollama) are excluded from these numbers and are loaded on demand,
unloaded when idle.

---

## Scale targets

What FRIDAY must handle without degradation, projected over five years of daily use.

| Dimension | Year 1 | Year 5 | Design headroom |
|---|---|---|---|
| Events in log | ~500k | ~5M | 50M |
| Memories | ~10k | ~100k | 1M |
| Plans/day | ~50 | ~200 | 2,000 |
| Documents indexed | ~5k | ~50k | 500k |
| Connectors | 5 | 20 | 100 |
| Departments | 3 | 10 | 50 |

Design headroom is roughly 10× the five-year projection. That is the right margin: enough that
growth does not force a redesign, not so much that we over-engineer for a scale that will never
arrive.

**The event log is the dimension to watch.** Five million events is comfortable for SQLite with
proper indexing; fifty million is where the compaction and archival strategy from
[Chapter 10](10-event-bus.md) stops being optional. That strategy exists from Milestone 1
specifically so this does not become an emergency.

---

## Cost budgets

Performance includes money.

| Budget | Limit | Behavior at limit |
|---|---|---|
| Per agent invocation | $0.15 | Terminate the agent |
| Per plan | $0.50 | Suspend and ask you |
| Per day | $8 | Warn at 80%, refuse at 100% |
| **Per month** | **$150** | **Hard stop — fail closed** |

**Every one of these fails closed.** Exhausted means stop, never "continue and bill it." A runaway
agent loop overnight is the most plausible way to receive a surprise bill an order of magnitude
above your budget, and these ceilings are the defense
([Chapter 11](11-agent-framework.md)).

The monthly ceiling sits at the top of your stated $50–200 band deliberately — it is a **safety
limit**, not a target. Expected steady-state spend is $20–70.

---

## How these are enforced

| Mechanism | Where |
|---|---|
| Benchmark suite on every main-branch build | CI ([Chapter 27](27-cicd-pipeline.md)) |
| Bundle size limits | `size-limit`, fails the build |
| Runtime metrics against budgets | [Chapter 29](29-monitoring-observability.md) |
| Regression detection | Diagnostics files an improvement proposal |
| Memory leak detection | Nightly soak test — 8 hours, memory growth must be flat |

**A budget without enforcement is a wish.** Benchmarks run on the main branch (not on every PR,
where noise would make them flaky) and a regression beyond 20% fails the build with the specific
number and the previous baseline.

**The nightly soak test catches the failure mode that matters most for an always-running process:**
a slow memory leak that is invisible in a five-minute test and makes FRIDAY unusable after four
days. Eight hours of continuous simulated activity, with memory growth required to be flat.

---

## What we deliberately do not optimize

Honest scoping. Optimizing everything is how a codebase becomes unreadable
(Principle 10, "clarity over cleverness").

| Not optimized | Why |
|---|---|
| Cold start (target: < 10 s) | Happens once per login |
| Migration speed | Rare, and correctness matters more |
| Export speed | Rare, offline, unattended |
| Audit queries beyond 100k events | Rare, and interactive-enough is sufficient |
| Model inference speed | Not ours to optimize; mitigated by streaming and caching |
| Backup speed | Continuous and in the background |

---

## Alternatives considered

### No stated performance targets; optimize when it feels slow

**Advantages:** no upfront analysis; no premature optimization; simpler.

**Rejected** because performance regressions are gradual and each one feels acceptable in isolation.
Without a budget there is no moment where a change is rejected for being slower, and after two years
the system is slow with no single change to blame. This is the single most common way software
becomes unpleasant.

### Much tighter targets (sub-10 ms everywhere)

**Rejected** as optimizing beyond perception. Effort spent making a 50 ms interaction 10 ms is
effort not spent on correctness, and the user cannot tell. The targets are set at perceptual
boundaries deliberately.

### Looser resource limits (2 GB memory)

**Rejected** — FRIDAY shares your laptop. The Manifesto's promise to "quietly disappear into the
background" is violated by an assistant that visibly consumes the machine. The constraint is a
feature.

### Optimizing for a server rather than a laptop

**Rejected** — it is the wrong deployment target ([Chapter 33](33-deployment-strategy.md)), and
optimizing for abundant resources produces code that behaves badly on constrained ones. If FRIDAY
moves to always-on hardware at M5, these targets stay: they are about respect for the machine, not
about necessity.

### Enforcing benchmarks on every pull request

**Rejected** — benchmark noise on shared CI runners produces flaky failures, and flaky gates get
disabled. Main-branch enforcement catches regressions within one merge, which is fast enough.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Benchmarks add ~3 minutes** to main-branch builds. | Accepted — cheap insurance against gradual decay. |
| **Tight memory limits constrain caching**, so some work is repeated. | Accepted — being a good citizen on your laptop matters more. |
| **The 20% regression threshold will occasionally block a legitimate change.** | Accepted — the response is to justify the regression and update the baseline deliberately, in its own commit. |
| **Some targets may prove wrong** before any code exists. | Accepted — they are revised with evidence, in a versioned change, not quietly relaxed. |
| **The nightly soak test costs 8 hours of machine time.** | Accepted — runs overnight, and memory leaks in an always-on process are otherwise found by you, in week two. |
| **Cost ceilings will occasionally halt legitimate work.** | Accepted without qualification — a failed plan you can retry beats an unbounded bill. |

---

## Review triggers

- Any budget exceeded on the main branch → investigate before the next merge
- User-perceived slowness that the numbers do not reflect → the wrong things are being measured
- Scale exceeds year-5 projections early → revisit storage strategy
- Monthly cost approaches $150 twice consecutively → architectural review of model usage
- Hardware changes materially (new Mac, always-on host) → recalibrate
- Memory growth in the soak test is non-flat → **stop-the-line**; leaks compound

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
