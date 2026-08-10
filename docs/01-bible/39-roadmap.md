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
front is: **expect 30–50% slippage.** A milestone arriving a month after its target is normal and is
not a failure.

---

## Re-baselined 2026-08-10

**This chapter was re-baselined after M3.** What was built in M1–M3 is not what the first version of
this table said would be built, and the table said nothing about it. That is the failure mode
Chapter 38 exists to prevent — *"if it is not written down, it does not exist"* — so the correction
is recorded here rather than applied quietly.

Two things changed.

**M3 is not the milestone this chapter originally described.** The original M3 was *Mind* — agents,
the Model Router, the Chief of Staff. **None of that was built, and none of it is claimed here.**
`packages/model-router`, `packages/agent-runtime`, `packages/chief-of-staff`, and
`packages/diagnostics` are still empty directories. What was actually delivered was a different
milestone that this chapter never listed: making the Guardian real outside a test fixture, recording
what it decides, and making a machine preparable at all. It is named **Authority** below. *Mind* is
not cancelled — it moves to M5, intact.

**M4 becomes Installable.** Three documents outside this chapter already assumed it —
`CHANGELOG.md` ("nothing to version until Milestone 4 produces something installable"),
`SECURITY.md` ("only the current version receives fixes — this changes at Milestone 4"), and the
packaging review triggers in [ADR-0033](../adr/0033-authorization-rules-are-loaded-from-a-configured-directory.md)
and [ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md) ("**Packaging lands (M4)**").
This chapter was the outlier. The deciding argument is dependency, not tidiness: the original M4
(*Face*) is defined by asking FRIDAY a question and getting an answer, which requires *Mind*, which
does not exist. *Face* cannot be next. Packaging can, and after M3 it is one milestone away.

