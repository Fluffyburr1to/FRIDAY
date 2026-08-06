# 13 — Department Architecture

> **Governing provisions:** Manifesto — The Organization ("Departments own responsibilities"),
> Principle 5 (Modularity Creates Freedom), Principle 6 (Architecture Is Sacred); Constitution
> Article VI (Modularity), Article VII (Reliability); Long-Term Vision (the ten domains).

---

## In plain language

A department is a area of responsibility. Communications owns messaging. Engineering owns FRIDAY's
own code. Home owns your physical environment. Finance owns money.

Departments are how FRIDAY grows. Your Long-Term Vision lists ten domains she should eventually
support. Each becomes a department. This is the mechanism that lets FRIDAY expand for decades
without her core ever changing — the kernel does not know what departments exist, and adding the
tenth is exactly as easy as adding the second.

The rule that makes this work is deceptively simple and absolutely load-bearing:

> **Departments never talk to each other directly.**

If the Communications department needs something from the Calendar department, it does not call it.
It announces what it needs on the event bus, and Calendar answers if it is there. This feels
inefficient — a direct call would be faster and more obvious — but it buys three things that
matter far more than the microseconds:

- **A department can be removed and nothing breaks.** Whatever depended on it degrades gracefully
  rather than crashing, because it was never holding a reference to it.
- **A department can be rewritten** without touching anything else.
- **A department can be added** without modifying a single existing file.

That is Article VI — "every subsystem should be replaceable without requiring the entire system to
be rewritten" — implemented as a communication rule rather than an aspiration.

---

## Recommendation

Departments are **self-contained, independently installable units** declared by a manifest,
communicating exclusively through the event bus, with capabilities registered at load time.

### Anatomy

```
departments/communications/
├── README.md              charter — what it owns and explicitly does not
├── department.json        the manifest — the contract with the kernel
├── package.json
└── src/
    ├── index.ts           register() — the only exported function
    ├── agents/            the specialists this department employs
    ├── handlers/          event subscriptions
    ├── policies/          department-specific rules the Guardian evaluates
    ├── capabilities/      what it can be asked to do
    └── prompts/           versioned prompt templates
```

### The manifest is the contract

```
{
  "id": "communications",
  "name": "Communications",
  "version": "1.0.0",
  "description": "Email, messaging, and correspondence",

  "capabilities": [
    {
      "id": "draft-message",
      "description": "Compose a message given intent and context",
      "input": "DraftMessageRequest",
      "output": "DraftMessageResult",
      "riskClass": "low"
    },
    {
      "id": "send-message",
      "description": "Send a composed message",
      "input": "SendMessageRequest",
      "output": "SendMessageResult",
      "riskClass": "medium",
      "irreversible": true                   ← surfaced in every approval
    }
  ],

  "requiredConnectors": ["gmail"],
  "optionalConnectors": ["slack", "imessage"],

  "subscribes": ["calendar.event.created", "approval.granted"],
  "publishes":  ["message.drafted", "message.sent", "message.failed"],

  "permissions": ["memory.read", "memory.write:communications", "model.invoke"],

  "degradedMode": {
    "whenConnectorUnavailable": "draft-only",
    "description": "Can still compose messages; cannot send until Gmail returns"
  }
}
```

Four fields carry most of the weight.

**`capabilities` is the department's public API.** It is what the Chief of Staff searches when
routing a step. Everything else in the department is private. This is what allows a department to be
completely rewritten as long as its capabilities keep their contracts.

**`irreversible: true` is a user-safety flag, not metadata.** It flows through the Guardian into
the approval screen, where it becomes the "cannot be undone" line — the single most decision-relevant
fact when you are approving something on a phone in ten seconds. Marking it in the manifest means
it cannot be forgotten by whoever writes the UI.

**`subscribes` and `publishes` are declared, not discovered.** A department subscribing to an
undeclared event fails at load. This gives us a machine-readable map of how information flows
through FRIDAY, which the dashboard renders as a live diagram — Article II applied to the
architecture itself, not just to actions.

**`degradedMode` is required.** Every department must state what it can still do when its
dependencies are down. Article VII says FRIDAY should "continue operating gracefully"; requiring
each department to answer *how* at design time is what makes that concrete rather than aspirational.

---

## The lifecycle

```
DISCOVERED    kernel scans departments/, reads manifests
     ▼
VALIDATED     manifest schema checked; referenced schemas exist;
              declared connectors exist; no capability ID collisions
     ▼
REGISTERED    capabilities added to the routing registry;
              event subscriptions wired; policies loaded
     ▼
READY         may receive dispatched steps
     ▼
DEGRADED  ←── a required connector failed; degradedMode applies;
     │        the dashboard shows why, in plain language
     ▼
DISABLED      by you, or after repeated failures.
              Plans routed here fail cleanly with a stated reason.
              The kernel is unaffected.
```

**A department failing to load is not a startup failure.** FRIDAY starts, logs it, shows it in the
dashboard, and runs without it. A department is an extension; the kernel is the system. A broken
Home Automation department must never prevent you from reading your calendar.

---

## The boundary rules

Enforced by `dependency-cruiser` in CI. Violating one fails the build.

