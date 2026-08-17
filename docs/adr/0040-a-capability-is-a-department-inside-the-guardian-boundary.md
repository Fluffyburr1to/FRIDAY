# ADR-0040 — A capability is a department inside the Guardian boundary

- **Status:** accepted — 2026-08-17. **§5 was revised before acceptance**; see §5.
- **Date:** 2026-08-12
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **narrows** [ADR-0010](0010-departments-communicate-via-events.md) and
  [Chapter 13](../01-bible/13-department-architecture.md) by settling what a capability may be
- **Related:** [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0006 — Capability tokens rather than RBAC](0006-capability-based-authorization.md),
  [ADR-0007 — Build the agent runtime rather than adopt a framework](0007-no-agent-framework.md),
  [ADR-0011 — Plan engine as a durable state machine, not a loop](0011-plan-engine-state-machine.md),
  [Chapter 11 — Agent Framework](../01-bible/11-agent-framework.md),
  [Chapter 12 — Chief of Staff](../01-bible/12-chief-of-staff.md),
  [`departments/README.md`](../../departments/README.md)

---

## Context

The owner asked for FRIDAY's capabilities to be built as Claude Code skills — a directory per skill
under `~/.claude/skills/`, each with a `SKILL.md` carrying YAML frontmatter that says what it does and
when it should trigger. Five to begin with: `metrics`, `inbox`, `trends`, `plan`, `vault`.

**The idea underneath that request is correct**, and this ADR exists partly to keep it:

> Five small capabilities beat one enormous one, because only the relevant one loads and the context
> stays clean.

That is the same argument [Chapter 13](../01-bible/13-department-architecture.md) makes for
departments and [ADR-0007](0007-no-agent-framework.md) makes for bounded agents over a general loop.
Nothing about it is in dispute.

### What is in dispute is where the capability runs

`~/.claude/skills/` is a Claude Code construct. A skill there is Markdown read by an assistant
process that already holds the owner's shell, filesystem, and network. Its frontmatter is a routing
hint for that assistant, and its instructions are followed on trust.

FRIDAY's architecture makes the opposite assumption at every level. From
[`departments/README.md`](../../departments/README.md), enforced by `dependency-cruiser` rather than
by review:

> **No department implements authorization. The Guardian is the only authority.**

And from [`packages/agent-runtime/README.md`](../../packages/agent-runtime/README.md):

> Agents are the least trustworthy component in FRIDAY — they run AI-generated behavior over
> untrusted content. This package makes it so that an agent **cannot do anything; it can only ask.**

A capability living in `~/.claude/skills/` has ambient authority by construction: it can read any
file, call any host, and spend any amount, because the process interpreting it can. Nothing records
what it did, because the event log is inside FRIDAY and the skill is outside her. Nothing can refuse
it, because [ADR-0005](0005-guardian-sole-authorization.md)'s chokepoint is not on the path.

**So the two are not competing implementations of the same idea.** One is a capability; the other is
an exemption from the security model, wearing a capability's clothes.

### What we did not know

Whether the owner wanted skills *as a convenience for himself* — a fast way to add behavior without
a build — or *as FRIDAY's runtime*. Asked on 2026-08-12 he chose the runtime boundary explicitly:
departments inside the Guardian, with the small-capability idea preserved. This ADR records the
reasoning so it is not re-litigated, and so the cost of the choice is written down rather than
discovered later.

### What exists today

Nothing. `packages/agent-runtime`, `packages/chief-of-staff`, and `packages/model-router` are empty
directories with charters; `departments/engineering` and `departments/operations` are empty. Chapter
13 already specifies the anatomy and the manifest. **This ADR adds very little to the design and
mostly closes a door** — which is why it is short.

---

## Decision

We will **implement every FRIDAY capability as a department capability declared in a manifest,
reachable only through the Chief of Staff and authorized only by the Guardian. `~/.claude/skills/` is
rejected as a runtime authorization boundary.**

```
  natural language
        │
        ▼
  Chief of Staff          intent → plan (bounded model call)
        │                 capability selection is DETERMINISTIC
        ▼
  Guardian                may this actor perform this action on this resource?
        │                 decide → clerk records → then act
        ▼
  Department capability   runs in the agent runtime, no ambient authority
        │
        ▼
  events                  the only way anything leaves
```

### 1. A capability is a manifest entry, not a file

