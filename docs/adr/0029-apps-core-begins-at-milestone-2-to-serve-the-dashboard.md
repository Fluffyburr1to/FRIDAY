# ADR-0029 — `apps/core` begins at Milestone 2 to serve the dashboard

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [ADR-0021](0021-the-cli-reads-the-event-log-in-process-until-m3.md),
  [apps/core/README.md](../../apps/core/README.md), [apps/web/README.md](../../apps/web/README.md),
  [Chapter 26 — Dashboard Architecture](../01-bible/26-dashboard-architecture.md),
  [Chapter 20 — API Standards](../01-bible/20-api-standards.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md)

---

## Context

[Chapter 39](../01-bible/39-roadmap.md) lists a **thin dashboard — live event stream, pending
approvals** as a Milestone 2 deliverable in `apps/web`, and states plainly why it is there rather
than at M4:

> *"The dashboard is pulled forward here deliberately. Strict dependency order would put it at M4.
> It is here because six months without anything to look at is the largest risk to this project
> (R1)."*

[`apps/web/README.md`](../../apps/web/README.md) rule 1 says **"The interface owns no truth.
Everything comes from core."** So the dashboard needs `apps/core`. And `apps/core` does not exist —
the directory holds a README and nothing else.

Three documents disagree about when it should:

| Source | Says |
|---|---|
| [`apps/core/README.md`](../../apps/core/README.md) | Milestone **M1** |
| [ADR-0021](0021-the-cli-reads-the-event-log-in-process-until-m3.md) | "arrives with the Chief of Staff at Milestone **3**" |
| [Chapter 39](../01-bible/39-roadmap.md) M1 and M2 tables | not listed at all |

That contradiction was harmless while nothing needed the service. The dashboard is the first thing
that does, so it has to be settled.

ADR-0021 is the document with standing here, because it already considered a version of this
question and answered no. Asked how the M1 CLI should read the log, it rejected *"build a minimal
socket server at M1 for the CLI to talk to"* on the grounds that it would be **"`apps/core` under
another name, built before the design that shapes it exists."** That reasoning was correct for the
CLI, and it turned on a fact that does not hold here: a CLI process can open `events.db` itself. A
browser cannot. There is no in-process path from a web page to SQLite, so the dashboard cannot reuse
ADR-0021's answer — it forces the service to exist or forces the milestone to move.

**What we do not know at the time of writing:** how much of `apps/core`'s eventual shape is
determined by the Chief of Staff, which arrives at M3. If plan orchestration turns out to impose
structure on the API that we cannot anticipate now, some of what is built here is rework. The bet is
that a read-only query surface over the event log is the part least likely to be affected, because
it reflects the shape of the log rather than the shape of the orchestrator.

## Decision

We will **create `apps/core` at Milestone 2, scoped to what the thin dashboard requires**: a
localhost tRPC server exposing read queries over the event log, and later the approval mutations
M2's completion criterion needs. It is composition only, as its README already requires, and it
grows into the M3 service rather than being replaced by it.

## Constitutional review

- **Article II (Transparency):** the reason the decision exists. The dashboard is where Article II
  is kept, and it cannot be kept without something for the browser to talk to.
- **Article IV (Privacy):** the server binds to loopback only. Nothing leaves the machine, and the
  dashboard adds no egress.
- **Article VI (Modularity):** preserved and, if anything, strengthened. `apps/core` opens no
  database itself — it reads through `@friday/storage` exactly as the CLI does, which
  `.dependency-cruiser.cjs` enforces. The UI gets a declared interface rather than a second reader
  of the log.
- **Article I (The User):** the roadmap's rule 4 — a milestone ending in nothing demonstrable is
  re-scoped rather than extended — is a rule about the owner being able to see progress. This
  honors it.

**The five questions:**

- [x] **Can the user see it?** This is the change that lets them see anything in a browser.
- [x] **Can the user stop it?** The process is stopped like any other; the dashboard is read-only in
      this first slice and cannot cause anything to happen.
- [x] **Can we replace it?** The router is a thin translation over `@friday/storage`. Replacing the
      transport does not touch the reads.
- [x] **Can we explain it?** Yes — and the thing it serves is the explanation surface itself.
- [ ] **Will this still be right in five years?** **The decision to have `apps/core`, yes — it is in
      the Bible. The M2 start date is milestone-scoped and recorded here so a future reader knows
      the timing was chosen rather than drifted into.**

**Notes:** The honest tension is with ADR-0021, which said M3. This does not overturn its decision —
the CLI keeps its in-process read-only path — but it does fire ADR-0021's own first review trigger
("`apps/core` ships") one milestone early. ADR-0021's status is unchanged and its Status line is not
edited, per the ADR README's immutability rule.

## Alternatives considered

### Host the data path inside `apps/cli` as `friday serve`

**What it is.** Add a command to the existing CLI that serves the dashboard, avoiding a new app.