This is a **re-scope, not a skip**, which rule 1 under [How the roadmap changes](#how-the-roadmap-changes)
permits. Nothing has been dropped; two milestones moved and one was inserted.

### Milestone numbers in documents written before this date

Milestone numbers are not stable addresses the way ADR numbers are, and everything from *Memory &
Endurance* onward shifted by two. **ADRs are immutable and were not edited.** A milestone number
inside an ADR means what it meant on the day that ADR was written — read it through this map:

| Written as | Now | Content |
|---|---|---|
| M3 | **M5** | Mind — agents, Model Router, Chief of Staff |
| M4 | **M6** | Face — full dashboard, Tauri shell, first connector |
| M5 | **M7** | Memory & Endurance — memory, backups, recovery card |
| M6 | **M8** | Self-Improvement |
| M7 | **M9** | Reach |
| M8 | **M10** | Breadth |

The one exception is deliberate: **"Packaging lands (M4)" in ADR-0033 and ADR-0035 still means M4.**
Those triggers named packaging, and packaging is what M4 now is. They fire on schedule.

Folder READMEs under `packages/`, `apps/`, `connectors/`, `tools/`, and `tests/` still carry
pre-re-baseline numbers. They are charters rather than decision records, so they are edited in place
— but in their own change, not this one, to keep this diff reviewable.

---

## The arc

Calendar targets beyond M4 are **withdrawn, not moved.** The original dates assumed 10–20 hours a
week of human work; M0–M3 were delivered in five days by an AI assistant working against a Bible
that had already settled the design. Both numbers are real and neither predicts the other, so
re-estimating from four data points that compressed by two orders of magnitude would produce a
number with no information in it. They are re-set at the M4 boundary, against evidence.

```
DELIVERED ─ 2026-08-06 → 2026-08-10
  M0 ───── M1 ──────── M2 ────────── M3
  Ground   Heartbeat   Conscience    Authority
           she records she can be    her rules load, her
                       told no       decisions are written down

PLANNED
  M4 ─────────── M5 ───── M6 ──── M7 ────────── M8 ────────── M9 ───── M10
  Installable    Mind     Face    Memory &      Self-         Reach    Breadth
  ★ she runs              ★ first Endurance     Improvement
    on your Mac             useful day
```

| # | Name | What exists at the end | Estimate | Status |
|---|---|---|---|---|
| **M0** | **Ground** | Tooling, repo, CI, first ADRs | 2–3 wks | ✅ 2026-08-06 |
| **M1** | **Heartbeat** | Event bus, database, config, logging | 4–6 wks | ✅ 2026-08-07 |
| **M2** | **Conscience** | Guardian, approvals, audit, thin dashboard | 4–5 wks | ✅ 2026-08-08 |
| **M3** | **Authority** | Rules loaded from disk, decisions recorded, `friday init` | — | ✅ 2026-08-10 ⚠ |
| **M4** | **Installable** | Packaging, launchd supervision, release machinery | 2–3 wks | ◆ next |
| **M5** | **Mind** | Agents, Model Router, Chief of Staff, plans | 6–8 wks | |
| **M6** | **Face** | Dashboard, Mac app, first connector — **first useful day** | 6–8 wks | |
| **M7** | **Memory & Endurance** | Four-layer memory, always-on host, DR | 6–8 wks | |
| **M8** | **Self-Improvement** | Engineering dept; FRIDAY's first PR | 6–10 wks | |
| **M9** | **Reach** | iPhone, notifications, voice | 8–12 wks | |
| **M10** | **Breadth** | Additional departments | Ongoing | |

M3 carries no estimate because it was never estimated — it was not on the roadmap. **⚠ marks a
milestone whose code and tests shipped but whose done-when was never demonstrated end to end**; M3's
gap is the real Keychain, and closing it is M4's first task.

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
the first commit. Adding boundary enforcement three milestones later means retrofitting it onto code
that already violates it.

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

### ✅ Complete — 2026-08-07

Merged as [#3](https://github.com/Fluffyburr1to/FRIDAY/pull/3), 47 commits, all CI stages green.

`friday events emit` in one terminal, `friday events tail` in another, `friday verify` confirming the
chain. The demonstrable outcome exists and you can watch it work.

**Actual versus estimated — and why the raw numbers are misleading.**

| | |
|---|---|
| Estimated | 4–6 weeks at 10–20 hrs/week — call it 40–120 hours |
| Elapsed | One working day |
| Volume delivered | ~5,700 lines of source, ~4,000 of tests, 6 ADRs |

**Do not calibrate later milestones against that ratio.** Rule 2 of this chapter says record actual
durations to calibrate future estimates, so the honest record has to say what actually happened
rather than report a number that would make every remaining estimate look absurd.

The estimate was not wrong about volume. Five and a half thousand lines of strict, tested,
documented TypeScript genuinely is 40–120 hours of part-time human work. What collapsed was the
*writing*, not the *deciding* — the work was done by an AI assistant against a design the Bible had
already settled completely. Chapters 09, 10, and 22 specified the schema, the two dispatch lanes,
the hash chain, and the three redaction layers in enough detail that implementation was largely
transcription. The foundation-first decision this roadmap opens with is what made that possible.

So the number to carry forward is: **the Bible's specificity is worth roughly what it cost.** Where
a later milestone is equally well specified, expect similar compression. Where it is not — M5's plan
engine and M7's memory system are both described in less operational detail — expect the original
estimates to hold.

Two things did take real time, and would have regardless: deciding what to do about the six
questions the Bible had not settled (recorded as ADRs 0019–0024), and decomposing the work into 47
individually reviewable commits. The second is pure overhead against a solo human's workflow and
pure necessity against this one, because the owner does not read code.

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

**The dashboard is pulled forward here deliberately.** Strict dependency order would put it at
*Face*. It is here because six months without anything to look at is the largest risk to this
project (R1), and because seeing the event stream and approval flow working is genuinely useful for
debugging everything that follows.

### ✅ Complete — 2026-08-08

Merged as [#6](https://github.com/Fluffyburr1to/FRIDAY/pull/6),
[#7](https://github.com/Fluffyburr1to/FRIDAY/pull/7),
[#8](https://github.com/Fluffyburr1to/FRIDAY/pull/8),
[#9](https://github.com/Fluffyburr1to/FRIDAY/pull/9), and
[#10](https://github.com/Fluffyburr1to/FRIDAY/pull/10).

A simulated action requests permission, blocks, appears in the dashboard with its explanation, waits
across a core restart, and executes only after approval. The done-when condition is met.

Six ADRs came out of it — 0025 through 0030 — of which two are worth naming here because they
changed the shape of later milestones. (ADR-0031 is often read as M2's because it settles the
approval record M2 left open; it landed in [#11](https://github.com/Fluffyburr1to/FRIDAY/pull/11)
and belongs to M3.)

- **[ADR-0029](../adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)** brought
  `apps/core` forward to serve the dashboard. Its own review trigger — *"the Chief of Staff lands at
  M3, reassess whether the router shape built here survived"* — **did not fire, because the Chief of
  Staff did not land.** That reassessment is now owed at M5, and it is the honest test of the bet
  ADR-0029 made.
- **[ADR-0030](../adr/0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md)** ruled
  that a loopback connection identifies the owner's *machine*, not the owner's *presence*, so
  high-risk approvals cannot be granted from the browser. Its review trigger names the Tauri shell,
  which is now M6.

**Deferred out of M2 and still open:** compaction and archival
([ADR-0024](../adr/0024-compaction-and-archival-are-milestone-2.md)) shipped, but the archive format
runbook is the only consumer. Nothing has yet been compacted at a size that tests the design.

---

## M3 — Authority · not originally scheduled

**Goal:** FRIDAY's authority is real outside a test fixture — and a machine can be prepared for her.

This milestone was not on the roadmap. It exists because M2 finished with the Guardian working
perfectly in tests and reachable from nothing in production: rules lived in fixtures, its decisions
went to a store and into no event, and the two keys it needs existed only where a test put them.
The gap was found while building, named rather than papered over, and closed here.

| Package | Deliverable |
|---|---|
| `clerk` | **The clerk** — every Guardian decision recorded as an event ([ADR-0031](../adr/0031-the-clerk-records-what-the-guardian-decided.md)) |
| `clerk` | Approval request, grant, decline, and **expiry**, each its own transaction |
| `storage` | The Guardian's state moves into `events.db` ([ADR-0032](../adr/0032-the-guardians-state-moves-into-the-event-log-database.md)) |
| `guardian` | Authorization rules load from a configured directory ([ADR-0033](../adr/0033-authorization-rules-are-loaded-from-a-configured-directory.md)) |
| `guardian` | Counter writes moved outside the append transaction ([ADR-0034](../adr/0034-guardian-counter-writes-happen-outside-the-append-transaction.md)) |
| `apps/core` | Composes a real Guardian at startup, from real rules on disk |
| `apps/core` | **Startup self-check** — FRIDAY asks her own permission to verify her audit trail, and **refuses to start on a chain that does not verify** |
| `storage` | Keychain key provisioner — creation-only, never replacing a key |
| `cli` | **`friday init`** — seeds the policy directory and mints both keys ([ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md)) |

**Done when:** a machine with no FRIDAY state on it can be prepared by one command, and `apps/core`
starts on it with a Guardian composed from rules on disk — or refuses to start, loudly, for a
nameable reason.

### ✅ Shipped 2026-08-10 — ⚠ done-when not demonstrated end to end

**The code and its tests exist. The done-when above has never been run.** Those are different
claims and this record keeps them apart deliberately, because every other completion record in this
chapter describes something that was watched working.

**What was not demonstrated: the real Keychain.** `friday init` mints both keys through a
`KeyProvisioner`, and **every test injects the in-memory one.** The production implementation,
`createKeychainKeyProvisioner`, has no test coverage and no recorded execution — nothing in this
repository has ever run `friday init` against a real Keychain, or started `apps/core` on a machine
that was not a checkout. [`apps/cli/test/integration/init.test.ts`](../../apps/cli/test/integration/init.test.ts)
says so in its own header — *"No test in this repository starts FRIDAY against a real Keychain"* —
and explains why: doing it would write to the developer's login keychain, and there is no safe way
to do that in a test run.

That is a defensible testing decision and it is **not** a defensible basis for calling the done-when
met. What is genuinely established is narrower, and it is the honest version of this milestone:

| Established | Not established |
|---|---|
| Every decision `friday init` makes, against an injected provisioner — 44 integration tests | That `security add-generic-password` is invoked correctly even once |
| The refusal when a database predates a missing field-encryption key | That a fresh machine can be prepared end to end |
| `apps/core` composing a Guardian from rules on disk, in tests | That `apps/core` starts on a machine it was not built on |

**This is carried into M4 as a risk rather than an assumption**, and it is the first thing that
milestone should close. See [M4](#m4--installable--23-weeks---she-runs-on-your-mac).

**The approval-event debt is closed.** M2 left `approval.requested`, `.granted`, `.declined`,
`.expired`, and `.auto_granted` defined in `packages/contracts` with **nothing publishing them** —
an approval was durable in a store and absent from the event log, which meant the causal chain
Article II promises had a hole in it exactly where approvals go. It was recorded as explicit M3 debt
rather than fixed in passing, because closing it meant giving the Guardian an event-emission
interface and that is a package-boundary change, not plumbing. ADR-0031 settled it: a *clerk* sits
between the Guardian and the log. `packages/clerk/src/approval-clerk.ts` now publishes
`approval.requested`, `.granted`, `.declined`, and `.expired` inside the append transaction.

**One residual, deliberately named rather than left to be rediscovered:**

> **`approval.auto_granted` has no publisher.** The contract exists
> (`packages/contracts/src/guardian-event-types.ts`), Chapter 19 names it as the event the dashboard
> shows, and `packages/audit/src/phrasing.ts` already knows how to phrase it — but the clerk's
> outcome map covers `approved`, `declined`, and `expired` only. An auto-granted approval is
> therefore invisible in the log, which is the one class of approval the owner never sees happen and
> so the one that most needs the record. **It is a small change and it is not scheduled.** It should
> be picked up by whichever milestone next touches the clerk, and M4 does not.

**Deferred from M3, explicitly, so it is not carried forward silently a third time.**
[ADR-0021](../adr/0021-the-cli-reads-the-event-log-in-process-until-m3.md) has two review triggers
that were due at this milestone and were not done:

| Trigger | Status | Reconsidered at |
|---|---|---|
| *"`apps/core` ships — move `status`, `events tail`, and `verify` onto the API and keep the read-only path as the documented fallback."* | **Deferred.** `apps/core` actually shipped at M2, not M3, so this has been due since then. | **M6 (Face)** |
| *"`friday events emit` opens the log for writing — a way to record something FRIDAY did not do."* | **Deferred.** | **M4** |

**Why the API migration is deferred:** it is a change to how the CLI reaches its data, and the CLI is
about to become the thing an installer delivers. Moving it onto the API in the same stretch as
packaging means debugging two moving parts against each other on a machine that has never run FRIDAY
before. The read-only in-process path works, is tested, and is the documented fallback by ADR-0021's
own design. It is reconsidered at M6, when the dashboard needs the same queries and there is a second
consumer to justify the seam.

**Why `friday events emit` is *not* deferred past M4:** it is a correctness question, not a
convenience one. A CLI that can append arbitrary events to the log is a way to record something
FRIDAY did not do, which is an Article II problem, and packaging is what puts that command on the
owner's machine. It must be settled *in* M4 — restricted, gated, or removed from the shipped
surface — rather than shipped as-is.

**Actual versus estimated:** not applicable. This milestone had no estimate because it was not
planned. Four days, ten merged pull requests
([#11](https://github.com/Fluffyburr1to/FRIDAY/pull/11)–[#20](https://github.com/Fluffyburr1to/FRIDAY/pull/20))
and no direct commits, five ADRs (0031–0035).

**One process note, recorded because it is the kind of thing that is invisible later.** From
[#17](https://github.com/Fluffyburr1to/FRIDAY/pull/17) onward, merge commits stopped carrying their
pull-request number in the subject line, unlike `(#1)` through `(#16)` before them. **The merge
method changed; the process did not.** Every commit in this milestone was reviewed and merged
through a pull request — `0341e72` is #17, `c02ccda` is #18, `e43a539` is #19, and `1980cc8` is #20.
Branch protection held.

What was lost is the ability to read a commit's review back off `git log` alone; it now takes the
API. That is worth knowing before M4's release process starts quoting commit subjects at the owner,
and it is worth recording for a much simpler reason: **the absence of those numbers reads as a
bypass, and during the drafting of this section it was briefly written up as one.** It was not.

---

## M4 — Installable · 2–3 weeks · ★ she runs on your Mac

**Goal:** FRIDAY runs on your machine, starts when you log in, and can be updated.

After M3 the gap is narrow and specific: `friday init` can prepare a machine **in tests**, and
**nothing in the repository installs FRIDAY onto one or keeps her running.** There is no bundle, no
supervision, and no version. This milestone closes exactly that, plus the one thing M3 shipped
without demonstrating.

| Deliverable | Notes |
|---|---|
| **★ A real Keychain round trip** | The M3 gap above. **Do this first** — see below |
| **ADR-0036 — packaging and supervision** | Bundle layout, where shipped policy defaults travel, the launchd boundary. **Drafted, pending acceptance.** No packaging code lands before it is accepted. |
| **Chapter 34 amendment** | The field-encryption key on the recovery card and in the lost-machine procedure — see below |
| `apps/cli` packaged | A runnable `friday`, with `friday init` delivered intact |
| Startup failure names its own fix | `openContext` fails today with a message naming the missing directory but not the command that creates it |
| `infra/launchd` | `com.friday.core.plist` and its install path — a LaunchAgent, never a LaunchDaemon ([Chapter 33](33-deployment-strategy.md)) |
| `system.started` gets a production call site | The contract and the publisher both exist — `announceStart()` in `packages/kernel/src/event-bus.ts`, exported and tested. **Nothing calls it outside tests.** ([ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md) review trigger) |
| Release machinery | Changesets, `0.1.0`, `tools/scripts/release.ts`. `CHANGELOG.md` says versioning starts here. |
| `friday events emit` settled | The deferred ADR-0021 question above |

**Done when:** on a Mac that has never run FRIDAY, you install her, run `friday init`, log out, log
back in, and she is already running — and `friday verify` passes against a log she started herself.

**★ The Keychain round trip is the first task, not an assumption.** This milestone's done-when
depends on `friday init` working against a real Keychain, and
[M3 shipped that path unexercised](#-shipped-2026-08-10---done-when-not-demonstrated-end-to-end):
`createKeychainKeyProvisioner` has never run. ADR-0035 records that the `security` command's
`-w`-versus-positional argument handling *"is a real API constraint that had already caused stray
writes to a real login keychain once"*, so this is a known-sharp edge rather than a formality.

**It is called out because it is the most likely thing to break the 2–3 week estimate**, and because
it is invisible: every test is green, and green tests are exactly what would keep being green if
this path were wrong. Prove the round trip on a real machine before any packaging work depends on
it. Whether that proof is an opt-in test against a throwaway keychain, a manual run recorded in a
runbook, or something else is the implementation's to decide — this chapter requires only that it
happen first and be written down.

**`friday init` is not redesigned here.** It remains the provisioning primitive. Packaging delivers
it; packaging does not absorb it. ADR-0035's review trigger asks whether *"a real installer subsumes
`friday init` entirely"* — ADR-0036 answers that question explicitly and defers the subsumption,
because init's creation-only bound is the whole of its safety argument and an installer that
provisions is an installer that can overwrite.

**The Chapter 34 amendment is pulled into this milestone deliberately.** ADR-0035 surfaced it and
correctly refused to solve it: [Chapter 34](34-disaster-recovery.md)'s recovery card lists the backup
encryption key, the B2 credentials, and the passkey recovery codes, and **does not list the
field-encryption key** — so a by-the-book recovery today yields a database whose private payloads
cannot be read. That is a live data-loss hazard, it costs a documentation change to fix, and it gets
worse the moment packaging puts FRIDAY on a machine that accumulates real encrypted data. Generating
the card, and the setup flow around it, stays at M7.

**Explicitly not in M4:** the Tauri shell, the dashboard's remaining layers, notifications, any
connector, Apple Developer enrollment, notarization, and code signing of a `.app`. Signing matters
when there is an app bundle to sign, and there is not one until M6. The CLI and the launchd agent do
not need it.

---

## M5 — Mind · 6–8 weeks

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

**Owed from M2:** [ADR-0029](../adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)'s
review trigger — reassess whether the router shape built for the dashboard survived contact with the
Chief of Staff, and record the answer.

---

## M6 — Face · 6–8 weeks · ★ the milestone that matters

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

**This is the point where the foundation-first decision pays off or does not.**

**Owed from earlier milestones:**

- [ADR-0021](../adr/0021-the-cli-reads-the-event-log-in-process-until-m3.md) — move `status`,
  `events tail`, and `verify` onto the API, keeping the in-process path as the documented fallback.
  Deferred from M3; the dashboard is the second consumer that justifies the seam.
- [ADR-0030](../adr/0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md) — the
  Tauri shell can do Touch ID, so the browser restriction on high-risk approvals should be
  re-examined rather than inherited. *"This is the trigger that matters."*

---

## M7 — Memory & Endurance · 6–8 weeks

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

**The recovery card's *contents* were corrected at M4**, not here — the field-encryption key was
missing from [Chapter 34](34-disaster-recovery.md) and that was a live hazard. What remains at this
milestone is *generating* the card, the setup step that refuses to complete until it is printed, and
the annual verification reminder.

---

## M8 — Self-Improvement · 6–10 weeks

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

## M9 — Reach · 8–12 weeks

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

## M10 — Breadth · ongoing, 2028+

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
| M0–M4 | **$0** | No AI calls yet. M4 needs no Apple Developer account — nothing is signed until M6. |
| M5 | $10–30 | Development and eval usage begins |
| M6 | $20–50 | + Apple Developer ($8/mo amortized) |
| M7 | $25–60 | + backups ($1–3) |
| M8 | $35–80 | FRIDAY's own model usage |
| M9–M10 | $40–90 | Steady state |

Comfortably inside your $50–200 band throughout, with the hard ceiling at $150 as a safety limit
rather than a target ([Chapter 35](35-performance-goals.md)).

Plus one-time: Apple Developer $99/yr from M6, and optionally a Mac Mini at M7 ($400–600).

---

## What is deliberately not on this roadmap

| Not planned | Why |
|---|---|
| Multi-user support | Data model supports it; the feature waits until someone needs it |
| Windows / Android | Build when there is a reason, not speculatively |
| Third-party plugins | M10+, and only with a stable API |
| Financial transactions | **Never, by design.** Requires a deliberate ADR and security review to reconsider. |
| A public API | Until there is a consumer |
| Cloud-hosted FRIDAY | Conflicts with Article IV |
| Training custom models | Not the problem FRIDAY solves |

---

## How the roadmap changes

It will. Rules for changing it:

1. **Milestones may be re-scoped; they may not be skipped.** M2's Guardian cannot be deferred past
   the agent work, because agents must be constrained by it. Order encodes dependency.
2. **Slippage is expected and not a failure.** 30–50% is normal. Record actual durations to
   calibrate future estimates.
3. **New work is added to the last milestone** unless it blocks an earlier one.
4. **A milestone ending in nothing demonstrable is re-scoped**, not extended. (Risk R1.)
5. **Reviewed at every milestone boundary**, with actual versus estimated recorded.
6. **A milestone that was built but never planned is written into this chapter before the next one
   starts.** M3 was delivered without appearing here, which meant that for four days the roadmap
   described work nobody was doing and omitted work that was shipping. Added 2026-08-10, from
   experience.
7. **Renumbering is allowed here and never in `docs/adr/`.** When a milestone is inserted, the map
   in [Re-baselined 2026-08-10](#re-baselined-2026-08-10) is extended rather than the ADRs being
   edited.

---

## The honest summary

**FRIDAY records, she can be told no, her decisions are written down, and a machine can be prepared
for her.** She does not yet run on one, think, or connect to anything.

The foundation-first decision is what makes the remaining list long, and it is also what made the
first four milestones land in five days: every one of them was implementing a design the Bible had
already settled. That trade is now evidenced rather than argued.

The single greatest risk was named as the months between M0 and *first useful day* where the work is
real and the output is invisible. **That risk has changed shape rather than passed.** The dashboard
exists and the event log is watchable, so there is something to look at — but the gap between "she
records what a test told her to record" and "she does something you wanted" is still the whole of
M5 and M6. Every design decision here that looks slightly inefficient — the dashboard pulled forward,
the demonstrable outcome required at every milestone, M4 being small enough to finish — exists to
manage that. They are worth protecting when they seem like overhead.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
| 2.0 | 2026-08-10 | Re-baselined after M3. M1 and M2 completion recorded; M3 recorded as **Authority**, a milestone that was built without being planned; **M4 becomes Installable**; *Mind* and *Face* move to M5 and M6 and everything after shifts by two. ADR-0021's deferrals and the `approval.auto_granted` residual recorded rather than carried silently. |
