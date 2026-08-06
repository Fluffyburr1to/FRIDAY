# 36 — Risk Register

> **Governing provisions:** Constitution Article VII (Reliability), Article V (Security); Manifesto
> Principle 6 (Architecture Is Sacred), Principle 9 (Fail Gracefully); Core Value 12 (Think
> Long-Term).

---

## In plain language

This chapter lists what could go wrong with Project FRIDAY — not bugs, but the things that could
make the project fail, stall, or cause harm.

Most risk registers are theatre: a table produced once to satisfy a process, never read again. This
one is written to be *useful*, which means three things:

1. **The biggest risks are honest ones.** The single most likely cause of death for this project is
   not technical. It is that you stop working on it. That risk is R1, and it is treated as the most
   serious entry rather than politely omitted.
2. **Every risk has a trigger** — a specific, observable condition that means it is happening now,
   not "keep an eye on it."
3. **It is reviewed.** Quarterly, and after any incident.

Scoring is likelihood (1–5) × impact (1–5). Anything at 15 or above is treated as active — it gets
work now, not monitoring.

---

## Active risks (score ≥ 15)

### R1 — Motivation collapse during the foundation phase

| | |
|---|---|
| **Likelihood** | 4 — high |
| **Impact** | 5 — project ends |
| **Score** | **20** |
| **Category** | Project |

**The risk.** You chose Core-before-features, which is correct engineering and brutal psychology. It
means roughly six to eight months before FRIDAY does anything you would miss. At 10–20 hours a week,
in evenings, alone, with no user but yourself and no external accountability, the most likely
outcome is not a technical failure — it is that around month four, the work stops feeling like
progress and the gap between sessions grows from days to weeks to permanent.

**Trigger.** More than three consecutive weeks with no commits.

**Mitigation.**
- **Every milestone ends in something demonstrable**, even if it is only a terminal command that
  proves a layer works. M1 ends with FRIDAY recording events you can watch stream by. M2 ends with
  her refusing to do something and explaining why.
- **A thin dashboard is pulled forward into M2** rather than waiting for M4, specifically so there is
  something to look at. This is a deliberate deviation from strict dependency order, made for
  motivational reasons, and it is worth the small inefficiency.
- **Milestones are sized to 4–8 weeks.** Longer than that and completion stops feeling reachable.
- **A visible changelog from day one**, written in plain language, so accumulated progress is legible.

**Owner.** You. Nobody else can mitigate this one.

---

### R2 — AI-generated code accumulating incoherence

| | |
|---|---|
| **Likelihood** | 4 |
| **Impact** | 4 |
| **Score** | **16** |
| **Category** | Technical |

**The risk.** AI assistants write plausible code that drifts from established patterns in ways that
are individually harmless and collectively fatal. Session one uses `Result` types; session forty
throws exceptions; session ninety introduces a third pattern. Each is defensible in isolation. After
two years the codebase has no coherent idiom, and you — unable to read code — have no way to notice
until change becomes unreliable.

**Trigger.** Reviews increasingly encounter patterns not described in [Chapter
30](30-coding-standards.md); or the same bug class recurs in different forms.

**Mitigation.**
- Machine-enforced boundaries (`dependency-cruiser`) — architecture violations fail the build
- Maximum-strictness TypeScript — many drift classes become compile errors
- `CLAUDE.md` read at the start of every AI session, with "match the surrounding code" as the
  primary instruction
- 400-line cap on AI-authored PRs, so drift arrives in reviewable pieces
- Templates for departments and connectors, so new components start correct
- Quarterly coherence review: read a random sample of recent code and look for pattern divergence

---

### R3 — Prompt injection causing a harmful action

| | |
|---|---|
| **Likelihood** | 4 — this will be attempted |
| **Impact** | 4 |
| **Score** | **16** |
| **Category** | Security |

**The risk.** FRIDAY reads content written by other people — emails, documents, web pages, calendar
invites. Any of it can contain instructions aimed at her. There is no complete defense.

**Trigger.** Any Guardian denial or blocked egress traceable to instruction-shaped content in
processed data.

**Mitigation.** The architecture assumes injection will sometimes succeed and is built so success is
not harmful: agents have no ambient authority, capability tokens are scoped to a single step, the
Guardian evaluates every action regardless of the agent's reasoning, consequential actions require
you, and egress allowlists block undeclared destinations. A fully captured agent can produce a bad
draft; it cannot send your money. See [Chapter 18](18-security-model.md).

**Residual risk.** An injection that causes a *plausible-looking* request you then approve. This is
not fully mitigable by architecture — it is why approval screens show the actual artifact from a dry
run rather than a description ([Chapter 19](19-approval-system.md)).

---

### R4 — Approval fatigue defeating Article III

| | |
|---|---|
| **Likelihood** | 4 |
| **Impact** | 4 |
| **Score** | **16** |
| **Category** | Product / Constitutional |

**The risk.** FRIDAY asks too often, you develop a reflex, and you begin approving without reading.
The audit trail then shows perfect compliance while providing no actual oversight. **This is worse
than no approval system**, because it produces the appearance of control.

**Trigger.** Approvals exceed ~10/day sustained, **or** median time-to-decision falls below 3
seconds.

**Mitigation.** Both metrics are instrumented and tracked as health indicators
([Chapter 19](19-approval-system.md)). Batching, plan-level approval, standing grants with mandatory
expiry, and quiet hours all reduce volume. Diagnostics files an improvement proposal when thresholds
are crossed.

**Residual risk.** Architecture cannot force attention. Measuring the symptom is the best available
instrument.

---

### R5 — Scope collapse under the Long-Term Vision

| | |
|---|---|
| **Likelihood** | 4 |
| **Impact** | 3 |
| **Score** | **12** → treated as active |
| **Category** | Project |

