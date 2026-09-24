# ADR-0053 — Life Core comes before presence, autonomy, and AI

- **Status:** proposed
- **Date:** 2026-09-24
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **re-scopes** M6 in [Chapter 39](../01-bible/39-roadmap.md) and re-orders
  the catalogue in [Chapter 13](../01-bible/13-department-architecture.md)
- **Related:** [ADR-0041](0041-one-hud-is-the-dashboard-grown-up.md) ·
  [ADR-0048](0048-the-first-connector-is-weather.md) ·
  [ADR-0028](0028-the-chain-covers-a-payload-digest-and-is-segmented.md) ·
  [ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md) ·
  [Chapter 09](../01-bible/09-database-design.md) · [Chapter 26](../01-bible/26-dashboard-architecture.md)

---

## Context

After M5, FRIDAY records, refuses, plans, asks, and explains — and **knows nothing about the owner's
life.** She has no tasks, no calendar, no day. Her one real connector reports the weather. M6 as
written (*Face*) would next have built a Tauri shell, a menu bar, a global hotkey, notarization,
notifications, and a knowledge department: ways for FRIDAY to be **more present**, around content
that does not yet exist.

On 2026-09-24 the owner re-set the direction. FRIDAY is to become a calm, life-first personal
operating system — tasks, schedule, day planning, focus, coursework — built **on** the safety
foundation rather than instead of it. The principle, in the owner's words:

> FRIDAY should become genuinely useful for managing my life before we spend significant effort
> making her more present, more autonomous, or more AI-heavy.

Three facts made the old M6 the wrong next step:

1. **A face with nothing behind it.** [ADR-0041](0041-one-hud-is-the-dashboard-grown-up.md) §5
   already found that two of eight HUD panels were buildable, and argued that a surface full of
   zeroes teaches the owner to stop looking. A native shell around that surface is the same problem
   with a longer build.
