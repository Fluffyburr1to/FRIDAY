# 39 — Milestone-Based Development Roadmap

> **Governing provisions:** Manifesto Principle 6 (Architecture Is Sacred), Principle 10 (Simplicity
> Wins), Long-Term Thinking; Constitution Article X (Evolution); Core Value 12 (Think Long-Term).

---

## In plain language

This is the order things get built, and honest estimates for when.

Two things shape it, and both come from you.

**You chose Core before features.** That is the right call and the harder one. It means months of
work before FRIDAY does anything impressive. The alternative — build three features, then discover
the foundation cannot hold them — is how most ambitious personal projects die: not from lack of
effort, but from building on something that has to be torn out.

**You have 10–20 hours a week.** I have estimated in that range and I have **not** padded the
numbers to look good. Software estimates are wrong in one direction, so the honest thing to say up
front is: **expect 30–50% slippage.** If M4 lands in April instead of March, nothing has gone wrong.

The dates below assume a start of **August 2026**.

---

## The arc

```
2026            2027                                    2028
 Aug  Sep  Oct  Nov  Dec  Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov
  │    │    │    │    │    │    │    │    │    │    │    │    │    │    │    │
 M0   M1─────────┤    │   M2────┤   M3─────────┤   M4─────────┤   M5─────┤  M6──►
 ▲              ▲         ▲              ▲              ▲           ▲
 │              │         │              │              │           │
Ground      Heartbeat  Conscience      Mind           Face      Memory &
                                                    ★ FIRST     Endurance
                                                   USEFUL DAY
```

| # | Name | What exists at the end | Estimate | Target |
|---|---|---|---|---|
| **M0** | **Ground** | Tooling, repo, CI, first ADRs | 2–3 wks | Aug 2026 |
| **M1** | **Heartbeat** | Event bus, database, config, logging | 4–6 wks | Oct 2026 |
| **M2** | **Conscience** | Guardian, approvals, audit, thin dashboard | 4–5 wks | Nov 2026 |
| **M3** | **Mind** | Agents, Model Router, Chief of Staff, plans | 6–8 wks | Jan 2027 |
| **M4** | **Face** | Dashboard, Mac app, first connector — **first useful day** | 6–8 wks | Mar 2027 |
| **M5** | **Memory & Endurance** | Four-layer memory, always-on host, DR | 6–8 wks | May 2027 |
| **M6** | **Self-Improvement** | Engineering dept; FRIDAY's first PR | 6–10 wks | Aug 2027 |
| **M7** | **Reach** | iPhone, notifications, voice | 8–12 wks | Nov 2027 |
| **M8** | **Breadth** | Additional departments | Ongoing | 2028+ |

---

## M0 — Ground · 2–3 weeks

**Goal:** a repository that builds, tests, and enforces its own rules — before any FRIDAY code
exists.

| Deliverable | Notes |
|---|---|
| Node 24 LTS, pnpm, git configured on your Mac | ✅ Node 24.19.0 installed 2026-08-06 |
| Repository pushed to GitHub, private | |
| pnpm workspaces + Turborepo | |
| TypeScript strict config, Biome, dependency-cruiser | [Chapter 30](30-coding-standards.md) |
| CI pipeline: lint, typecheck, test, secret scan | [Chapter 27](27-cicd-pipeline.md) |
| **Branch protection on `main`** | Before FRIDAY can ever propose anything |
| CODEOWNERS, PR template, ADR template | |
| Seed ADRs 0001–0015 | [Chapter 37](37-adr-process.md) |
| `CLAUDE.md` | |
| Folder READMEs | |

**Done when:** an empty pull request passes all CI stages, and pushing directly to `main` is
refused.

**Why this comes first:** every rule in the Bible that is enforced by tooling must be enforced from
the first commit. Adding boundary enforcement at M4 means retrofitting it onto code that already
violates it.

---

## M1 — Heartbeat · 4–6 weeks

**Goal:** FRIDAY can record. She cannot act.

| Package | Deliverable |
|---|---|
| `contracts` | Core Zod schemas: events, plans, actors, sensitivity |
| `storage` | SQLite, Drizzle, migrations, repository layer, field encryption |
| `kernel` | Event bus, durable log, **hash chain**, sync/async lanes, subscriptions |
| `telemetry` | Pino logging with redaction, correlation IDs |
| `config` | Validated configuration loading |
| `cli` | `friday status`, `friday events tail` |

**Done when:** you run `friday events tail`, trigger a test event from another terminal, and watch it
appear — then verify the hash chain with `friday verify`.

**Demonstrable outcome:** a live stream of events in your terminal. Not impressive, but real, and
you can see it working. (Risk R1.)

**Deliberately not in M1: compaction and archival.** [Chapter 10](10-event-bus.md) says growth
management is "designed for from Milestone 1", and its design is. The implementation is Milestone 2
work: tiering, compaction, and Parquet archival all read and rewrite the event log, so they depend
on the ledger, the integrity chain, and the storage layer being finished and exercised first. The
table above never listed them; this line records that as a decision rather than an oversight.
See [ADR-0024](../adr/0024-compaction-and-archival-are-milestone-2.md).

