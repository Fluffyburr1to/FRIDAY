# 01 — Executive Summary

> **Read this chapter if you read nothing else.** It contains the entire architecture in
> compressed form and the reasoning behind the five decisions that matter most.

---

## In plain language

You have asked for something unusual, and it is worth being precise about what it is, because the
architecture follows directly from it.

You are not building an app. Apps do one thing and own their own data. You are building a
**coordinator** — something that sits above your calendar, your email, your code, your home, your
money, and gets them to work together on your behalf. That is a fundamentally different kind of
software, and it has three consequences that shape everything else:

**First, FRIDAY holds power she did not create.** She will have permission to read your email, move
money, change your thermostat, and edit her own source code. An app that misbehaves annoys you. A
coordinator that misbehaves can do real damage. So the architecture is built around a hard rule:
*FRIDAY cannot take a consequential action without a recorded, explainable authorization.* Not
"shouldn't." *Cannot* — the code path does not exist.

**Second, FRIDAY must outlive her parts.** Your Constitution says every subsystem must be
replaceable. In five years the best AI model will not be today's. The calendar you use may not
exist. So nothing in FRIDAY's core is allowed to know the name of a vendor. The core knows about
*a model*, *a calendar*, *a store*. Which one is a configuration detail, swappable in an afternoon.

**Third, FRIDAY must be legible to you.** You do not write code, and you are directing AI
assistants who forget everything between sessions. That means documentation is not a nice-to-have
here — it is the primary load-bearing artifact. This Bible, the decision records, and the code
comments are how the project survives you being away for three weeks and an AI assistant starting
cold.

Everything below is downstream of those three facts.

---

## The five decisions that matter most

If you only understand five things about this architecture, understand these. Each has its own
chapter; this is the summary.

### 1. FRIDAY is an event-sourced system, not a request/response system

**What that means.** Most software works like a conversation: you ask, it answers, and unless
somebody wrote a log line, nothing remains. FRIDAY works like a ship's log. Every meaningful thing
that happens — a request arrives, a plan is made, an agent is dispatched, an external service is
called, an approval is granted, a result comes back — is written as an immutable, append-only
**event** before anything acts on it. The current state of the system is a *consequence* of the
event log, not a separate thing that hopefully matches it.

**Why this is the keystone decision.** Your Constitution demands three things that are expensive to
retrofit and nearly free if you build this way from day one:

- *Article II (Transparency)* — "every system action should be observable." The event log **is**
  the observability. There is no separate audit system to keep in sync, and no way to act without
  leaving a trace, because the write to the log happens before the act.
- *Article VII (Reliability)* — "failures should be isolated, FRIDAY should continue operating."
  Event-driven components fail independently. A dead connector fills a queue; it does not stop the
  kernel.
- *Principle 7 (Explainability)* — "why?" is answerable by replaying the causal chain of events
  that led to a decision, because every event carries the ID of the event that caused it.

**What it costs.** Event-sourced systems are harder to reason about than simple ones, and the log
grows forever unless you manage it. We accept both. Chapter 10 covers the compaction strategy.

### 2. Everything is TypeScript

One language across the server, the web dashboard, the Mac app, and the phone app. There is a
single narrow exception (below) and it is fenced off.

**Why.** You are one person directing AI assistants, 10–20 hours a week, for years. Every
additional language multiplies the tooling you maintain, the conventions you hold in your head, the
build systems that can break, and the ways an AI assistant can generate plausible-looking nonsense.
One language means one set of types shared literally end to end — the schema that validates an API
request is the same object that types the React component that renders it. When you change a data
shape in one place, the compiler tells you every single place that must change, across all four
applications. For a solo builder that is not a convenience; it is the difference between a project
that survives and one that collapses under its own inconsistency.

**The exception.** Speech recognition and local AI model inference are dominated by C++ and Python
implementations. FRIDAY will use those as *sealed external processes* that speak a documented
protocol — never as libraries linked into her code. The boundary is a process boundary, so the
exception cannot leak.

**What it costs.** TypeScript is not the best language for numerical machine-learning work, and
Node.js is not the fastest runtime available. Neither matters here: FRIDAY's core is coordination
work — waiting on networks, routing messages, enforcing policy — which is exactly what Node.js is
good at. Chapter 02 has the full argument and the alternatives.

### 3. The Guardian sits between every action and its execution

**What it is.** A single, small, ruthlessly-tested component that every action must pass through.
It answers one question: *is this specific actor allowed to take this specific action on this
specific resource right now?* It returns `ALLOW`, `DENY`, or `NEEDS_APPROVAL`.