Per [Chapter 13](../01-bible/13-department-architecture.md), a department declares its capabilities
in `department.json`. Each capability names:

| Field | Why it is required |
|---|---|
| `id`, `description` | The description is the routing surface — **this is the good half of `SKILL.md` frontmatter, kept** |
| `input` / `output` schemas | Zod at the boundary; never trust model output ([Chapter 30](../01-bible/30-coding-standards.md)) |
| `requires` | The capability tokens it needs. Anything not declared is refused, not requested |
| `emits` | The event types it may publish. Rule 5: no department publishes an undeclared event |
| `sensitivity` | The ceiling on what it may handle, which drives model routing |
| `budget` | Tokens, money, wall-clock, tool calls — enforced by the runtime, not by the capability |

**The manifest is the contract, and it is machine-checked.** A `SKILL.md` description is a promise; a
manifest entry is a schema the runtime rejects violations of.

### 2. Small, narrow, independently routable — preserved verbatim

The owner's constraint stands and is worth restating as a rule the implementation is held to: **a
capability does one thing, is testable alone, and is selected without any other capability loading.**
Where Chapter 13 and this rule disagree in a future design, this rule wins.

### 3. Natural language never selects a tool directly

The model parses intent and proposes a plan. **Deterministic code maps that plan onto capabilities**,
per [ADR-0011](0011-plan-engine-state-machine.md). The owner's requirement — *"I should not have to
know the name of the skill"* — is met by the routing step, not by letting a model reach for a tool.

The difference matters because a model that picks tools directly makes the audit answer to "why did
FRIDAY do that?" into "the model chose to", which [Chapter 12](../01-bible/12-chief-of-staff.md)
rejects as an explanation.

### 4. No ambient authority

Capabilities run in the agent runtime: worker isolation, stripped globals, no `fetch`, no `fs`, no
`process.env`, no child processes, no credentials. Every effect is a mediated request. This is
[ADR-0007](0007-no-agent-framework.md)'s existing guarantee; this ADR only forecloses the route
around it.

### 5. The first capabilities — revised before acceptance, 2026-08-17

**The version of this section drafted on 2026-08-12 is superseded by the table below.** It listed
`vault` as the natural first capability and reachable at M5. That was wrong, and the error is worth
recording rather than quietly correcting: `vault` depends on the memory interface and
[ADR-0039](0039-obsidian-is-a-projection-of-memory-never-a-source-of-it.md)'s projector, and the
four-layer memory system is **M7** in [Chapter 39](../01-bible/39-roadmap.md). Scheduling `vault` at
M5 would have pulled the whole memory architecture forward by two milestones to serve one capability
— which is the *"widen a slice"* failure Chapter 39 warns about, arriving as a dependency rather than
as a feature request.

The owner rejected that on 2026-08-17 and set M5's scope to `departments/operations`, which
[Chapter 39](../01-bible/39-roadmap.md) named as the first department all along and which this ADR's
draft had overlooked entirely.

| # | Capability | Department | Needs | Reachable at |
|---|---|---|---|---|
| 1 | `run-self-check` | `operations` | `packages/diagnostics`, both M5 deliverables | **M5** — risk `low`, no approval |
| 2 | `compact-event-log` | `operations` | compaction, shipped at M2 | **M5** — risk `medium`+, **requires approval** |
| 3 | `plan` | — | Chief of Staff, model router | **Not a capability.** See below |
| 4 | `vault` | knowledge | memory interface + projector (ADR-0039) | **M7**, with the memory system |
| 5 | `inbox` | communications | **a mail/calendar connector**, which does not exist | M6 |
| 6 | `metrics` | — | connectors per source, credential broker | M6+ |
| 7 | `trends` | — | a fetch connector, and a notion of "since last check" | M6+ |

**★ Why `operations` is the right first department**, and it is not a consolation prize. Its charter
already says it: it *"exercises the entire framework — manifest, capabilities, agents, events,
policies — with **zero external risk**"*. It touches no personal data, calls no external service, and
needs no network. And the two capabilities above are exactly what the M5 done-when requires: one that
runs, and one that must stop and ask, so the approval clause is proved by something genuinely
consequential rather than by a contrivance. Rewriting the event log is genuinely consequential.