**Advantages.** No new workspace package. Reuses the CLI's existing context, config loading, and key
provider. Nothing new to wire into CI.

**Why rejected.** It is the alternative ADR-0021 rejected by name — `apps/core` under another name —
and adopting it would mean doing the rejected thing while appearing not to. It also inverts the
CLI's stated purpose: [`apps/cli/README.md`](../../apps/cli/README.md) rule 1 says the recovery
commands must work when everything else is broken, and a CLI that also hosts a long-running web
server for the dashboard is no longer a recovery tool with a small surface. The work would have to
move at M3 regardless.

### Defer the dashboard to M3, when `apps/core` exists anyway

**What it is.** Honor ADR-0021's timing exactly. Build the M2 Guardian, audit, and constitutional
tests; ship the dashboard once the core service arrives with the Chief of Staff.

**Advantages.** Strict dependency order. No throwaway work. One code path. It is what ADR-0021
assumed would happen, and it is the intellectually tidy answer.

**Why rejected.** It re-creates the exact risk the roadmap pulled the dashboard forward to manage.
Chapter 39 names the months between M0 and M4 with nothing to look at as *"the single greatest
risk"* to the project, and identifies the dashboard's early placement as one of the deliberate
inefficiencies protecting against it — adding that these are *"worth protecting when they seem like
overhead."* This is precisely the moment they seem like overhead. It would also leave M2 unable to
meet its own completion criterion, which requires an approval to appear **in the dashboard** with a
full explanation.

### Let the dashboard read a static export of the log

**What it is.** Have the CLI periodically write a JSON snapshot that a static page renders.

**Advantages.** No server, no new runtime dependency, no long-lived process.

**Why rejected.** It fails [Chapter 26](../01-bible/26-dashboard-architecture.md) rule 2 — *"Live,
never stale. No refresh button exists"* — and it creates a second, derived copy of the event log
whose staleness is invisible. A transparency surface that can silently show you yesterday's state is
worse than no surface, because it is trusted.

## Consequences

**Positive**

- Milestone 2 can meet its completion criterion, which is written in terms of the dashboard.
- The `apps/web` charter — "everything comes from core" — is true from the first screen rather than
  being retrofitted after the UI has learned to read data another way.
- The boundary is established while the surface is one query, which is the cheapest moment to get it
  right.
- The M3 migration of `friday status`, `events tail`, and `verify` onto the API now has something to
  migrate onto.

**Negative**

- **`apps/core` is being shaped before the Chief of Staff exists**, which is the substance of
  ADR-0021's objection and it does not go away by being acknowledged. Mitigated by keeping the M2
  surface to reads over the event log, and by the app being composition-only so that what is built
  is wiring rather than logic — but if M3 imposes an unexpected structure, some of this is rework.
- **A long-running local service now exists**, which is a process to supervise, and the README's
  Safe Mode, crash-loop, and graceful-drain rules are written but not yet implemented. Until they
  are, `apps/core` is a development server and should not be described as more than that.
- **Two readers of the event log now run at once** — the CLI and core. WAL mode makes this safe and
  it is already tested, but it is a wider claim than M1 made.
- The dependency footprint grows for the first time since M1, in a project whose rule is to prefer
  writing fifty lines over adding a package.

**Neutral**

- `apps/core` depends on `@friday/config`, `@friday/contracts`, and `@friday/storage` — all
  workspace packages the boundary rules already permit.
- ADR numbering skips 0025–0028, which are held by the unmerged conscience branch.

## Reversibility

- **Cost to reverse:** low.
- **How:** delete `apps/core` and `apps/web`. Nothing else imports them — the dependency rules
  forbid a package importing an app, so the blast radius is the two directories and their CI entries.
- **Point of no return:** none while the surface is read-only. It arrives when the first mutation
  ships, because at that point the API is how something is caused to happen rather than merely
  observed.

## Review triggers

- **The Chief of Staff lands at M3** — reassess whether the router shape built here survived, and
  record the answer. This is the honest test of the bet above.
- `apps/core` acquires anything that is not composition — a rule, a calculation, a policy decision —
  which means logic has leaked out of `packages/`.
- The first mutation is added, which is when the Guardian becomes mandatory on this path per
  [Chapter 20](../01-bible/20-api-standards.md) rule 3 and the reversibility above changes.
- The M1 read-only CLI path stops being exercised by tests once the commands move onto the API.

## Notes

`apps/core/README.md` says Milestone M1, which was wrong when written and is corrected to M2 in the
same change as this ADR. The README is a charter rather than a decision record, so it is edited in
place; this ADR is the record of why.

The uncertain judgment here is the scope line. "Read-only queries over the event log" is a
defensible M2 surface, but the boundary between that and "enough API to be worth having" is not
sharp, and it will be tested the first time a screen wants something the log does not directly
answer. The rule adopted is that if answering a question requires computation, the computation
belongs in a package and `apps/core` calls it.