**Why it is a component and not a convention.** "We will remember to check permissions" is how
every security incident in history begins. Article III says consequential actions require explicit
approval. The only way to guarantee that across years, dozens of agents, and AI-written code is to
make it structurally impossible to bypass: agents do not have the ability to call the outside
world. They can only *request* an action from the kernel, and the kernel routes every request
through the Guardian. An agent that wants to skip the Guardian cannot, because it has no network
access, no filesystem access, and no credentials of its own.

**The consequence for you.** Approval is not a dialog box bolted on later. When FRIDAY wants to
send an email, the send *blocks* — the plan durably pauses, an approval request appears in your
dashboard and on your phone with a full explanation, and the plan resumes exactly where it stopped
when you answer. Days later, if you like. This is Article III implemented as physics rather than
etiquette.

### 4. The core runs on your Mac; only reasoning goes to the cloud

**What that means.** FRIDAY's kernel, her database, her memory, her event log, and all of your
data live on a machine you own. When she needs to think hard, she sends the *minimum necessary
context* to a cloud AI model and gets back a reply. Your calendar never leaves your Mac; a sentence
describing a scheduling conflict might.

**Why.** Article IV: "minimize data collection, prefer local processing whenever practical." This
is the honest reading of that. Fully-local would mean running AI models on your own hardware, which
today means noticeably worse reasoning for a personal assistant that needs to be trusted with
judgment. Cloud-first would mean your entire life sits on someone else's server. The hybrid keeps
the data local and rents only the thinking.

**The enforcement mechanism.** Every outbound request passes through a **redaction and
minimization layer** that strips identifiers, and every connector must declare, in its manifest,
exactly what categories of data it transmits. The dashboard shows you a running tally of what left
your machine and where it went.

**The honest problem with your Mac as the host.** You chose your primary Mac as FRIDAY's home. It
is the right *starting* choice — zero cost, zero setup, and you can begin this week. But your Mac
sleeps, and a sleeping FRIDAY cannot watch for the things that make an assistant valuable. This is
a known, scheduled problem, not an oversight: the architecture treats the core as a relocatable
service from day one, and Chapter 39 schedules the move to always-on hardware at Milestone 5, by
which point you will know whether you want it. Nothing about that move requires a rewrite.

### 5. FRIDAY builds herself through pull requests, and you are the merge button

You asked for FRIDAY to be able to build herself, and for approval on every merge. Those two
requirements have a natural implementation that also happens to be industry-standard practice:
FRIDAY's Engineering Department is a normal contributor to this repository with normal contributor
permissions. She works on a branch named `friday/*`, runs the full test suite, writes a pull
request explaining what she changed and why, and stops.

**Why this is the right mechanism and not a compromise.** It gives you, for free, every safety
property you would otherwise have to invent: an isolated workspace (the branch), automated
verification (CI), a human-readable explanation (the PR description), a reversible decision (revert
the merge), and a permanent record of who changed what and why (git history). Article VIII
— "recommendations should always be presented to the user before significant changes" — is
implemented by a mechanism thousands of companies already trust, rather than by something we
invented.

**The one thing to watch.** A system that writes its own code can, over time, produce a codebase
optimized for a machine's convenience rather than a human's understanding. Chapter 31 sets hard
limits: AI-authored pull requests are capped in size, must not touch the Guardian or the founding
documents, and must include a plain-language summary you can evaluate without reading the code.

---

## The system in one picture