**★ `plan` is not a capability, and listing it as one was a layering error.** Producing a plan is
what the Chief of Staff *is* ([ADR-0011](0011-plan-engine-state-machine.md),
[Chapter 12](../01-bible/12-chief-of-staff.md)). A department capability that plans would be reached
*by* the planner, which is a loop through the component whose entire purpose is to sit above them.

**★ `inbox`, `metrics`, and `trends` cannot be built at M5**, and saying so now is cheaper than
discovering it mid-milestone. Each needs `packages/connector-sdk` — the egress-enforcing HTTP layer
and the credential broker — which [Chapter 39](../01-bible/39-roadmap.md) places at M6 with the first
connector.

**The owner's most motivating capabilities are still the ones the architecture reaches last.** That
consequence, recorded below, is unchanged by this revision and is if anything sharper: `vault` moved
from M5 to M7.

### 6. What this does not change

- **Departments still communicate only by events** ([ADR-0010](0010-departments-communicate-via-events.md)).
- **The Guardian is still the only authority** ([ADR-0005](0005-guardian-sole-authorization.md)); the
  clerk still records ([ADR-0031](0031-the-clerk-records-what-the-guardian-decided.md)).
- **Chapter 13's anatomy is unchanged.** This ADR adds no directory and no field.
- **Claude Code skills remain fine for developing FRIDAY.** This decision is about FRIDAY's runtime,
  not about the owner's tooling — see §Notes.

---

## Constitutional review

- **Article III (Approval):** the decisive one. A capability outside the Guardian makes approval
  unenforceable — not bypassable in edge cases, but structurally absent.
- **Article V (Least privilege):** a `SKILL.md` interpreted by a shell-holding process has maximum
  privilege by default. A manifest capability has exactly what it declared.
- **Article II (Transparency):** work done outside FRIDAY produces no events, so it appears in no
  audit trail and no dashboard. The owner would have no way to see it.
- **Article VI (Modularity):** departments are already the growth mechanism; this keeps one path
  rather than two.

**The five questions:**

- [x] **Can the user see it?** — every capability run is events, start to finish.
- [x] **Can the user stop it?** — the Guardian is on the path; approvals suspend the plan.
- [x] **Can we replace it?** — a department can be removed and nothing breaks (Chapter 13).
- [x] **Can we explain it?** — the plan, the decision, and the events are all recorded.
- [x] **Will this still be right in five years?** — this is the repository's existing architecture.
      The decision is to *not* add a second one.

---

## Alternatives considered

### A. `~/.claude/skills/` with `SKILL.md`, as originally requested

**What it is.** Each capability is a folder with Markdown instructions and YAML frontmatter, loaded
by an assistant when its description matches.

**Advantages, argued properly.** The owner can add a capability by writing a text file — no build, no
tests, no PR, no assistant round-trip. Iteration is seconds. The format is portable across tools and
already understood by the tooling he uses daily. **The context-efficiency argument is genuinely good**
and this ADR adopts it. And for a single user on his own machine, "the assistant can already do
anything" is a fair description of the status quo rather than a new risk.

**Why rejected.** It puts FRIDAY's capabilities outside every mechanism the project has spent four
milestones building — no Guardian, no capability tokens, no budget ledger, no event log, no audit
trail, no isolation. Article III becomes unenforceable, and `dependency-cruiser`'s rule that nothing
outside `packages/guardian` decides permission becomes true only of code that happens to live in the
repository. The gain is developer convenience for one person; the cost is the security model.

### B. Capabilities as plugins through `packages/plugin-host`

**What it is.** Treat first-party capabilities as plugins, with signature verification and process
sandboxing.

**Advantages.** A trust boundary already designed for untrusted code, and it would exercise the
plugin path early rather than at M8.

**Why rejected.** Heavier than first-party code needs — process-level sandboxing, signing, and a
7-day trial period are answers to "code you did not write", which is not this. `plugin-host` is M8 and
its API is deliberately not promised yet. Reconsider if third parties ever ship capabilities.

### C. One large orchestrator that decides everything from context

**What it is.** No capability registry; a single well-prompted agent with broad tools.

**Advantages.** Nothing to route, nothing to declare, and it handles requests nobody anticipated.

**Why rejected.** It is the design the owner rejected himself, and correctly:
[ADR-0007](0007-no-agent-framework.md) already rejects agents with direct tool access because it
makes every safety guarantee depend on every agent behaving. Explanations degrade to "the model
decided".

