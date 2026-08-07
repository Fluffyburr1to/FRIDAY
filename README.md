# FRIDAY

**A Personal Artificial Intelligence Operating System.**

FRIDAY is not an application. She is the intelligent operating layer above them — coordinating your
calendar, your code, your home, your notes, and your correspondence without replacing any of them.

> "Build technology that quietly disappears into the background while making life noticeably
> better."
> — [The FRIDAY Manifesto](docs/00-foundation/manifesto.md)

---

## Status

**She records.** Milestone 1 is complete: FRIDAY has an event log, and you can watch it work. She
cannot act on anything yet — that is Milestone 2.

```
friday events emit --note "hello"    record an event
friday events tail                   watch them arrive, live
friday verify                        confirm the record has not been altered
friday status                        is she healthy?
```

| | |
|---|---|
| Phase | Milestone 1 — Heartbeat, complete 2026-08-07 · **ready to begin M2** |
| Founding documents | ✅ Ratified |
| Project Bible | ✅ 41 chapters, ratified 2026-08-06 |
| Architecture Decision Records | ✅ 24 |
| Build tooling | ✅ pnpm workspaces · Turborepo · TypeScript strict · Biome · dependency-cruiser |
| Testing | ✅ Vitest — 322 tests across six packages |
| Boundary enforcement | ✅ Verified firing, with regression tests |
| CI pipeline | ✅ 5 staged gates, green on `main` |
| Branch protection | ✅ Enforced, including for the owner |
| **Event log** | ✅ Append-only, gapless, hash-chained — enforced by database triggers |
| **Tamper evidence** | ✅ `friday verify`, tested by editing the file behind the code's back |
| **Field encryption** | ✅ AES-256-GCM for private data, keys in the Keychain |
| **Event bus** | ✅ Durable before dispatch · sync and async lanes · at-least-once |
| **System log** | ✅ Three-layer redaction, rotation inside a fixed budget |
| Guardian and approvals | ⬜ Milestone 2 |
| Compaction and archival | ⬜ Milestone 2, [deliberately](docs/adr/0024-compaction-and-archival-are-milestone-2.md) |
| Agents, plans, model routing | ⬜ Milestone 3 |

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

| # | Milestone | Outcome | Target |
|---|---|---|---|
| M0 | Ground | Tooling, CI, branch protection, seed ADRs | ✅ Aug 2026 |
| M1 | Heartbeat | Event bus, database, logging — she records | ✅ Aug 2026 |
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

**All rights reserved.** See [`LICENSE`](LICENSE).

Chosen deliberately, and it forecloses nothing. FRIDAY holds her owner's calendar, correspondence,
notes, home, and finances; reserving all rights keeps every option open while that is true, and it
costs nothing — the copyright holder may relicense at any time, because they hold all of the
copyright. The reverse is not true: code released under an open license cannot be un-released.

If FRIDAY is ever opened, **AGPL-3.0** is the most philosophically consistent choice — it would let
others use and modify her while preventing anyone from building a closed product on work whose
founding documents are about user sovereignty. That change requires an ADR.
