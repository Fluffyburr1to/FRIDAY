# 04 — Monorepo vs Multi-Repo

> **Governing provisions:** Constitution Article VI (Modularity); Manifesto Principle 5
> (Modularity Creates Freedom), Principle 6 (Architecture Is Sacred), Principle 10 (Simplicity
> Wins); Core Value 6.

---

## In plain language

There are two ways to organize the files of a large software project.

**Multi-repo** means each piece gets its own separate project folder with its own history — the
server in one, the phone app in another, the shared code in a third. Each is versioned and released
independently, like separate products.

**Monorepo** means everything lives in one project folder with one history. The server, the phone
app, the shared code, and the documentation all sit side by side, and a single change can touch all
of them at once.

The instinct — and I want to name it, because it is a natural one and it is wrong here — is that a
modular system needs separate repositories. Your Constitution says every subsystem must be
replaceable, and separate folders *feel* like separate things.

**They are not the same thing.** Modularity is about how code depends on other code. Repository
layout is about where files sit on a disk. You can build a hopelessly tangled system across fifty
repositories, and a rigorously modular one in a single folder. What actually enforces modularity is
a rule that says "the memory system may not reach into the connector system" — and that rule is
*easier* to enforce automatically when everything is in one place, because a tool can see all the
code at once and fail the build when someone crosses a line.

---

## Recommendation

**A single monorepo**, managed with pnpm workspaces and Turborepo, containing every application,
package, department, and connector.

Modularity is enforced by three mechanisms *inside* the monorepo:

1. **Package boundaries.** Each unit is a real package with an explicit list of what it depends on.
   Using something you did not declare fails immediately.
2. **Automated boundary rules.** `dependency-cruiser` runs in CI with an explicit map of who may
   import whom. Violating the architecture fails the build with a message naming the rule.
3. **Interface-first design.** Replaceable subsystems are consumed through an interface, never a
   concrete implementation. Chapter 30 makes this a reviewable standard.

### The one deliberate exception

**Third-party plugins live outside this repository.** When FRIDAY eventually supports plugins
written by other people, those are separate repositories by necessity — we neither control nor
review them, and they must not be able to break our build. They consume a published, versioned
`@friday/plugin-sdk`. See [Chapter 15](15-plugin-system.md).

This exception proves the rule: the boundary is drawn at *trust and control*, not at *modularity*.

---

## Why

### 1. Your changes cut across everything, and you are one person

This is the decisive argument. Consider a change you will make dozens of times: adding a field to
an Approval Request so it can carry an expiry time.

In a **monorepo**, that is one commit. Edit the schema in `packages/contracts`. The compiler
immediately flags the database migration, the Guardian, the API, the web dashboard, and the iPhone
app. Fix each, run the tests once, open one pull request, merge. The system is never inconsistent.

In a **multi-repo**, that same change is: modify the contracts repo, publish version 2.1.0, wait for
the registry, update the server's dependency, test it, release it, update the dashboard's
dependency, test it, release it, update the phone app's dependency, test it, release it — five pull
requests across four repositories, in a required order, and during the whole sequence some parts of
your system are running the old shape and some the new. For a company where four teams own those
four repos and cannot coordinate a simultaneous change, that overhead buys real independence. For
one person making all four changes anyway, it buys nothing and costs everything.

### 2. Multi-repo solves a problem you do not have

The genuine motivation for multi-repo is **organizational**, not technical: independent teams
shipping on independent schedules without blocking each other. Conway's Law in repository form.

You have no teams. You will not have teams for years, and if you do, they will be small. Adopting
the coordination structure of a fifty-person engineering organization while you are one person
working evenings is a textbook case of the ceremony Principle 10 warns against.

### 3. It is the only structure that survives long gaps

You will be away from this project for weeks at a time. AI assistants will start every session
knowing nothing.

In one repository, "read the code" is a coherent instruction. An assistant can see the type
definitions, the calling code, the tests, and the documentation together and reason about them. Its
change is verified against the whole system before you see it.

Across nine repositories, the assistant sees a fragment. It cannot know what depends on what it is
changing, cannot run the tests that would catch the break, and cannot verify its own work. This
alone would justify the decision.

### 4. Atomic history is the audit trail Article II asks for

In one repository, one commit shows the complete change — every file, across every application,
with one message explaining why. Six months later, `git log` answers "what changed and why" in one
place.

In multi-repo, that history is scattered across nine timelines that must be manually correlated.
For a project whose Constitution requires traceability, one honest history is worth a great deal.

### 5. Refactoring stays possible

Article VI requires that subsystems be replaceable. Replacing a subsystem means changing it *and*
everything that uses it, simultaneously, with confidence.

Monorepo: rename it, and the compiler lists all 47 call sites. Change them, run all tests, merge.
An afternoon.