---

## M2 — Conscience · 4–5 weeks

**Goal:** FRIDAY can be told no.

| Package | Deliverable |
|---|---|
| `guardian` | Policy engine, risk classification, ALLOW/DENY/NEEDS_APPROVAL |
| `guardian` | Capability token issue and verification |
| `guardian` | Approval requests, standing grants with **mandatory expiry** |
| `audit` | Causal chain reconstruction, explanation generation |
| **`tests/constitutional`** | **The founding-guarantee test suite** |
| `apps/web` | **Thin dashboard** — live event stream, pending approvals |
| `kernel` | **Compaction and archival** — deferred from M1 ([ADR-0024](../adr/0024-compaction-and-archival-are-milestone-2.md)) |

**Done when:** a simulated action requests permission, blocks, appears in the dashboard with a full
explanation, waits across a core restart, and executes only after you approve.

**The dashboard is pulled forward here deliberately.** Strict dependency order would put it at M4.
It is here because six months without anything to look at is the largest risk to this project (R1),
and because seeing the event stream and approval flow working is genuinely useful for debugging
everything that follows.

---

## M3 — Mind · 6–8 weeks

**Goal:** FRIDAY can think, plan, and delegate.

| Package | Deliverable |
|---|---|
| `model-router` | Provider abstraction, sensitivity routing, **fail-closed budgets** |
| `model-router` | Anthropic + OpenAI + local Ollama providers |
| `agent-runtime` | Worker-thread isolation, manifests, mediated tools, budgets |
| `chief-of-staff` | Intent parsing, plan generation, DAG execution, suspension/resume |
| `departments/operations` | **The first department** — health, backups, maintenance |
| `diagnostics` | Health checks, self-checks, improvement proposals |
| `tools/evals` | Agent evaluation harness with the first scenario suites |

**Done when:** you type a request into the CLI, FRIDAY produces a visible plan, executes it through
agents, requests approval where required, and explains what she did with every claim traceable to an
event.

**This is the milestone where FRIDAY becomes recognizably herself.** It is also the largest and most
likely to slip.

---

## M4 — Face · 6–8 weeks · ★ the milestone that matters

**Goal:** FRIDAY is useful. A day where you would miss her.

| Deliverable | Notes |
|---|---|
| `apps/web` full dashboard | All four layers ([Chapter 26](26-dashboard-architecture.md)) |
| `apps/desktop` | Tauri, menu bar, global hotkey, signed and notarized |
| `packages/ui-kit` | Shared component library |
| `connector-sdk` + contract test suite | |
| **First real connector** | Recommendation: **Google Calendar** — read-only first |
| `departments/knowledge` (minimal) | Enough to answer questions about your calendar |
| `notifications` | Desktop notifications, urgency, quiet hours |
| Apple Developer Program enrolled | ~$99/yr; needed for signing |

**Done when:** you ask FRIDAY "what does my week look like?" from the menu bar, get a useful answer
in under two seconds, and can click through to see exactly how she produced it.

**Why Google Calendar as the first connector:** read-only to start (low risk), the data is
structurally simple, the API is well-documented, and the value is immediate and daily. It exercises
OAuth, the credential broker, rate limiting, and the egress allowlist without risking anything
irreversible.

**Roughly seven to eight months in.** This is the point where the foundation-first decision pays
off or does not.

---

## M5 — Memory & Endurance · 6–8 weeks

**Goal:** FRIDAY remembers, and she survives.

| Deliverable | Notes |
|---|---|
| `memory` — four layers | [Chapter 16](16-memory-system.md) |
| sqlite-vec + local embeddings | Private content never leaves the machine |
| Conflict detection and resolution | Asks rather than silently overwriting |
| Memory browser in the dashboard | Article I made visible |
| Litestream → Backblaze B2 | Encrypted before egress |
| **Nightly restore verification** | Including audit-chain verification |
| Recovery card generated | Printed and stored |
| Safe Mode | |
| **Always-on host decision** | See below |

### The always-on host decision

By this point you will have used FRIDAY daily for two to three months and will know whether your
Mac's sleeping is genuinely limiting (risk R6). The decision is made with evidence rather than
speculation.

| Option | Cost | Recommendation |
|---|---|---|
| Stay on your Mac | $0 | If sleep has not been a problem |
| **Mac Mini (used, M1/M2)** | **$400–600 once** | **Recommended if it has** — always on, data stays local, no recurring cost |
| Rented VPS | $10–40/mo | Only if remote access matters more than local data |

The architecture supports all three without a rewrite ([Chapter 33](33-deployment-strategy.md)).

---

## M6 — Self-Improvement · 6–10 weeks

**Goal:** FRIDAY proposes her first pull request. **This is the milestone you asked for.**