```
                    ┌─────────────────────────────────────────┐
   You  ──────────► │            SURFACES                     │
   voice / phone    │  Mac app · iPhone · Web · CLI · Voice   │
   / dashboard      └────────────────┬────────────────────────┘
                                     │  typed API (one schema, all clients)
                    ┌────────────────▼────────────────────────┐
                    │         THE KERNEL  (your Mac)          │
                    │                                         │
                    │   ┌─────────────────────────────────┐   │
                    │   │  CHIEF OF STAFF                 │   │
                    │   │  understands intent, makes a    │   │
                    │   │  durable Plan, delegates, waits │   │
                    │   └───────────────┬─────────────────┘   │
                    │                   │                     │
                    │   ┌───────────────▼─────────────────┐   │
                    │   │  GUARDIAN                       │   │
                    │   │  ALLOW / DENY / NEEDS_APPROVAL  │◄──┼── your approvals
                    │   │  no action passes without it    │   │
                    │   └───────────────┬─────────────────┘   │
                    │                   │                     │
                    │   ┌───────────────▼─────────────────┐   │
                    │   │  EVENT BUS  (append-only log)   │   │
                    │   │  every action recorded first    │───┼──► audit / explain / replay
                    │   └───┬───────────┬───────────┬─────┘   │
                    │       │           │           │         │
                    │  ┌────▼────┐ ┌────▼────┐ ┌────▼─────┐   │
                    │  │DEPTS &  │ │ MEMORY  │ │DIAGNOSTICS│  │
                    │  │ AGENTS  │ │4 layers │ │self-health│  │
                    │  └────┬────┘ └─────────┘ └───────────┘  │
                    │       │                                 │
                    │  ┌────▼──────────────────────────────┐  │
                    │  │  MODEL ROUTER    CONNECTORS       │  │
                    │  │  (any AI vendor) (any service)    │  │
                    │  └────┬──────────────────┬───────────┘  │
                    └───────┼──────────────────┼──────────────┘
                            │                  │
                   minimized│         scoped   │
                    context │       credentials│
                            ▼                  ▼
                    ┌───────────────┐  ┌──────────────────┐
                    │ Cloud AI      │  │ Google · GitHub  │
                    │ (replaceable) │  │ Home · Bank ...  │
                    └───────────────┘  └──────────────────┘
```

Read it top to bottom: a request from you enters through any surface, becomes a durable Plan owned
by the Chief of Staff, is broken into actions, each action is authorized by the Guardian, recorded
on the Event Bus, and executed by an Agent inside a Department using a Connector or a Model. The
result comes back up the same path, and every step of it is permanently answerable to the question
"why?"

---

## The technology stack at a glance

Full reasoning and alternatives in [Chapter 02](02-technology-stack.md). This is the summary.

| Layer | Choice | One-line reason |
|---|---|---|
| Language | **TypeScript 5.x (strict)** | One language everywhere; types shared end to end |
| Runtime | **Node.js 24 LTS** | Boring, long-supported, best-in-class for I/O coordination |
| Package manager | **pnpm workspaces** | Fast, strict about dependencies, built for monorepos |
| Build orchestration | **Turborepo** | Caches work; keeps 10-minute builds at 20 seconds |
| Schemas & validation | **Zod** | One schema definition becomes types, validation, and API docs |
| Internal API | **tRPC** | Client and server share types; whole classes of bug vanish |
| Database | **SQLite (WAL) + Drizzle ORM** | Serious database, zero servers, one file to back up |
| Vector search | **sqlite-vec** | Memory search inside the same file — no second database |
| Event bus | **SQLite-backed durable log + in-process dispatch** | The audit trail and the bus are the same thing |
| Web UI | **React 19 + Vite + Tailwind** | Largest ecosystem, best AI-assistant support |
| Desktop | **Tauri 2** | ~10 MB app, low memory, one codebase for desktop and mobile |
| Mobile | **Tauri 2 mobile** (fallback: Capacitor) | Same UI codebase reaches iPhone and Android |
| AI models | **Model Router abstraction** over Anthropic / OpenAI / local Ollama | Article VI: no vendor may be load-bearing |
| Speech in | **whisper.cpp**, local, sealed process | Audio never leaves your machine |
| Speech out | **Piper** local, with optional cloud voice | Quality/privacy chosen per situation |
| Observability | **OpenTelemetry** + local collector | Vendor-neutral; costs nothing until you want a dashboard |
| CI/CD | **GitHub Actions** | Free at your scale; the merge gate for FRIDAY's own PRs |
| Testing | **Vitest** + **Playwright** + **agent evals** | Unit, end-to-end, and non-deterministic-AI testing |
| Lint/format | **Biome** | One fast tool replacing three slow ones |

**Estimated monthly cost at Milestone 4:** $35–90, inside your $50–200 band. Breakdown in
[Chapter 39](39-roadmap.md). The dominant variable is cloud AI usage, which the Model Router caps
with a hard budget ceiling that fails closed.

---

## Repository shape

One repository. Monorepo. Full argument in [Chapter 04](04-monorepo-vs-multirepo.md), but briefly:
multi-repo exists to let independent teams release independently, and you do not have independent
teams. What you have is one person making changes that cut across the server, the phone app, and
the shared data types simultaneously — which is precisely the case a monorepo makes trivial and
multi-repo makes miserable.

