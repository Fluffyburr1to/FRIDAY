# FRIDAY

**A Personal Artificial Intelligence Operating System.**

FRIDAY is not an application. She is the intelligent operating layer above them — coordinating your
calendar, your code, your home, your notes, and your correspondence without replacing any of them.

> "Build technology that quietly disappears into the background while making life noticeably
> better."
> — [The FRIDAY Manifesto](docs/00-foundation/manifesto.md)

---

## Status

**Pre-implementation.** The engineering foundation is complete; no application code exists yet.

| | |
|---|---|
| Phase | Milestone 0 — Ground |
| Founding documents | ✅ Ratified |
| Project Bible | ✅ 41 chapters, ratified 2026-08-06 |
| Repository structure | ✅ Defined |
| Application code | ⬜ Not started — by design |

This is deliberate. See [Chapter 39 — Roadmap](docs/01-bible/39-roadmap.md).

---

## Start here

**If you have never seen this project before, read in this order.** It takes about an hour and it is
the only way to understand why anything here is the way it is.

1. **[The Manifesto](docs/00-foundation/manifesto.md)** — why FRIDAY exists and who she is
2. **[The Constitution](docs/00-foundation/constitution.md)** — ten Articles of binding law
3. **[Core Values](docs/00-foundation/core-values.md)** — how those apply to daily decisions
4. **[Long-Term Vision](docs/00-foundation/long-term-vision.md)** — where this goes
5. **[Executive Summary](docs/01-bible/01-executive-summary.md)** — the whole architecture in ten
   minutes

Then, as needed: **[The Project Bible](docs/01-bible/)** — 41 chapters covering every architectural
decision, why it was made, what else was considered, and what it costs.

**If you do not write code:** read the "In plain language" and "Trade-offs" sections of any chapter
and skip the rest. That is enough to govern this project competently.

**If you are an AI assistant:** read [`CLAUDE.md`](CLAUDE.md) first. It is short and it is binding.

---

## The five things that define this architecture

Full reasoning in the [Executive Summary](docs/01-bible/01-executive-summary.md).

1. **Event-sourced core.** Every meaningful action is written to an immutable, hash-chained log
   *before* it happens. The audit trail is not a feature bolted on — it is how actions occur. *(If
   FRIDAY cannot record, she does not act.)*

2. **The Guardian.** One component decides whether any action is permitted. Agents hold no
   credentials, no network access, and no filesystem access — they can only *ask*. Approval is
   structural, not a dialog box.

3. **Local-first.** FRIDAY's core, her memory, and all of your data live on a machine you own. Only
   minimized context goes to cloud AI models, and sensitive content never does.

4. **Nothing load-bearing is a vendor.** No AI provider, database, or service name appears in
   FRIDAY's core. Every one is behind an interface and replaceable in an afternoon.

5. **She proposes; you decide.** FRIDAY writes her own code on a branch, runs the full test suite,
   explains what she changed in plain language, and stops. You are the merge button.

---

## Repository layout

```
docs/          the founding documents, the Project Bible, decisions, runbooks
apps/          things that run — core, desktop, mobile, web, cli
packages/      the kernel and its libraries — guardian, memory, event bus, ...
departments/   FRIDAY's organizational units, each self-contained
connectors/    one folder per external service
tools/         build config, scripts, the agent evaluation harness
tests/         end-to-end and cross-package contract tests
infra/         service definitions, backup config, telemetry config
```

Every folder has a `README.md` stating its charter and its boundaries.
Full map: [Chapter 03 — Repository Structure](docs/01-bible/03-repository-structure.md).

---

## Technology

| | |
|---|---|
| Language | TypeScript (strict), everywhere |
| Runtime | Node.js 22 LTS |
| Data | SQLite + Drizzle + sqlite-vec |
| API | tRPC (internal), OpenAPI (external, later) |
| Interface | React + Vite + Tailwind + Radix |
| Shells | Tauri 2 — desktop and mobile |
| AI | Vendor-neutral Model Router · Anthropic · OpenAI · local Ollama |
| Voice | whisper.cpp · Piper · openWakeWord — **all local** |
| Quality | Vitest · Playwright · Biome · agent evals |

Reasoning and rejected alternatives: [Chapter 02](docs/01-bible/02-technology-stack.md).

---

## Roadmap

| # | Milestone | Outcome | Target |
|---|---|---|---|
| M0 | Ground | Tooling, CI, branch protection, seed ADRs | Aug 2026 |
| M1 | Heartbeat | Event bus, database, logging — she records | Oct 2026 |
| M2 | Conscience | Guardian, approvals, audit — she can be told no | Nov 2026 |
| M3 | Mind | Agents, Model Router, plans — she thinks | Jan 2027 |
| M4 | **Face** | Dashboard, Mac app, first connector — **first useful day** | Mar 2027 |
| M5 | Memory & Endurance | Four-layer memory, always-on host, disaster recovery | May 2027 |
| M6 | Self-Improvement | FRIDAY opens her first pull request | Aug 2027 |
| M7 | Reach | iPhone, notifications, voice | Nov 2027 |
| M8 | Breadth | Additional departments | 2028+ |

Estimates assume 10–20 hrs/week. **Expect 30–50% slippage** — that is normal, not failure.
Full detail: [Chapter 39](docs/01-bible/39-roadmap.md).

---

## Contributing

Everyone — human or AI — follows the same process:
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Every pull request answers five questions:

- **Can the user see it?** *(Article II)*
- **Can the user stop it?** *(Article III)*
- **Can we replace it?** *(Article VI)*
- **Can we explain it?** *(Principle 7)*
- **Will this still be right in five years?**

Security policy: [`SECURITY.md`](SECURITY.md).
AI contributor rules: [`CLAUDE.md`](CLAUDE.md).

---

## The founding documents outrank everything

If this README, the Project Bible, an ADR, or any line of code conflicts with a document in
[`docs/00-foundation/`](docs/00-foundation/), **the founding document wins and the other artifact is
a defect to be fixed.**

Only the project owner may amend them. Proposed improvements are recorded in
[Chapter 40](docs/01-bible/40-founding-document-observations.md), which proposes and never amends.

---

## License

**Not yet chosen.** This is a Milestone 0 decision for the project owner, and it is deliberately not
made on your behalf — the choice has real consequences for whether FRIDAY can ever be shared,
open-sourced in part, or built upon by others.

Until a `LICENSE` file exists, all rights are reserved by the owner.

The three options worth considering, briefly:

| Option | Means | Suits |
|---|---|---|
| **All rights reserved** (no license) | Nobody may copy or use this. The default. | Keeping FRIDAY entirely private |
| **AGPL-3.0** | Anyone may use and modify it, but must publish their changes — including if they run it as a service | Sharing the work while preventing someone from building a closed product on it |
| **MIT / Apache-2.0** | Anyone may do nearly anything, including building a commercial product | Maximum adoption if FRIDAY ever becomes something others use |

Given the founding documents' emphasis on user sovereignty and vendor independence, **AGPL-3.0** is
the most philosophically consistent choice if you ever open this. Nothing needs deciding today.
