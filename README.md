# FRIDAY

**A Personal Artificial Intelligence Operating System.**

FRIDAY is not an application. She is the intelligent operating layer above them — coordinating your
calendar, your code, your home, your notes, and your correspondence without replacing any of them.

> "Build technology that quietly disappears into the background while making life noticeably
> better."
> — [The FRIDAY Manifesto](docs/00-foundation/manifesto.md)

---

## Status

**Her decisions are written down.** Milestones 1 through 3 are complete: FRIDAY has an event log, a
Guardian that can refuse, and a record of everything it decides. **She does not run on a machine
yet** — nothing installs or supervises her. That is Milestone 4.

```
friday init                          prepare a machine for her
friday events tail                   watch the log, live
friday verify                        confirm the record has not been altered
friday status                        is she healthy?
```

| | |
|---|---|
| Phase | Milestone 3 — Authority, shipped 2026-08-10 · **ready to begin M4** |
| Founding documents | ✅ Ratified |
| Project Bible | ✅ 41 chapters, ratified 2026-08-06 |
| Architecture Decision Records | ✅ 35 |
| Build tooling | ✅ pnpm workspaces · Turborepo · TypeScript strict · Biome · dependency-cruiser |
| Testing | ✅ Vitest — 802 tests |
| Boundary enforcement | ✅ Verified firing, with regression tests |
| CI pipeline | ✅ 5 staged gates, green on `main` |
| **Event log** | ✅ Append-only, gapless, hash-chained — enforced by database triggers |
| **Tamper evidence** | ✅ `friday verify`, tested by editing the file behind the code's back |
| **Field encryption** | ✅ AES-256-GCM for private data, keys in the Keychain |
| **Event bus** | ✅ Durable before dispatch · sync and async lanes · at-least-once |
| **System log** | ✅ Three-layer redaction, rotation inside a fixed budget |
| **Guardian** | ✅ Composed at startup from rules on disk · fails closed · refuses an empty rule set |
| **Approvals** | ✅ Requested, granted, declined, expired — each recorded as an event |
| **Dashboard** | ✅ Read-only — live event stream and pending approvals |
| **Startup self-check** | ✅ She asks her own permission, and will not start on a chain that does not verify |
| **First-run provisioning** | ⚠ `friday init` — creation-only, never replaces a key. Built and tested; **never yet run against a real Keychain** — M4's first task |
| Packaging, launchd, releases | ⬜ Milestone 4 |
| Agents, plans, model routing | ⬜ Milestone 5 |
| Mac app, connectors | ⬜ Milestone 6 |

See [Chapter 39 — Roadmap](docs/01-bible/39-roadmap.md) for what comes next and why in this order.

---

## Working on it

```bash
corepack enable && pnpm install   # Node 24 LTS, pinned in .nvmrc
pnpm run setup                    # local git hooks — once per clone
pnpm check                        # everything the pull request gate runs
```

| | |
|---|---|
| `pnpm check` | Format, lint, types, architecture boundaries, docs, tests |
| `pnpm build` | Every package, in dependency order, cached |
| `pnpm test` | Unit and integration tests · `test:unit` `test:integration` `test:coverage` |
| `pnpm fix` | Applies every safe formatting and lint fix |

Full guide: [Working in the Monorepo](docs/guides/how-to/working-in-the-monorepo.md).

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
tools/         shared tsconfig · lint and test config · scripts · the eval harness
tests/         constitutional, end-to-end, and cross-package contract tests
infra/         service definitions, backup config, telemetry config
```

Dependencies flow one way, and `dependency-cruiser` fails the build when they do not:

```
apps/  ──►  departments/  ──►  packages/  ──►  packages/contracts
              │                                        ▲
              └──►  connectors/  ─────────────────────┘
```

Every folder has a `README.md` stating its charter and its boundaries.
Full map: [Chapter 03 — Repository Structure](docs/01-bible/03-repository-structure.md).

---

## Technology

| | |
|---|---|
| Language | TypeScript (strict), everywhere |
| Runtime | Node.js 24 LTS |
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

| # | Milestone | Outcome | Status |
|---|---|---|---|
| M0 | Ground | Tooling, CI, branch protection, seed ADRs | ✅ 2026-08-06 |
| M1 | Heartbeat | Event bus, database, logging — she records | ✅ 2026-08-07 |
| M2 | Conscience | Guardian, approvals, audit — she can be told no | ✅ 2026-08-08 |
| M3 | Authority | Rules on disk, decisions recorded, `friday init` | ✅ 2026-08-10 ⚠ |
| M4 | **Installable** | Packaging, launchd, releases — **she runs on your Mac** | ◆ next |
| M5 | Mind | Agents, Model Router, plans — she thinks | |
| M6 | **Face** | Dashboard, Mac app, first connector — **first useful day** | |
| M7 | Memory & Endurance | Four-layer memory, always-on host, disaster recovery | |
| M8 | Self-Improvement | FRIDAY opens her first pull request | |
| M9 | Reach | iPhone, notifications, voice | |
| M10 | Breadth | Additional departments | |

**This chapter was re-baselined on 2026-08-10.** M3 delivered something the roadmap had not planned,
and M4 changed from *Face* to *Installable* because *Face* depends on work that does not exist yet.
Calendar targets past M4 are withdrawn until there is evidence to re-estimate from. Milestone numbers
inside ADRs mean what they meant when written — the map is in
[Chapter 39](docs/01-bible/39-roadmap.md#re-baselined-2026-08-10).

**⚠ means the code and its tests shipped but the milestone's stated outcome was never demonstrated
end to end.** M3's gap is that `friday init` has never run against a real Keychain. It is M4's first
task, not an assumption.

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

**All rights reserved.** See [`LICENSE`](LICENSE).

Chosen deliberately, and it forecloses nothing. FRIDAY holds her owner's calendar, correspondence,
notes, home, and finances; reserving all rights keeps every option open while that is true, and it
costs nothing — the copyright holder may relicense at any time, because they hold all of the
copyright. The reverse is not true: code released under an open license cannot be un-released.

If FRIDAY is ever opened, **AGPL-3.0** is the most philosophically consistent choice — it would let
others use and modify her while preventing anyone from building a closed product on work whose
founding documents are about user sovereignty. That change requires an ADR.