### D. Departments without per-capability manifests

**What it is.** Keep departments; let each expose functions without declared schemas or budgets.

**Advantages.** Less ceremony per capability, and faster to write the first three.

**Why rejected.** The manifest is what makes a capability routable, budgetable, and refusable. Without
it, the Guardian is asked to authorize something it cannot describe, and Chapter 13's rules 3 and 5
have nothing to check against.

---

## Consequences

**Positive**

- One capability path, inside the boundary the whole system is built around.
- Every capability run is visible, refusable, budgeted, and explainable, with no work per capability
  to make it so.
- Departments remain independently removable and rewritable.
- The owner's context-efficiency requirement is met by narrow capabilities and lazy loading.

**Negative**

- **★ Adding a capability is a code change with tests and a pull request, not a text file.** This is
  the real cost, it lands squarely on the owner's stated preference, and it does not go away. A
  five-line `SKILL.md` becomes a manifest entry, schemas, a handler, and tests — and by CLAUDE.md
  rule 6, the tests are not optional.
- **The owner cannot add a capability without an assistant.** He does not program. Alternative A gave
  him a door this decision closes, and nothing in the current design reopens it.
- **`inbox`, `metrics`, and `trends` slip to M6** because they need connectors, and **`vault` slips
  to M7** because it needs the memory system (§5, revised). The owner's most motivating capabilities
  are the ones the architecture reaches last, and the first two capabilities FRIDAY gets are ones
  that look after herself.
- **More ceremony per capability than the work often deserves.** A capability that formats a date
  carries the same manifest as one that sends mail.

**Neutral**

- No new package or directory; Chapter 13's anatomy already accommodates this.
- Claude Code skills continue to be used for *building* FRIDAY, which this decision does not touch.

---

## Reversibility

- **Cost to reverse:** low today, high once capabilities exist.
- **How:** today, nothing is built — reversing is deleting this file. After capabilities exist,
  reversing means giving them ambient authority, which is not a refactor but the removal of the
  security model.
- **Point of no return:** the first capability that performs a real action on the owner's behalf.
  After that, moving it outside the Guardian means an action he can neither see nor stop.

---

## Review triggers

- **The PR-per-capability cost becomes the reason capabilities do not get built.** The negative
  consequence above, becoming real. The answer is a first-class *declarative* capability inside the
  boundary — a manifest the owner can write that the runtime still mediates — **not** a route around
  it.
- **Third-party capabilities are wanted** → Alternative B, and `plugin-host` at M8.
- **A capability needs something the manifest cannot express.** Re-read this before widening the
  manifest, because widening it is how ambient authority returns.
- **The Chief of Staff's deterministic routing proves inadequate** for natural language the owner
  actually uses. That is an argument about §3's mechanism, not about §1's boundary.
- **`connector-sdk` lands**, unblocking `inbox`, `metrics`, and `trends` — revisit §5's table.

---

## Notes

**This ADR mostly says no to something.** Chapter 13, ADR-0007, ADR-0010, and ADR-0011 had already
decided nearly all of it; what was missing was an explicit statement that an external skill directory
is not an alternative implementation of a capability. Without that written down, it is a reasonable
thing for a future assistant to propose — it is easier, it is fashionable, and the repository's own
`CLAUDE.md` mentions skills nowhere.

**On the owner's tooling.** Nothing here restricts `~/.claude/skills/` for developing FRIDAY. A skill
that runs the release audit or drafts an ADR is a fine use of the format. The line is whether FRIDAY's
*own* capabilities — the things she does on the owner's behalf, with his data and his accounts —
route through the Guardian. Those are different questions that happen to share a word.

**Uncertainty**, ranked:

1. **That the PR-per-capability cost is acceptable.** I think it is, because capabilities are few and
   long-lived. But the owner asked for skills partly *because* they are cheap to add, and I have
   answered a convenience requirement with an architecture argument. If capability count stalls at
   two, this was wrong, and the review trigger above is the honest place I expect to find out.
2. **That deterministic routing will feel natural enough.** Untested — the Chief of Staff does not
   exist. §3 is a design commitment, not an observation.
3. **The M6 slip in §5.** Based on reading `connector-sdk`'s charter and Chapter 39, not on trying to
   build `inbox` without a connector. There may be a useful `inbox` over local mail files; I have not
   investigated it.