Multi-repo: you cannot see the call sites. You add the new interface, deprecate the old one,
release, update each consumer over weeks, and eventually remove the old one — if you remember. This
is why multi-repo systems accumulate deprecated code that never dies. **Multi-repo makes Article VI
harder to honor, not easier.**

---

## Alternatives considered

### Full multi-repo (one repository per major component)

Roughly: `friday-core`, `friday-contracts`, `friday-desktop`, `friday-mobile`, `friday-web`,
`friday-departments`, `friday-connectors`.

*Real advantages:* smaller repositories are easier to grasp in isolation; access can be granted per
repository; a broken build blocks only one component; each has an independent release cadence;
open-sourcing one piece later is trivial.

*Why rejected:* every one of those advantages addresses a multi-team problem. The costs — five-PR
cross-cutting changes, version-skew debugging, publishing overhead on every shared-code edit, AI
assistants working blind — land squarely on the one person doing the work. The single most common
failure mode of solo multi-repo projects is that the shared package falls out of sync with its
consumers and nobody notices for a month.

### Hybrid: core monorepo + separate app repositories

Kernel and shared packages in one repository; desktop, mobile, and web in their own.

*Rationale:* apps have genuinely different build tooling, different release cycles, and app-store
review processes.

*Why rejected:* it splits precisely along the seam where cross-cutting changes are most frequent —
the contracts between kernel and interface. Every API change would become a two-repository dance.
The tooling difference it solves is already solved better inside a monorepo, where each app keeps
its own build configuration in its own folder. Turborepo already gives independent release cadence
without splitting the repository.

*Retained as a fallback:* if the repository ever becomes unwieldy — see triggers below.

### Monorepo with git submodules

Rejected without much deliberation. Submodules are notoriously error-prone, produce detached-HEAD
states that confuse people and tools alike, and are poorly handled by most CI systems and every AI
assistant. They deliver the drawbacks of multi-repo with additional sharp edges.

### Monorepo with Nx instead of Turborepo

A close call. Nx offers dependency graph visualization, code generators, and automated dependency
enforcement out of the box — genuinely valuable.

*Why rejected:* Nx is opinionated about project structure and adds meaningful configuration
complexity. Turborepo does one thing — make tasks fast — and stays out of the way. Principle 10.
The specific capability we would miss, dependency enforcement, is covered by dependency-cruiser.
Revisit if a team forms.

---

## Trade-offs we accept

Every one of these is real. None is fatal, and each has a defined mitigation.

| Cost | Severity | Mitigation |
|---|---|---|
| **Repository grows large.** Eventually a slow clone. | Low | Node projects stay small. `git clone --filter=blob:none` if it matters. Reassess above 1 GB. |
| **CI runs more than necessary** without careful configuration. | Medium | Turborepo's affected-package detection; GitHub Actions path filters. Configured at M0, not later. |
| **All-or-nothing access control.** Cannot grant someone access to one part. | Low now, Medium later | Irrelevant at one contributor. If it becomes real, that is the trigger for the hybrid split. |
| **A broken shared package blocks everything.** | Medium | Exactly the point — it *should* block. Branch protection means breakage never reaches `main`. |
| **Tooling must be monorepo-aware**; some tools assume one project per repo. | Low | All chosen tools support workspaces. This constrains future tool selection, deliberately. |
| **Harder to open-source one component later.** | Low | `git subtree split` extracts a package with its history when needed. |

---

## Triggers to reconsider

This decision is re-opened if any of the following becomes true. Not on a schedule — on evidence.

1. **A contributor should have access to some parts but not others.** The strongest trigger, and
   the one most likely to actually occur.
2. **Clean CI exceeds 15 minutes** after caching and affected-detection are properly configured.
3. **A component needs a fundamentally different toolchain** — say, a Rust or Go service substantial
   enough to warrant its own build system.
4. **Repository exceeds 1 GB** or clone time exceeds two minutes on a normal connection.
5. **Third-party plugin ecosystem emerges.** Already handled by the documented exception.

If triggered, the migration path is the hybrid split — apps out, kernel stays — and it is
straightforward because package boundaries were enforced from the start. **This is the real payoff
of enforcing modularity inside the monorepo: the option to split later remains cheap.**

---

## The long-term call

**Monorepo, indefinitely.** Industry consensus has moved decisively this direction for
single-organization codebases, tooling is mature and improving, and it is unambiguously correct for
a solo builder working with AI assistance.

The important discipline is not the folder layout. It is that **modularity must be enforced by
tooling rather than by geography**. A monorepo where `dependency-cruiser` fails the build on a
boundary violation is more genuinely modular than nine repositories held together by good
intentions — because the rule is checked on every commit rather than remembered on good days.

Article VI is satisfied by enforced boundaries, not by separate folders. That is the whole
argument.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