| # | Rule | Why |
|---|---|---|
| 1 | **No department imports another department.** | The keystone. Enables removal, replacement, and addition without coordination. |
| 2 | **No department accesses the database directly.** All persistence goes through `packages/storage` repositories. | One place enforces encryption, one place enforces `principal_id` isolation, one place changes when SQLite is replaced. |
| 3 | **No department calls a connector it did not declare.** | The manifest is the security boundary; undeclared use is rejected by the runtime. |
| 4 | **No department implements authorization.** | The Guardian is the only authority. Two authorities eventually disagree, and the disagreement is a hole. |
| 5 | **No department publishes an event it did not declare.** | Keeps the information-flow map accurate. |
| 6 | **A department's internals are private.** Only `index.ts` is importable. | Enables internal rewrites without coordination. |

Rule 1 has one deliberate escape hatch that is worth naming, because otherwise people invent worse
ones: when department A genuinely needs a result from department B, it publishes a **request event**
with a correlation ID and subscribes for the corresponding response. This is a request/response
pattern *over* the bus. It is slower than a direct call, it is fully audited, and it degrades
gracefully when B is absent — the request times out with a clear reason rather than throwing a
`module not found`.

---

## The department catalogue

Derived from the Long-Term Vision. Order reflects dependency and risk, not enthusiasm.

| Department | Owns | Milestone | Notes |
|---|---|---|---|
| **Operations** | System health, backups, maintenance | M3 | First department. Exercises the framework with zero external risk. |
| **Engineering** | FRIDAY's own code and improvements | M6 | The one you asked for. Full treatment in [Chapter 31](31-git-workflow.md). |
| **Knowledge** | Notes, documents, research, recall | M5 | Exercises memory hardest |
| **Productivity** | Calendar, tasks, scheduling | M7 | First department touching your real life |
| **Communications** | Email, messaging | M7 | First irreversible external actions |
| **Home** | Lights, climate, devices | M8 | Physical world; Article III becomes literal |
| **Finance** | Balances, spending awareness | M8+ | **Read-only indefinitely.** See below. |
| **Health** | Fitness, sleep, medical records | M8+ | Highest sensitivity; strictest defaults |
| **Entertainment** | Media | M8+ | Low risk, low priority |

**Finance is read-only by design, indefinitely.** The Vision says "financial *awareness*," and I am
reading that word literally and building the department to match. FRIDAY will show you balances,
notice unusual spending, and flag upcoming bills. She will not move money. The capability to
initiate a transfer does not exist in the manifest, so it cannot be granted by mistake, by prompt
injection, or by an over-broad standing grant.

If you ever want that capability, it should be a deliberate decision made with a written ADR and
its own security review — not something that arrives quietly because a connector happened to support
it. Building the absence in now makes the later decision explicit.

---

## Alternatives considered

### One monolithic capability registry (no departments)

Every capability registered flat in the kernel.

**Rejected** because it has no unit of ownership. Nothing groups related capabilities, nothing
declares shared dependencies, nothing can be disabled as a unit, and there is no natural boundary
for a policy. It also produces a flat list of eventually a hundred capabilities with no structure —
exactly the fragmentation the Manifesto's organization metaphor exists to prevent.

### Departments as separate processes or services

**Advantages:** genuine fault isolation, independent restart, independently upgradeable.

**Rejected** for the reasons in [Chapter 05](05-backend-architecture.md) — distributed debugging on
a single machine buys isolation we do not need at a cost we cannot afford. **The design deliberately
keeps the option open**: because departments already communicate only via events and never share
memory, extracting one to a separate process later is a transport change, not a rewrite.

### Departments as npm packages installed from a registry

**Advantages:** genuinely independent versioning and distribution; the natural path for a
third-party ecosystem.

**Rejected for first-party departments** because it means publishing a package every time you change
one — the multi-repo problem from [Chapter 04](04-monorepo-vs-multirepo.md) in miniature. **This is
exactly how third-party departments will work** when the plugin system arrives ([Chapter
15](15-plugin-system.md)); the manifest format is already designed to support it.

### Direct department-to-department calls with dependency injection

**Advantages:** simpler, faster, easier to trace, and familiar to most developers.

**Rejected** — this is the decision this chapter exists to make. Direct calls create a dependency
graph among departments, and a dependency graph means removal breaks things, replacement requires
coordination, and addition requires modifying existing code. Every property we want from
departments comes from *not* doing this.

### Departments owning their own data stores

**Advantages:** stronger encapsulation; a true bounded context in the DDD sense.

**Rejected** because it fragments your data across many stores, which makes backup, export, and
"show me everything FRIDAY knows about X" all much harder — and those are Article I and Article IV
requirements. Encapsulation is achieved instead by namespaced permissions
(`memory.write:communications`), which gives the isolation without fragmenting the data.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Event-based inter-department communication is slower** and less obvious than a direct call. | Accepted — sub-millisecond in-process, and it is the source of every property we want. |
| **Manifest maintenance is real overhead.** Every capability, event, and permission must be declared. | Accepted — the declarations are what make the system inspectable and enforceable. The friction is the review point. |
| **Cross-department workflows are harder to trace** in source code. | Accepted — mitigated by the live information-flow diagram generated from manifests, and by correlation IDs in the audit trail. |
| **Some duplication between departments** (each has its own error handling, retry patterns). | Accepted — shared helpers live in `packages/`, but a little duplication is preferable to coupling. |
| **`degradedMode` is extra design work per department.** | Accepted — it forces the Article VII conversation at design time rather than during an incident. |

---

## Review triggers

- More than ~15 departments → consider grouping into divisions
- A department consistently needs synchronous results from another → the boundary may be drawn wrong
- Third-party departments become real → adopt process isolation and package distribution
- A department's failure repeatedly degrades unrelated functionality → the isolation is not working
- Event-based coordination measurably dominates plan latency

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
