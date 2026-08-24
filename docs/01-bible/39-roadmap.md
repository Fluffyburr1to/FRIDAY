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
DELIVERED ─ 2026-08-06 → 2026-08-24
  M0 ───── M1 ──────── M2 ────────── M3 ──────────── M4 ───────────── M5
  Ground   Heartbeat   Conscience    Authority       Installable      Mind
           she records she can be    her rules load, ★ she runs       ★ she plans,
                       told no       decisions are     on your Mac      asks, and
                                     written down      · v0.1.0         explains

PLANNED
  M6 ──── M7 ────────── M8 ────────── M9 ───── M10
  Face    Memory &      Self-         Reach    Breadth
  ★ first Endurance     Improvement
    useful day
```

| # | Name | What exists at the end | Estimate | Status |
|---|---|---|---|---|
| **M0** | **Ground** | Tooling, repo, CI, first ADRs | 2–3 wks | ✅ 2026-08-06 |
| **M1** | **Heartbeat** | Event bus, database, config, logging | 4–6 wks | ✅ 2026-08-07 |
| **M2** | **Conscience** | Guardian, approvals, audit, thin dashboard | 4–5 wks | ✅ 2026-08-08 |
| **M3** | **Authority** | Rules loaded from disk, decisions recorded, `friday init` | — | ✅ 2026-08-10 ⚠ |
| **M4** | **Installable** | Packaging, launchd supervision, release machinery | 2–3 wks | ✅ 2026-08-17 · `v0.1.0` |
| **M5** | **Mind** | Agents, Model Router, Chief of Staff, plans | 6–8 wks | ✅ 2026-08-24 |
| **M6** | **Face** | Dashboard, Mac app, first connector — **first useful day** | 6–8 wks | |
| **M7** | **Memory & Endurance** | Four-layer memory, always-on host, DR | 6–8 wks | |
| **M8** | **Self-Improvement** | Engineering dept; FRIDAY's first PR | 6–10 wks | |
| **M9** | **Reach** | iPhone, notifications, voice | 8–12 wks | |
| **M10** | **Breadth** | Additional departments | Ongoing | |

M3 carries no estimate because it was never estimated — it was not on the roadmap. **⚠ marks a
milestone whose code and tests shipped but whose done-when was never demonstrated end to end**; M3's
gap was the real Keychain, and M4 closed it first, before any packaging work was allowed to depend
on it.

**M4, actual versus estimated** — rule 5, recorded at the boundary. Estimated 2–3 weeks; elapsed
seven days, 2026-08-10 to 2026-08-17, across eleven pull requests
[#25](https://github.com/Fluffyburr1to/FRIDAY/pull/25)–[#35](https://github.com/Fluffyburr1to/FRIDAY/pull/35)
and five accepted ADRs (0036, 0037, 0038, 0043, 0044). Seven days against a 2–3 week estimate is
still under, but **it is the first milestone whose elapsed time is the same order of magnitude as
its estimate** rather than two below it, and the reason is worth carrying forward: M4's work was
mostly *not* transcription from a settled Bible.
Packaging, launchd, and the release process were specified in a sentence each, and the time went
into deciding — three ADRs were written to answer questions the Bible had not, and one of them
(ADR-0036) had to be corrected after its build command was found not to work. **M1's lesson holds
in the negative:** where the Bible is specific, implementation compresses; where it is not, the
original estimates are about right. M5 is described in less operational detail than M1 was, which
is the note the estimate below should be read against.

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

> **Closed at M4 on 2026-08-10 — and this record is left standing.** The round trip was run and the
> gap above is now shut; the evidence is in
> [M4's Keychain gate](#-the-keychain-round-trip--closed-2026-08-10). **M3's record is deliberately
> not rewritten.** What shipped at M3 shipped undemonstrated, and editing this section to read as
> though it had been proven at the time would destroy the one thing it was written to preserve — the
> difference between code that exists and behaviour that was watched. The gap was real, it was named
> here before it was closed, and the closing belongs to the milestone that did the work.

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
[ADR-0021](../adr/0021-the-cli-reads-the-event-log-in-process-until-m3.md) left two obligations due
at this milestone and neither was done. **Only the first is a review trigger**; the second is a
commitment recorded in that ADR's **Notes**. This table described both as review triggers until it
was corrected on 2026-08-14.

| Obligation | Status | Reconsidered at |
|---|---|---|
| **Review trigger** — *"`apps/core` ships — move `status`, `events tail`, and `verify` onto the API and keep the read-only path as the documented fallback."* | **Deferred.** `apps/core` actually shipped at M2, not M3, so this has been due since then. | **M6 (Face)** |
| **Notes** — *"It should be re-examined at M3: once a real service is publishing events, a CLI that can write directly to the log is a way to record something FRIDAY did not do."* | **Settled at M4** by [ADR-0043](../adr/0043-friday-events-emit-records-the-owner-not-the-kernel.md) — restricted, not gated or removed. The command cannot append arbitrary events; the defect was that it recorded the owner's action as the kernel's, and it now records the owner. | **Closed** |

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
| **★ A real Keychain round trip** | The M3 gap above. **✅ Demonstrated 2026-08-10** — see below |
| **ADR-0036 — packaging and supervision** | Bundle layout, where shipped policy defaults travel, the launchd boundary. **✅ Accepted 2026-08-10**, after its build mechanism was corrected — see below. Packaging code is unblocked. |
| **Chapter 34 amendment** | **✅ Applied.** The field-encryption key is on the recovery card, and the lost-machine procedure restores both keys before `friday restore` — see [Chapter 34](34-disaster-recovery.md). Drafted 2026-08-14, merged 2026-08-17 in [#35](https://github.com/Fluffyburr1to/FRIDAY/pull/35) — see [the close-out](#-m4-is-closed--2026-08-17) |
| `apps/cli` packaged | **✅ Demonstrated 2026-08-17.** A runnable `friday` ran from the extracted artifact, and `friday init` was delivered intact and provisioned the machine — see below |
| Startup failure names its own fix | **✅ Done 2026-08-17.** Both cases now name theirs. An absent Keychain key says *"Run `friday init`"*, a locked one names the timing rather than the key, and a missing or empty rules directory names the command that creates it rather than pointing at a repository path — [#33](https://github.com/Fluffyburr1to/FRIDAY/pull/33) |
| `infra/launchd` | **✅ Demonstrated 2026-08-17.** `com.friday.core.plist` generated by `friday service install` with absolute paths into the artifact, `RunAtLoad` true, and a LaunchAgent rather than a LaunchDaemon ([Chapter 33](33-deployment-strategy.md)) |
| `system.started` gets a production call site | **✅ Settled by [ADR-0044](../adr/0044-apps-core-records-that-friday-started-before-she-checks-herself.md)** — `apps/core` announces it before the startup self-check, so a fresh log now opens with it. ADR-0035's initialization-record question rides on separately and **stays open** |
| Release machinery | **✅ Done 2026-08-17.** `tools/scripts/release.ts` builds and verifies the artifact; **Changesets is adopted** per [ADR-0036 §6](../adr/0036-packaging-delivers-friday-init-provisions.md), `packaging/bundle` is at `0.1.0` with every other manifest deliberately held at `0.0.0`, `CHANGELOG.md` opens with the 0.1.0 entry, and the release is tagged — [#33](https://github.com/Fluffyburr1to/FRIDAY/pull/33) |
| `friday events emit` settled | **✅ Settled by [ADR-0043](../adr/0043-friday-events-emit-records-the-owner-not-the-kernel.md)** — restricted, not gated or removed. The ADR-0021 question above |

**Done when:** on a Mac that has never run FRIDAY, you install her, run `friday init`, log out, log
back in, and she is already running — and `friday verify` passes against a log she started herself.

**✅ Demonstrated on the owner's Mac, 2026-08-17**, and every clause was watched working — see
[The done-when, demonstrated](#-the-done-when-demonstrated--2026-08-17). Every deliverable above is
closed, and **[the milestone is closed](#-m4-is-closed--2026-08-17)** at `v0.1.0`.

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

### ★ The Keychain round trip — closed 2026-08-10

**It was done first, and it passed.** The production path was run end to end against a real macOS
Keychain, before any packaging work was allowed to depend on it. The procedure, including the
isolation that made it safe to run at all, is
[`docs/runbooks/keychain-round-trip.md`](../runbooks/keychain-round-trip.md).

What was demonstrated, each item observed rather than inferred:

| | |
|---|---|
| **Real provisioning through the production path** | `friday init` → `createKeychainKeyProvisioner` → `/usr/bin/security`. Both keys created, each decoding to exactly the 32 bytes `decodeKey` requires. |
| **Idempotent second run** | Rules left alone, both keys reported already present, nothing changed. |
| **Persistence across a lock/unlock boundary** | The keys survived. A locked keychain refuses reads non-interactively; unlocking restores them, in a fresh process. |
| **`apps/core` startup and Guardian composition** | Started on the provisioned state, composed a Guardian from the rules on disk, and passed its startup self-check. |
| **Encrypted payload round trip** | The self-check's `guardian.decided` is stored as `enc:v1:…` ciphertext, and `friday events tail` read it back. The field key was genuinely exercised, not bypassed. |
| **ADR-0035's ★ refusal** | With a database present and the field key removed, init refused, exited non-zero, explained why, and **minted nothing**. |
| **The login keychain was untouched** | Audited before and after: default keychain unchanged, and no `com.friday.*` item present at any point. |

**The claim this does and does not support.** It establishes that the path works on this Mac. It
does **not** establish CI portability, and nothing here should be read as promising it — see the
open question below. The failure surface is also still unobserved: a locked keychain at login, a
wrong Node, an interrupted provision.

**A note for whoever writes the test.** ADR-0035 §3 concluded that a real Keychain write "may not be
exercisable in a non-interactive environment or in CI at all", and left the `execFileSync` boundary
uncovered on that basis. **That conclusion is now known to be too pessimistic**, and the reason is
narrow: ADR-0035 redirected `HOME` and stopped, which leaves *no default keychain*, so the write
tries to prompt and dies. Creating a throwaway keychain inside the redirected `HOME` and making it
the default fixes it — and, because the keychain is then never named on the command line, it also
sidesteps the `-w`-versus-trailing-positional conflict that ADR-0035 records as having caused stray
writes to a real login keychain once.

**This does not amend ADR-0035, deliberately.** The evidence is recorded here; whether it becomes an
enduring automated test contract is a separate decision, because a manual proof and a permanent CI
requirement are different promises and the second one has not been earned yet — CI portability is
untested. **Open, and owned by whoever takes the launchd work.**

**`friday init` is not redesigned here.** It remains the provisioning primitive. Packaging delivers
it; packaging does not absorb it. ADR-0035's review trigger asks whether *"a real installer subsumes
`friday init` entirely"* — ADR-0036 answers that question explicitly and defers the subsumption,
because init's creation-only bound is the whole of its safety argument and an installer that
provisions is an installer that can overwrite.

**The Chapter 34 amendment was pulled into this milestone deliberately.** ADR-0035 surfaced it and
correctly refused to solve it: [Chapter 34](34-disaster-recovery.md)'s recovery card listed the
backup encryption key, the B2 credentials, and the passkey recovery codes, and **did not list the
field-encryption key** — so a by-the-book recovery yielded a database whose private payloads could
not be read. That was a live data-loss hazard, it cost a documentation change to fix, and it would
have got worse the moment packaging put FRIDAY on a machine that accumulates real encrypted data.
**Applied in [#35](https://github.com/Fluffyburr1to/FRIDAY/pull/35)**, which also ordered the
lost-machine procedure so that both keys are restored before provisioning runs — creation-only
provisioning would otherwise mint a fresh field key on a bare machine and leave the backup
unreadable. Generating the card, and the setup flow around it, stays at M7.

### The packaging mechanism was corrected before ADR-0036 was accepted

The build command the ADR originally named — `pnpm deploy --filter @friday/cli --prod` — **does not
work on this repository**, and was found by running it rather than by trusting it. The accepted
mechanism is in [ADR-0036 §1](../adr/0036-packaging-delivers-friday-init-provisions.md); two things
about it matter to whoever implements packaging:

- The workspace-injection flag is passed **for the duration of the deploy command only**, never
  written into `pnpm-workspace.yaml`. Putting it there would change how every developer's build
  links its packages, permanently, for a property only the release script needs.
- **`--legacy` is prohibited.** It is the option the error message steers you toward, it exits 0,
  and it produces a bundle whose FRIDAY packages are symlinks escaping into the source checkout,
  with no `better-sqlite3` and no shipped rules. It works on the machine that built it and nowhere
  else — the exact failure ADR-0033 exists to prevent, wearing a green tick.

The corrected bundle was tarred, extracted elsewhere, and run from there: it carried and resolved
its own policies, provisioned keys, and appended an event. `better-sqlite3` ships a `darwin-arm64`
prebuild, so nothing compiles at install time.

### Carried M4 implementation risks

Found during the M4 gates, recorded rather than fixed opportunistically. **None is a blocker; each
is to be investigated when the implementation reaches it**, and none should be used as an excuse to
widen a slice.

| Risk | Why it matters at M4 | When to look at it |
|---|---|---|
| **`apps/core` exit-code mismatch.** It defines `EXIT_PROBLEM = 2`, commented as matching the CLI — but the CLI defines `problem: 1` and `usage: 2`. Core reports a fault using the code the CLI reserves for *being invoked wrongly*. | launchd reads exit codes, and any `KeepAlive` policy or diagnostic keyed on them will read this one. A fault that looks like a usage error is a fault that gets retried wrongly, or not at all. | With the launchd work, which is the first thing that consumes the code. |
| **LaunchAgent startup against a locked login keychain.** A locked keychain refuses reads non-interactively — observed, exit 128. The login keychain unlocks at login, but a LaunchAgent's start and that unlock are not obviously ordered. | If the agent wins the race, `apps/core` fails at `createCapabilityIssuer` on a fresh login, and the message names a key rather than a timing problem. | With `friday service install`. Design the failure to be nameable before it is observed in the wild. |
| **One unexplained Keychain anomaly.** A single spurious "the passphrase you entered is not correct" on unlocking the throwaway keychain, which did not reproduce across a clean four-step cycle afterwards. | Unreproduced, and against a temporary keychain rather than the login one, so it is recorded for honesty rather than as a known defect. | If it recurs. If it recurs during the launchd work, it stops being an anomaly and becomes the second risk above. |

**Both of the first two risks were closed in passing**, and each is worth naming because it was
predicted here before it was fixed. `apps/core`'s exit code is now `1`, the code the CLI reserves
for a fault it found. And the locked-Keychain failure now *"names the timing rather than the key"* —
the wording this chapter used when it recorded the risk. The third never recurred.

### ★ The done-when, demonstrated — 2026-08-17

**It was run on the owner's Mac, end to end, and every clause was observed rather than inferred.**
The artifact was built by `tools/scripts/release.ts` from committed `df2a40b`
(SHA-256 `b5bb677153b6a3795ce018099173c3a00745614f3ab7ea5599c1d15b62cde7dd`), extracted to a fresh
directory, and nothing outside it was used.

| Clause | What was observed |
|---|---|
| **A Mac that has never run FRIDAY** | No data directory, no log directory, no `com.friday.credentials` item, no LaunchAgent, no process. Checked before anything was run |
| **You install her** | The artifact extracted; only its own `friday` binary used thereafter |
| **Run `friday init`** | Exit 0. Three rules seeded, both keys created, and **no database** — provisioning stayed creation-only exactly as [ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md) §5 describes |
| **Log out, log back in** | Performed by the owner |
| **She is already running** | A **new process id** after login. The pre-login process had died and launchd had started a fresh one from `RunAtLoad` |
| **`friday verify` passes** | `The record is intact. 4 events checked, 1 to 4.` Exit 0 |
| **Against a log she started herself** | Event 1 is `system.started`, actor `system:kernel`, sensitivity `internal`, payload `{version, nodeVersion, pid}` |

### Why the log holds four events and not two

The obvious expectation was one start: two events, `system.started` then `guardian.decided`. **What
happened was two starts, and the record is left saying so.**

```
1  system.started    system:kernel            ← installing the agent loaded it
2  guardian.decided  schedule:integrity-check
3  system.started    system:kernel            ← the login boundary
4  guardian.decided  schedule:integrity-check
```

`friday service install` does not merely write the plist; it loads the agent, and `RunAtLoad` fires
on load rather than waiting for a login. So she started once at install and again at login.

**This strengthens the evidence rather than weakening it**, and that is why the extra pair is
recorded rather than tidied away. Event 3's payload carries the process id of the copy that was
running after the owner logged back in, and event 1 carries the earlier one. **The log itself
distinguishes the login start from the install start**, which is the exact claim the done-when
makes and which a single-start run could not have separated from a process that merely never
stopped.

It also confirms [ADR-0044](../adr/0044-apps-core-records-that-friday-started-before-she-checks-herself.md)
in production: `system.started` precedes `guardian.decided` in both pairs. Until this milestone the
first thing in a fresh log was FRIDAY asking permission to verify a log that was empty.

### ★ M4 is closed — 2026-08-17

**The done-when was demonstrated and every deliverable is now merged.** Those were separate promises
and this chapter kept them apart deliberately; on the day of the demonstration two rows were still
open, and both have since been closed rather than waived.

| Closed after the demonstration | How |
|---|---|
| **The policy-directory startup message** | A missing or empty rules directory now names `friday init` rather than pointing at `packages/guardian/policies/`, a repository path that does not exist on an installed machine ([#33](https://github.com/Fluffyburr1to/FRIDAY/pull/33)) |
| **Release machinery** | Changesets adopted, `packaging/bundle` at `0.1.0`, `CHANGELOG.md` opening with the 0.1.0 entry, and the release tagged ([#33](https://github.com/Fluffyburr1to/FRIDAY/pull/33)) |
| **The Chapter 34 amendment** | Merged at [#35](https://github.com/Fluffyburr1to/FRIDAY/pull/35). It had been drafted on 2026-08-14 and left uncommitted, and was found during this close-out — see the note below |

**The release.** `v0.1.0`, an SSH-signed tag on `main` at
[`af81b56`](https://github.com/Fluffyburr1to/FRIDAY/commit/af81b566d3cac979e997b6127a8bdcf3a47e5deb).
**The tag is immutable and must never be moved** ([Chapter 32](32-branch-strategy.md)) — including
by this close-out, which is documentation and changes nothing that shipped.

**★ The record was written late, and that is the finding worth keeping.** Between 2026-08-14 and
2026-08-17 this chapter's M4 sections, and the Chapter 34 amendment, existed only in an uncommitted
working tree. `main` said M4 was *next* while the milestone was being demonstrated and released, so
for three days **the roadmap described work nobody was doing and omitted work that was shipping** —
the exact failure rule 6 was added to prevent, recurring in a new form. Rule 6 catches work built
without being planned; it did not catch work *finished* without being recorded, because writing the
record and merging it are different acts and only the first had a rule. Rule 8 below is added from
this experience.

### What the demonstration did not establish

- **Nothing about retention.** `system.started` is not a protected type and nothing prunes the log.
  A supervised restart loop appends one of these per attempt, which this run did not provoke and did
  not disprove.
- **Nothing about the failure surface at login.** The locked-keychain race in the risk table above
  was designed for, not observed. It names the timing correctly when it happens; nobody has made it
  happen.
- **Nothing about update.** The goal line says *"and can be updated"*. A first install was
  demonstrated; **installing 0.1.1 over 0.1.0 was not**, and no upgrade path has been exercised.
  Carried into the next milestone that ships a second version.

### Built during M4, unmerged, and not an M4 deliverable

Recorded under rule 6 so it is not rediscovered as a surprise. A **HUD vitals slice** — a
FRIDAY-scoped CPU, memory, disk, and uptime reader in `packages/diagnostics`, served by `apps/core`
as `vitals.current` and rendered by `apps/web` — was built during M4 by owner decision of
2026-08-12, along with four proposed ADRs numbered 0039–0042 and a `friday service` reworking.

**None of it is merged.** It exists as uncommitted work on a local branch, so it is not in this
repository, and nothing in it closes an M4 exit criterion. It is written here as an open item rather
than as a delivery, and the ADRs are not linked because the files do not exist on `main`. **It is
neither a milestone nor a slice of one until it lands**; whichever milestone merges it records it
then.

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
| `model-router` | A fake provider and local Ollama first; **Anthropic and OpenAI are held** — see scope below |
| `agent-runtime` | Worker-thread isolation, manifests, mediated tools, budgets |
| `chief-of-staff` | Intent parsing, plan generation, DAG execution, suspension/resume |
| `departments/operations` | **The first department** — `run-self-check` and `compact-event-log` |
| `diagnostics` | Health checks and self-checks. **Improvement proposals move to M8** — see below |
| `tools/evals` | Agent evaluation harness with the first scenario suites |
| **The plan record** | Completed to [Chapter 12](12-chief-of-staff.md) before the engine is built ([ADR-0045](../adr/0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md)) |

**Done when:** you type a request into the CLI, FRIDAY produces a visible plan, executes it through
agents, requests approval where required, and explains what she did with every claim traceable to an
event.

**This is the milestone where FRIDAY becomes recognizably herself.** It is also the largest and most
likely to slip.

### The scope, settled 2026-08-17

M5 is the largest milestone on this roadmap and the one Chapter 39 has twice warned is most likely to
slip, so its edges were decided before implementation rather than during it.

**Two capabilities, in one department, and no more.** `departments/operations` gets `run-self-check`
(risk `low`, runs without asking) and `compact-event-log` (risk `medium`+, **must ask**). That pair is
the smallest thing that proves every clause of the done-when: one capability that runs, and one that
stops and waits for you. Compaction was chosen for the second because rewriting the event log is
genuinely consequential — **an approval you would actually think about, rather than a contrived one
that teaches you to click yes.**

**`vault` is not an M5 deliverable**, and the correction is recorded because the mistake was nearly
made. [ADR-0040](../adr/0040-a-capability-is-a-department-inside-the-guardian-boundary.md)'s draft
listed it as the natural first capability. It depends on the memory interface and
[ADR-0039](../adr/0039-obsidian-is-a-projection-of-memory-never-a-source-of-it.md)'s projector, and
**the memory system is M7** — so building it here would have pulled two milestones forward to serve
one capability. ADR-0040 §5 was revised before acceptance; ADR-0039 was bounded to M7 in its own §0.

**No provider spending.** The model router is built against a fake provider and, where available,
local Ollama. **Anthropic and OpenAI adapters are deliberately last and are blocked on a separate
decision**, so M5 can be built to completion at zero cost. Ollama is optional: with no local provider
present, a `private` request **fails closed and is refused**, never downgraded to a cloud provider.
That is [ADR-0008](../adr/0008-model-router.md)'s rule, and the absence of a local model is the case
that tests it.

**Diagnostics delivers health and self-check only.** *Improvement proposals* — Chapter 23's third
function — **move to M8**, where the Engineering department and the proposal-to-pull-request pipeline
already live. A diagnostics finding with nothing to do about it is a notification, and
[Chapter 23](23-diagnostics-system.md) is explicit that the hard problem is reporting almost nothing.

**Deliberately not in M5:** the memory interface and the vault projector (M7), `inbox`, `metrics`,
and `trends` (M6+, all need `connector-sdk`), the improvement-proposal pipeline (M8), and the
remaining HUD panels.

### M5, actual versus estimated

Rule 5, recorded at the boundary. Estimated 6–8 weeks; **elapsed seven days**, 2026-08-17 to
2026-08-24, across thirty-one pull requests and five accepted ADRs. That is the same elapsed time as
M4 for a milestone estimated three times larger, and the reason is the one M1 and M4 already
established from opposite directions: **where the Bible is specific, implementation compresses.**
Chapters 11, 12, and 13 specify the agent runtime, the plan engine, and departments in operational
detail, so most of this milestone was transcription — and where it was not, the time went into the
same place M4's did. The plan record needed an ADR before the engine could be built (0045), the
Temporal question needed answering before durable execution was hand-built (0046), and one product
decision had to go to the owner because the Bible contradicted itself about the approval threshold.

**★ The estimate was wrong in a way worth keeping.** This chapter twice warned M5 was *"the largest
milestone and the one most likely to slip"*. It did not slip, and the warning was not therefore
wrong — what it mispredicted was **which** work is expensive. Size in deliverables is not the
predictor; **unspecified decisions are.** M5 had many deliverables and few open questions.

### Carried M5 implementation risks

Found while building the agent runtime, recorded rather than fixed opportunistically — the same
discipline M4 used. **One of these is a blocker with a named trigger; the other two are limits.**

| Risk | Why it matters | When to look at it |
|---|---|---|
| **★ A runaway worker thread is not killed.** The budget ends the *invocation*; `dispose()` ends the *thread*. A worker that spins forever keeps spinning until something disposes it. | Survivable only while every invocation has a caller standing over it. **The Chief of Staff is the thing that removes that property.** | **Before anything can schedule an agent unattended.** This is a blocker on that capability, not a nice-to-have: the budget must be able to *end* the work, not merely stop waiting for it. |
| **Worker isolation is not a security sandbox.** The deny-list closes the doors an agent reaches for by accident or under injection. V8 escapes, `process.binding`, native addons, and prototype-chain tricks are **outside the current threat model** and are not blocked. | The threat scoped by [Chapter 11](11-agent-framework.md) is bugs and prompt injection in first-party and AI-written agents, and that is what this defends. It is not defence against a hostile author. | **When third-party plugin code becomes real** — [Chapter 15](15-plugin-system.md) already sends that case to process isolation. The list must never be read as a completeness claim. |
| **`resourceLimits` is set and unproven.** Every worker gets a memory ceiling; no fixture has allocated until it fired. | What happens when a thread hits it, and whether it is reported usefully, is unobserved. | When a fixture is written to demonstrate it. Recorded as unproven rather than described as working. |

**Owed from M2:** [ADR-0029](../adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)'s
review trigger — reassess whether the router shape built for the dashboard survived contact with the
Chief of Staff, and record the answer. **Answered when there is enough Chief of Staff to answer it
honestly**, not before; the owner set that condition on 2026-08-17, and a reassessment written
against an unbuilt component would be a guess wearing a review trigger's clothes.

**Owed here too:** [ADR-0011](../adr/0011-plan-engine-state-machine.md)'s *"reconsider Temporal"*
trigger. Chapter 12 calls a workflow engine **"the strongest alternative in the Bible"**, and M5 is
where FRIDAY starts hand-building the durable execution it would have provided.

### ★ The done-when, demonstrated — 2026-08-24

The done-when had five clauses and they are checked one at a time, because a demonstration that
satisfies four of them is not a milestone.

```
$ friday ask "check my records"