| Deliverable | Notes |
|---|---|
| `departments/engineering` | Repository read, test execution, change proposal |
| GitHub connector | Scoped to this repository only |
| Code review agent | An adversarial critic reviews before a PR is opened |
| Plain-language change summaries | Written for you, not for a programmer |
| CI enforcement of AI-authored PR rules | 400-line cap, forbidden paths, required sections |
| Improvement proposal → PR pipeline | Diagnostics finding becomes a proposed change |
| **★ Restore required approvals to 1** | **Prerequisite.** Held at 0 since M0 because GitHub forbids self-approval and there was only one human — see [Chapter 32](32-branch-strategy.md). The day FRIDAY becomes a contributor, the gate starts protecting something real and must be turned back on **before** her first pull request. |

**Done when:** FRIDAY identifies a real improvement from her own diagnostics, opens a pull request
with tests passing and a summary you can evaluate without reading code, and you merge it.

**Deliberate safety constraints for this milestone:**

- FRIDAY's first PRs are **documentation and test-only** for the first four weeks. Code changes
  come after the pipeline has been observed working.
- The forbidden paths are enforced by CI before the department is enabled, not after.
- The 400-line cap and the required uncertainty statement are in place from the first PR.

---

## M7 — Reach · 8–12 weeks

**Goal:** FRIDAY is with you when you are away from your desk.

**Begins with a two-week timeboxed spike** validating Tauri mobile against the four questions in
[Chapter 08](08-mobile-strategy.md). **Failure on any one means switching to Capacitor immediately.**

| Deliverable | Notes |
|---|---|
| `apps/mobile` | Tauri (or Capacitor), iOS first |
| **Content-free push notifications** via APNs | Article IV |
| Face ID for high-risk approvals | |
| Tailscale for private connectivity | |
| `voice` — push-to-talk | whisper.cpp + Piper, fully local |
| Wake word (opt-in, off by default) | openWakeWord |
| TestFlight distribution | Avoids App Store review |

**Done when:** an approval request reaches your phone within five seconds, you can read the full
explanation, and Face ID confirms a high-risk approval — and you can ask FRIDAY a question by voice
on your Mac and get a spoken answer in under two seconds.

---

## M8 — Breadth · ongoing, 2028+

Departments added **one at a time**, each fully complete before the next begins (risk R5).

| Order | Department | Notes |
|---|---|---|
| 1 | **Productivity** | Tasks, scheduling, briefings |
| 2 | **Communications** | Email — the first irreversible external actions |
| 3 | **Home** | Physical world; Article III becomes literal |
| 4 | **Finance** | **Read-only, permanently.** [Chapter 13](13-department-architecture.md) |
| 5 | **Health** | Highest sensitivity; strictest defaults |
| 6+ | Research, Entertainment, others | As wanted |

Also in this phase, driven by need rather than schedule: the plugin system
([Chapter 15](15-plugin-system.md)), the external API ([Chapter 20](20-api-standards.md)), Windows
and Android, and a documentation site.

---

## Cost by milestone

| Milestone | Monthly | Notes |
|---|---|---|
| M0–M2 | **$0** | No AI calls yet |
| M3 | $10–30 | Development and eval usage begins |
| M4 | $20–50 | + Apple Developer ($8/mo amortized) |
| M5 | $25–60 | + backups ($1–3) |
| M6 | $35–80 | FRIDAY's own model usage |
| M7–M8 | $40–90 | Steady state |

Comfortably inside your $50–200 band throughout, with the hard ceiling at $150 as a safety limit
rather than a target ([Chapter 35](35-performance-goals.md)).

Plus one-time: Apple Developer $99/yr, and optionally a Mac Mini at M5 ($400–600).

---

## What is deliberately not on this roadmap

| Not planned | Why |
|---|---|
| Multi-user support | Data model supports it; the feature waits until someone needs it |
| Windows / Android | Build when there is a reason, not speculatively |
| Third-party plugins | M8+, and only with a stable API |
| Financial transactions | **Never, by design.** Requires a deliberate ADR and security review to reconsider. |
| A public API | Until there is a consumer |
| Cloud-hosted FRIDAY | Conflicts with Article IV |
| Training custom models | Not the problem FRIDAY solves |

---

## How the roadmap changes

It will. Rules for changing it:

1. **Milestones may be re-scoped; they may not be skipped.** M2's Guardian cannot be deferred past
   M3, because M3 builds agents that must be constrained by it. Order encodes dependency.
2. **Slippage is expected and not a failure.** 30–50% is normal. Record actual durations to
   calibrate future estimates.
3. **New work is added to M8** unless it blocks an earlier milestone.
4. **A milestone ending in nothing demonstrable is re-scoped**, not extended. (Risk R1.)
5. **Reviewed at every milestone boundary**, with actual versus estimated recorded.

---

## The honest summary

You are roughly **seven to eight months from FRIDAY being useful**, and roughly **twelve months from
her building herself**.

That is a long time, and the foundation-first decision is what makes it long. It is also what makes
the result something that can grow for a decade rather than something that has to be rebuilt at
month fourteen.

The single greatest risk is not technical. It is the months between M0 and M4 where the work is real
and the output is invisible. Every design decision in this roadmap that looks slightly inefficient —
the dashboard at M2, the demonstrable outcome required at every milestone, the 4–8 week milestone
sizing — exists to manage that. They are worth protecting when they seem like overhead.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