2. **The shell work had outrun its decisions.** A native-shell pull request (#105) reached ~6,000
   lines while its trust decision was still `proposed`. It was closed unmerged on 2026-09-24, with
   the ideas worth keeping listed on the PR.
3. **Productivity was scheduled after four other milestones**, though it is the department the
   owner will use every day.

**What was not known:** whether a deterministic, rule-based day planner will feel useful without a
model behind it. This ADR bets that it will, and that explainability is worth more to the owner than
fluency. The AI milestone is where that bet is checked.

---

## Decision

We will **build Life Core next, as the smallest complete vertical slice, and order everything after
it so that FRIDAY is useful before she is more present, more autonomous, or more AI-heavy.**

### 1. The order

| # | Milestone | In one line |
|---|---|---|
| **M6** | **Life Core** | One real life feature, end to end: tasks, on a life-first Today |
| M7 | Context | Weather, a **local** `.ics` calendar import, shifts, availability |
| M8 | Day Planning | A deterministic, explainable planner — no model required |
| M9 | AI | A real provider, chosen then, on cost and privacy |
| M10 | Life Areas | Coursework, focus, notes, and the domains after them |
| M11 | Presence | The Mac app, menu bar, hotkey, notifications, signing |
| M12–M15 | Memory & Endurance · Self-Improvement · Reach · Breadth | Unchanged in content, renumbered |

**Only M6 gets a done-when now.** The others are defined when they start, against what Life Core
teaches — setting done-whens for five milestones in advance would decide product behaviour that
nobody has seen yet.

### 2. Life Core is a vertical slice, not a framework

In order: **task creation → persistence → Today → completion → audit trail → deletion and forgetting
→ API protection → tests.** Nothing is built for a second domain until tasks work end to end; tasks
are the reference implementation the later domains copy.

**Done when:** the owner creates, edits, and completes a task from the dashboard; it survives a
restart; it appears on a life-first Today with the reason it is ranked where it is; the owner can
click through to the event that recorded it and **forget** it, after which its content is
unrecoverable while the record still proves nothing else changed; and none of it is reachable by an
unauthenticated local process.

### 3. Three things are inside Life Core that could have been deferred

- **Forgetting.** No personal life data is stored until `friday forget` exists for it. The redaction
  design is already settled — payload removed, tombstone recorded, chain intact
  ([ADR-0028](0028-the-chain-covers-a-payload-digest-and-is-segmented.md),
  [Chapter 09](../01-bible/09-database-design.md#data-ownership-guarantees)) — and is unbuilt.
  **What is deleted, what remains as proof, and what must not remain recoverable** is decided in its
  own ADR before any task is stored.
- **API protection.** `apps/core` cannot tell the owner from any other local process
  ([ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md)), and the rule
  that lets the owner act directly (`owner-acts-directly`) trusts that it can. Personal data does
  not flow through the API until that is fixed, in its own ADR.
- **The life-first home.** The dashboard's home becomes life-first, and the instrument-panel HUD
  moves to a **System** section. ADR-0041's rule survives intact: *if FRIDAY has not recorded it,
  the dashboard does not show it.* Settled in its own ADR, which amends ADR-0041.

### 4. Departments

**Productivity** moves to M6 and owns tasks, calendar, scheduling, day planning, workload, focus,
and coursework. It does **not** become a catch-all: recipes, groceries, and household lists belong
to a separate department — **Household** is the candidate — decided at M10 if the scope supports it.
There is no generic "Life" department. **Knowledge** (notes) moves to M10.

### 5. What is kept, paused, and deferred

| | |
|---|---|
| **Kept, delivered** | The connector SDK and the weather connector, built under M6's previous scope. Weather reaches Today in M7 |
| **Paused** | All native work. ADR-0052 is not accepted and returns, if at all, at M11 |
| **Deferred to M9** | Any real AI provider. The model router keeps its stand-in; nothing in M6–M8 may depend on a model |
| **Deferred to M11** | ADR-0030's Touch ID trigger, notifications, the Apple Developer fee, and the old M6 done-when (*"what does my week look like?" from the menu bar*) |

---

## Constitutional review

- **Article I (The User):** served directly — the owner decided the order, and every later
  milestone's scope is left for the owner to decide when it starts.
- **Article III (Approval):** unchanged. Anything FRIDAY does to life data on the owner's behalf
  still goes through the Guardian; no rule for that exists, so it is refused until the owner writes one.
- **Article IV (Privacy):** strengthened by §3 — forgetting and API protection come **before** the
  first personal record rather than after.
- **Article IX (Respect):** a calm, life-first home over an always-open instrument panel.
- **Principle 10 (Simplicity Wins):** one vertical slice before any framework.

**The five questions:**

- [x] **Can the user see it?** — every task change is an event, by the data-model ADR this requires.
- [x] **Can the user stop it?** — nothing autonomous is added; FRIDAY acting on tasks has no rule.
- [x] **Can we replace it?** — no vendor is added; AI is explicitly deferred.
- [x] **Can we explain it?** — Today must say why each item ranks where it does, from recorded data.
- [ ] **Will this still be right in five years?** — the order, probably; the bet that a rule-based
      planner is useful without a model is unproven until M8.

---

## Alternatives considered

### Keep M6 as Face and add tasks inside it

**Advantages.** No renumbering; the shell work already done would have landed.
**Why rejected.** It makes the milestone larger and its done-when about the menu bar rather than the
owner's day, and it keeps building presence around empty content.

### AI before Day Planning — the order first proposed

**Advantages.** A model could make planning feel smarter sooner.
**Why rejected by the owner.** It makes the planner's authority depend on a provider that has not
been chosen, and makes explanations depend on a model's account of itself. A deterministic planner
can always say why.

### A single "Life" department

**Advantages.** One place for everything personal.
**Why rejected by the owner.** It becomes a catch-all, which is what departments exist to prevent
([Chapter 13](../01-bible/13-department-architecture.md)).

---

## Consequences

**Positive**
- The next milestone ends in something the owner uses every day.
- Deletion and API protection are designed before the data they protect exists.

**Negative**
- **Milestones renumber a second time** in six weeks. ADR milestone numbers are read through the map
  in Chapter 39, which is now two steps deep.
- **The native shell's work is discarded for now**, including its security findings, which live only
  on a closed PR until they are rebuilt.
- **OAuth and the credential broker stay unexercised** by any real connector until after M9, extending
  the cost ADR-0048 recorded.
- The dashboard will be used in a browser tab for several milestones, which is weaker for approvals
  than a native shell ([ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md)).

**Neutral**
- `departments/operations`, the Guardian, the clerk, and the plan engine are unchanged.

---

## Reversibility

- **Cost to reverse:** low
- **How:** re-order Chapter 39 again. Nothing in this ADR is code.
- **Point of no return:** none. The data-model ADR it requires will have one — the first task stored.

---

## Review triggers

- **M6 closes** — was the vertical slice small enough? Re-check the order of M7–M10 before starting M7.
- **M8's planner is used for two weeks** — if the owner finds it unhelpful without a model, bring M9
  forward rather than adding heuristics.
- **The owner asks for the menu bar or notifications before M11** — that is evidence Presence is
  needed earlier, and the order should move rather than be worked around.

---

## Notes

- Numbered 0053, not 0052: 0052 belongs to the native-shell ADR on closed PR #105 and is reserved in
  case it returns at M11. ADR numbers are addresses; reusing one would make old links lie.
- The four decisions owed before Life Core code — personal data model and sensitivity, forgetting,
  the life-first home, API protection — are listed in Chapter 39, M6.