**The risk.** The Vision lists ten domains. Attempting several in parallel produces several
half-built things, none trustworthy, all requiring maintenance.

**Trigger.** More than one department under active development simultaneously before M8.

**Mitigation.** The Department model makes each domain a separately-shippable unit that either exists
and works or does not exist at all ([Chapter 13](13-department-architecture.md)). The roadmap
sequences them explicitly. Finance is read-only by design, permanently, which removes the highest-risk
domain from the critical path entirely.

---

## Monitored risks (score 8–14)

| # | Risk | L | I | Score | Trigger | Primary mitigation |
|---|---|---|---|---|---|---|
| **R6** | **Host Mac sleeps; scheduled work unreliable** | 5 | 2 | 10 | Missed scheduled work becomes disruptive | Catch-up scheduling from M1; always-on host evaluated at M5 ([Chapter 33](33-deployment-strategy.md)) |
| **R7** | **Supply chain compromise** (malicious npm dependency) | 2 | 5 | 10 | Audit flags a known-compromised package | Minimal dependencies, lockfiles, provenance, egress allowlist, delayed major adoption |
| **R8** | **Runaway model cost** | 3 | 4 | 12 | Daily spend exceeds 80% of budget | Nested fail-closed budgets at every level ([Chapter 35](35-performance-goals.md)) |
| **R9** | **Tauri mobile proves inadequate** | 3 | 3 | 9 | M7 spike fails any of its four questions | Timeboxed go/no-go spike; Capacitor ready ([Chapter 08](08-mobile-strategy.md)) |
| **R10** | **Update signing key compromised** | 1 | 5 | 5 → treated as high | Any unexpected release appears | Offline key on removable media; manual signing; pinned public key; signature verification refuses on mismatch |
| **R11** | **Memory system produces confident falsehoods** | 3 | 4 | 12 | You notice FRIDAY "remembering wrong" more than rarely | Mandatory provenance; confidence tracking; conflict detection asks rather than resolves ([Chapter 16](16-memory-system.md)) |
| **R12** | **A model provider changes pricing or terms materially** | 3 | 3 | 9 | Any provider announces a change | Model Router; multiple providers; local fallback (Principle 5) |
| **R13** | **Data loss from an untested backup** | 2 | 5 | 10 | Any nightly restore verification failure | Nightly automated restore + audit-chain verification; annual drill ([Chapter 34](34-disaster-recovery.md)) |
| **R14** | **The Bible drifts from reality** | 4 | 2 | 8 | A chapter contradicts observed behavior | ADRs for changes; quarterly review; chapters cite the code they govern |
| **R15** | **Over-engineering delays usefulness** | 3 | 3 | 9 | A milestone exceeds its estimate by >50% | Explicit milestone sizing; "what is the simplest thing" as a review question |
| **R16** | **SQLite becomes limiting** | 2 | 3 | 6 | Any trigger in [Chapter 09](09-database-design.md) | Repository layer; Drizzle speaks Postgres; migration path documented |
| **R17** | **A key dependency is abandoned** (Tauri, Litestream, sqlite-vec) | 2 | 3 | 6 | Maintainer activity stops for 6+ months | Alternatives documented per chapter; abstractions at every boundary |
| **R18** | **Voice always-listening erodes trust** | 2 | 4 | 8 | You disable it, or feel uneasy about it | Opt-in, off by default; local-only; OS mic indicator; push-to-talk default |

---

## Accepted risks

Risks we have decided not to mitigate further, with the reasoning recorded so the decision is not
silently revisited.

| Risk | Why accepted |
|---|---|
| **Nation-state adversary with physical access** | Not defensible for a personal system; effort better spent elsewhere |
| **Compromised macOS kernel or hardware implant** | Outside the trust boundary; nothing FRIDAY does helps |
| **You approve something harmful after full disclosure** | Article I — the user is the highest authority. Undermining that to protect you from yourself would violate the founding premise. |
| **AI model output is occasionally wrong** | Inherent. Mitigated by validation, approvals, and explanations — not eliminable. |
| **Local models are less capable than cloud models** | Deliberate trade for Article IV |
| **GitHub is a vendor dependency in CI** | Mitigated by everything running locally; accepted as a development-time, not runtime, dependency |

---

## Review

**Quarterly**, and immediately after any incident.

Each review asks four questions per risk:

1. Has the likelihood or impact changed?
2. Did any trigger fire without being noticed?
3. Is the mitigation actually implemented, or still aspirational?
4. Are there new risks the last quarter revealed?

Question 3 is the one that matters. A register full of mitigations nobody built is worse than no
register, because it creates false confidence. Each mitigation names the chapter or milestone where
it becomes real, and the review verifies it exists.

**New risks are added as they are identified**, including by FRIDAY's diagnostics
([Chapter 23](23-diagnostics-system.md)). A risk discovered during an incident is added the same
week, with the incident referenced.

---

## The three risks I would watch most closely

If attention is limited, these are the ones:

**R1 (motivation).** It is the highest-scored risk in the register and the one architecture cannot
help with. The mitigations — demonstrable milestones, an early dashboard, short milestones — are
deliberate design decisions made for a human reason rather than a technical one, and they are worth
protecting when they seem inefficient.

**R4 (approval fatigue).** It is the risk that would quietly hollow out the Constitution while
appearing to satisfy it. It is also the one most likely to be dismissed, because each individual
approval request will seem justified.

**R2 (AI incoherence).** It is slow, invisible, and compounding, and by the time it is obvious it is
expensive to reverse. The mitigations must be built early — enforced boundaries and strict typing
are much cheaper to establish at Milestone 0 than to impose at Milestone 6.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