FRIDAY's plan — One step: "Check that FRIDAY is internally consistent and her
record is intact." is the only thing FRIDAY has that matches what you asked for.
  1. Check that FRIDAY is internally consistent and her record is intact.

The plan finished.
  FRIDAY worked out how to do this, in 1 step.
  FRIDAY started: Check that FRIDAY is internally consistent and her record is intact.
  An agent may check FRIDAY's own health and verify her records, the same as a
  scheduled job may. Nothing outside FRIDAY is touched.
  Done: Check that FRIDAY is internally consistent and her record is intact.
  The plan finished.
```

**Transcribed from a real run, wrapped for the page and not otherwise edited** — including the
headline appearing twice, which is a presentation defect and is left visible rather than tidied out
of the record. The third line is the **Guardian's own sentence**, composed at decision time from the
rule the owner wrote; the explanation quotes it rather than describing the decision a second time.

| Clause | Where it is demonstrated |
|---|---|
| *you type a request into the CLI* | `friday ask`, through the real entry point ([#71](https://github.com/Fluffyburr1to/FRIDAY/pull/71)) |
| *FRIDAY produces a visible plan* | Printed before anything runs, **unconditionally** — not only when she judges it worth showing |
| *executes it through agents* | The Chief of Staff kernel, the executor's Guardian gate, and `departments/operations` |
| *requests approval where required* | `operations.log.compact` stops twice: the plan's shape, then the step ([#67](https://github.com/Fluffyburr1to/FRIDAY/pull/67), [#68](https://github.com/Fluffyburr1to/FRIDAY/pull/68)) |
| *explains what she did, every claim traceable to an event* | `composeExplanation` over the plan's own correlation id, with `unsupportedClaims` run rather than assumed |

The run above is `tests/e2e/friday-ask.test.ts`, which uses the shipped department manifest on disk,
the shipped rules in `packages/guardian/policies/`, the real clerk, the real bus, and real SQLite.
**The only injected thing is the key provider**, which is [ADR-0020](../adr/0020-key-material-comes-from-an-injected-key-provider.md)'s
seam and the only way to run this without the machine's Keychain.

### ★ M5 is closed — 2026-08-24

**Thirty-one pull requests, [#41](https://github.com/Fluffyburr1to/FRIDAY/pull/41)–[#71](https://github.com/Fluffyburr1to/FRIDAY/pull/71),
and four accepted ADRs (0039, 0040, 0041, 0045, 0046).** Every deliverable row in the table above is
merged on `main`.

**What was actually being defended.** The done-when can be satisfied by a happy path, and the value
of this milestone is that it is not. Four properties are structural rather than procedural — they
hold because there is no way to write the alternative, not because every path remembers to check:

| Property | Why it holds |
|---|---|
| **A step cannot execute without a current Guardian decision** | `runStep` takes an `Authorised`, whose private `Symbol` cannot be forged or spread. `authorise()` is the only source of one, and it calls the Guardian every time — first attempt, retry, and resume alike |
| **Nothing that survives a restart can be mistaken for a prior approval** | `PlanProgress` has **no field** that could hold one. A resumed plan does not choose to re-ask; it has no alternative, and a test asserts the serialised shape contains no decision, authorisation, capability, or permit |
| **An event cannot describe a transition that did not happen** | A `PlanTransition` is built only where the state machine *accepted* a move, and an event only from a transition. A move that cannot be **recorded** leaves the plan where it was — [Chapter 10](10-event-bus.md)'s rule that writing the event is how the thing happens, taken literally |
| **A capability identifies the step without authorising it** | Minted before the Guardian is asked, naming the plan and the step, single-use. It is the evidence an agent must carry; the Guardian still decides and still says no |

**★ The discipline that found the real defects.** Every guard was written, then tested, then
**deliberately broken to confirm the test failed**. Twenty mutations were run across the three
closing changes and all were eventually caught — but **four tests proved nothing until the mutation
exposed them**, and those four are the reason the practice is recorded here rather than left as a
habit:

- A test that a suspended step is not counted as finished did not exist. That bypass is quiet and
  complete: the plan would skip work the owner was asked about and never approved, and report
  success.
- A test that every event carries where it came from checked only that the *field was present*. It
  passed while `stepFrom` was set to `stepTo` — a log whose moves do not join up.
- A test that another plan's events do not leak passed with the filter deleted, because the event
  type it used never appeared in either plan.
- A test that a plan breaking Chapter 12's bounds is refused was rejected by the response schema
  before the validator it claimed to test ever ran.

**★ A design defect that only the log exposed.** The first draft had step events carry the plan's
move *and* published a plan event for the same move. Both looked correct in isolation. A reader
chaining `from` to `to` counted that move twice and drifted from the real plan **on the first
suspension** — and the fix was not a smarter reader, it was that each level states its own moves
once. It was found only because the continuity test was rewritten to assert that every `from` *is*
the previous `to`.

### What the demonstration did not establish

- **Nothing about a real model.** The shipped planner is keyword matching over the manifests and
  says so in those words. It is replaced **by configuration, not by code** — a real model is a
  provider on the same router — but no model has been through this path, so nothing here evidences
  that plan generation survives one.
- **Nothing about cost.** `estimateCents` is honestly zero because the shipped provider is local and
  free. The plan-approval threshold has therefore only ever fired on **risk**, never on cost, and
  the cost limb of [Chapter 12](12-chief-of-staff.md)'s trigger is untested in production.
- **Nothing about a second concurrent plan.** Every run demonstrated was one plan at a time.
- **Nothing about the approval preview.** [Chapter 19](19-approval-system.md) wants the connector's
  dry run, and the departments shipping today produce no artifact. The owner approves **by name**,
  and the risk line says so. This becomes real with the first connector, in M6.

### Known remaining items, carried out of M5

Recorded rather than waived. None of these blocks the done-when; all three are things a reader
would otherwise rediscover as a surprise.

| Item | State | Why it is left |
|---|---|---|
| **DAG concurrency** | **Deferred.** Steps run one at a time; `dependsOn` semantics are intact and enforced, and a plan's graph is validated for cycles and depth | A performance limitation, not a correctness one. [Chapter 12](12-chief-of-staff.md)'s three-independent-lookups example runs three times slower than it needs to and produces the same result. Owner decision of 2026-08-23: not worth padding M5 for |
| **`friday init` does not create the departments directory** | **Open.** `paths.departmentsDir` defaults under the data directory and nothing populates it, so `friday ask` refuses by name until `FRIDAY_DEPARTMENTS_DIR` points somewhere that exists | The same gap `policiesDir` already has, and it is `init`'s to close rather than M5's. The refusal names the fix, which is the property that matters |
| **`operations.log.compact` is `NOT_IMPLEMENTED`** | **Open, and deliberately so.** She asks, you approve, and then she says plainly that she cannot do it yet | ★ **The approval path is fully real; only the work behind it is absent.** Reporting success for a compaction that did not happen would be the worst possible stub — the capability's whole subject is the trustworthiness of the record. Owner decision of 2026-08-24: keep it refusing |

`NOT_IMPLEMENTED` was added to the error taxonomy for this. *Declared but not built* is a different
fact from a refusal and from a malfunction, and a department manifest is a promise about what FRIDAY
can do.

### The two owed triggers, answered

**[ADR-0011](../adr/0011-plan-engine-state-machine.md)'s *"reconsider Temporal"*** — answered before
implementation by [ADR-0046](../adr/0046-durable-execution-stays-hand-built-at-m5.md), accepted
2026-08-17. Durable execution stays hand-built at M5, with an M6 compensation trigger recorded.

**[ADR-0029](../adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)'s router-shape
reassessment** — deferred at 2.2 until there was enough Chief of Staff to answer it honestly. There
now is, and the answer is two-sided:

- **The router shape survived.** `appRouter` is still translation-only over `CoreContext`, and the
  Chief of Staff did not need it changed. The plan engine deliberately does **not** go through a
  tRPC procedure: the session sits on `OpenedContext`, outside the procedure surface, because a
  procedure that could run a plan would be a procedure that decides when FRIDAY acts.
- **★ ADR-0029's second trigger fired, and is recorded rather than closed.** *"`apps/core` acquires
  anything that is not composition"* — it has. `scripted-planner.ts` is a calculation, and `ask.ts`
  holds a resource-naming rule and a cost estimate. Each is small and each has a reason, but the
  rule they cross was written precisely because that is how logic leaves `packages/` — one
  defensible exception at a time. **Carried into M6 as a question, not a defect.**

---

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
8. **A milestone is closed in this chapter on `main` before the next one starts, and the close-out
   is merged, not drafted.** M4's done-when was demonstrated and released while `main` still said
   the milestone was next, because its record sat uncommitted in a working tree for three days.
   Rule 6 covers work that was built without being planned; this covers work that was finished
   without being written down where anyone can read it. **A record that exists only locally does
   not exist.** Added 2026-08-17, from experience.

---

## The honest summary

**FRIDAY records, she can be told no, her decisions are written down, she runs on the owner's Mac
and starts when he logs in, and she can now be asked to do something — she plans it, shows the plan,
asks where it matters, does the work, and explains it afterwards from her own record.** She does not
yet connect to anything outside herself, and the thinking behind the plan is scripted rather than a
model.

The foundation-first decision is what makes the remaining list long, and it is also what made the
first four milestones land in five days: every one of them was implementing a design the Bible had
already settled. That trade is now evidenced rather than argued — **and M4 is the counter-example
that gives it a scale.** Where the Bible had specified a milestone completely, implementation took
a day; where it had specified packaging and release in a sentence each, the same assistant took a
week and wrote three ADRs to fill the gap. The compression is a property of the design being
settled, not of who is writing the code.

The single greatest risk was named as the months between M0 and *first useful day* where the work is
real and the output is invisible. **That risk has narrowed to one milestone.** The gap between "she
records what a test told her to record" and "she does something you wanted" was the whole of M5 and
M6; M5 closed the first half. She now does a thing you asked for, end to end — the thing is checking
her own records, which is useful to her rather than to you, and **everything that would make it
useful to you is a connector, which is M6.** Every design decision here that looks slightly inefficient — the dashboard pulled forward,
the demonstrable outcome required at every milestone, M4 being small enough to finish — exists to
manage that. They are worth protecting when they seem like overhead.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
| 2.0 | 2026-08-10 | Re-baselined after M3. M1 and M2 completion recorded; M3 recorded as **Authority**, a milestone that was built without being planned; **M4 becomes Installable**; *Mind* and *Face* move to M5 and M6 and everything after shifts by two. ADR-0021's deferrals and the `approval.auto_granted` residual recorded rather than carried silently. |
| 2.1 | 2026-08-17 | **M4 closed at `v0.1.0`** and its whole record brought onto `main` in one change. The done-when demonstrated on the owner's Mac, with its four-event result and why installing the agent produces a start of its own; every deliverable row resolved, including the two that were still open on the day of the demonstration and were closed afterwards. `friday events emit` (ADR-0043) and `system.started` (ADR-0044) marked settled, and ADR-0021's second obligation corrected — it is that ADR's **Notes**, not a review trigger. M4's actual-versus-estimated recorded under rule 5: seven days against 2–3 weeks, the first milestone whose elapsed time is the same order of magnitude as its estimate, and why. **Rule 8 added** after this chapter was found describing M4 as *next* for three days while the milestone was being released, its record uncommitted. The HUD vitals slice and ADRs 0039–0042 recorded as built-but-unmerged rather than as delivered. Dates inside each section are when the work was done and observed, not when this entry was written. |
| 2.2 | 2026-08-17 | **M5 scope settled before implementation**, and ADRs 0039, 0040, 0041, and 0045 accepted. Operations gets two capabilities — one that runs and one that must ask — and `vault` is corrected out of M5 into M7, because it depends on a memory system two milestones ahead. No provider spending in M5; `private` fails closed when no local model exists. Diagnostics ships health and self-check only, with improvement proposals moved to M8. ADR-0029's review trigger is deferred until there is enough Chief of Staff to answer it honestly, and ADR-0011's Temporal trigger is recorded as owed. |
| 2.3 | 2026-08-17 | M5's carried implementation risks recorded under rule 5, from the agent runtime: a runaway worker thread is not killed, worker isolation is not a security sandbox, and `resourceLimits` is unproven. The first is a **blocker on scheduling an agent unattended** rather than a note. |
| 2.4 | 2026-08-24 | **M5 closed**, with its whole record brought onto `main` in one change under rule 8. The done-when demonstrated clause by clause through `friday ask` against the shipped manifest, the shipped rules, the real clerk and real SQLite. The four properties the milestone was actually defending recorded as **structural rather than procedural**, and the mutation-testing discipline recorded with the four tests that proved nothing until a mutation exposed them — including one design defect that only a continuity check over the event log could have found. Three known items carried out and named: **DAG concurrency deferred**, **`friday init` does not create the departments directory**, and **`operations.log.compact` stays `NOT_IMPLEMENTED`** by owner decision, because faking success on the capability that rewrites the record is the worst possible stub. ADR-0011's Temporal trigger answered by ADR-0046; ADR-0029's router-shape reassessment answered — the shape survived, and its **second** trigger fired and is carried into M6 as a question. M5's actual-versus-estimated recorded: seven days against 6–8 weeks, and why size in deliverables does not predict cost — **unspecified decisions do.** |