```
friday/
├── docs/          the founding documents, this Bible, decisions, runbooks
├── apps/          things that run: core, desktop, mobile, web, cli
├── packages/      the kernel and its libraries: guardian, memory, event bus, ...
├── departments/   FRIDAY's organizational units, each self-contained
├── connectors/    one folder per external service
├── tools/         build config, scripts, agent evaluation harness
├── tests/         end-to-end and cross-package contract tests
└── infra/         service definitions, backup config, telemetry config
```

Every folder has a README explaining its charter and its rules. Chapter 03 walks the tree.

---

## What gets built, in what order

Full roadmap with dates in [Chapter 39](39-roadmap.md). You chose Core-before-features, which is
the correct call and the harder one — it means several months before FRIDAY does anything
impressive. Here is the honest sequence at 10–20 hrs/week:

| # | Milestone | Outcome | Estimate |
|---|---|---|---|
| **M0** | Ground | Tooling installed, repo on GitHub, CI green, first ADRs | 2–3 weeks |
| **M1** | Heartbeat | Event bus, durable log, database, config, logging. FRIDAY records but cannot act. | 4–6 weeks |
| **M2** | Conscience | Guardian, approvals, capability tokens, audit trail. She can be told no. | 4–5 weeks |
| **M3** | Mind | Agent runtime, Model Router, Chief of Staff, Plans. She can think and delegate. | 6–8 weeks |
| **M4** | Face | Web dashboard, Mac app, first real connector. **First useful day.** | 6–8 weeks |
| **M5** | Memory & Endurance | Four-layer memory, always-on host, backups, disaster recovery drill | 6–8 weeks |
| **M6** | Self-Improvement | Engineering Department; FRIDAY opens her first pull request | 6–10 weeks |
| **M7** | Reach | iPhone app, notifications, voice | 8–12 weeks |
| **M8** | Breadth | Additional departments per the Long-Term Vision | ongoing |

**M4 is the milestone that matters psychologically** — roughly six to eight months in, it is the
first point where FRIDAY does something you would miss if it stopped. Everything before it is
foundation you cannot see. That is the cost of building the core first, and it is the right cost to
pay: the alternative is building three features and then discovering the foundation cannot hold
them.

---

## Where this architecture is weakest

An executive summary that only lists strengths is marketing. These are the four things most likely
to hurt, stated plainly. Each has a mitigation and an owner in [Chapter 36](36-risk-register.md).

1. **The host machine is a laptop that sleeps.** Scheduled work, monitoring, and proactive
   assistance will be unreliable until Milestone 5. Mitigated by designing the core as relocatable
   from day one and by making all scheduled work catch-up-capable rather than
   fire-and-forget.

2. **Motivation across a six-month foundation phase.** The single most likely cause of death for
   this project is not technical — it is that nothing visible happens for half a year. Mitigated by
   requiring every milestone to end in something demonstrable, even if only a terminal command that
   proves the layer works, and by pulling a thin dashboard forward into M2 so you can watch the
   event log stream in real time long before the real UI exists.

3. **AI-generated code accumulating subtle inconsistency.** Assistants write plausible code that
   drifts from established patterns in ways that are individually harmless and collectively fatal.
   Mitigated by machine-enforced module boundaries, a strict type system that rejects ambiguity, an
   AI-contributor instruction file at the repo root, and hard size caps on AI-authored pull
   requests.

4. **Scope. The Long-Term Vision lists ten domains.** Attempting them in parallel guarantees ten
   half-built things. Mitigated by the Department model — each domain is a separately-shippable
   unit that either exists and works or does not exist at all, never a half-finished thing wired
   into the core.

---

## The test every future decision must pass

Before any significant architectural change, answer these five questions in writing. If any answer
is uncomfortable, the design is not ready.

1. **Can the user see it?** If FRIDAY does this, does it appear in the audit log and the dashboard
   without anyone remembering to add it? *(Article II)*
2. **Can the user stop it?** Is there a point where this blocks for approval, and does the plan
   survive waiting three days for an answer? *(Article III)*
3. **Can we replace it?** If this vendor disappears tomorrow, what is the size of the change?
   If the answer is "large," there is a missing abstraction. *(Article VI)*
4. **Can we explain it?** When the user asks "why did you do that," can the system reconstruct the
   causal chain from stored data — not from a language model's guess about its own past reasoning?
   *(Principle 7)*
5. **Will this still be right in five years?** *(Manifesto, Long-Term Thinking)*

These five questions are reproduced in the pull request template and the ADR template, so they get
asked in the moment rather than admired in a document.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
