# Architecture Decision Records

One decision per file. **Permanent. Immutable. Never edited.**

When a decision changes, write a new ADR that supersedes the old one and update the old one's
`Status` line only. Both remain. The record shows what was true at the time and why it changed —
which is far more useful than a document quietly kept current that now implies you always thought
this.

**Rejected ADRs are kept and numbered.** Without them, the same idea gets re-proposed every eighteen
months by someone who does not know it was already considered.

Process and template rationale: [Chapter 37](../01-bible/37-adr-process.md).
Template: [`0000-template.md`](0000-template.md).

---

## Index

Seed ADRs — to be written at Milestone 0, extracting the decisions already reasoned through in the
Project Bible so each is individually addressable.

| # | Title | Status | Bible chapter |
|---|---|---|---|
| [0001](.) | TypeScript everywhere | planned | [02](../01-bible/02-technology-stack.md) |
| [0002](.) | Monorepo with pnpm and Turborepo | planned | [04](../01-bible/04-monorepo-vs-multirepo.md) |
| [0003](.) | SQLite as the primary datastore | planned | [09](../01-bible/09-database-design.md) |
| [0004](.) | Event-sourced core with a SQLite-backed bus | planned | [10](../01-bible/10-event-bus.md) |
| [0005](.) | The Guardian as the sole authorization point | planned | [19](../01-bible/19-approval-system.md) |
| [0006](.) | Capability-based authorization, not RBAC | planned | [17](../01-bible/17-authentication-authorization.md) |
| [0007](.) | No agent framework — build the runtime | planned | [11](../01-bible/11-agent-framework.md) |
| [0008](.) | Model Router; no vendor named in core | planned | [02](../01-bible/02-technology-stack.md) |
| [0009](.) | Tauri for desktop and mobile shells | planned | [07](../01-bible/07-desktop-strategy.md) |
| [0010](.) | Departments communicate only via events | planned | [13](../01-bible/13-department-architecture.md) |
| [0011](.) | Plan engine as a durable state machine, not a loop | planned | [12](../01-bible/12-chief-of-staff.md) |
| [0012](.) | Standing grants must expire | planned | [19](../01-bible/19-approval-system.md) |
| [0013](.) | Local-only speech processing | planned | [25](../01-bible/25-voice-architecture.md) |
| [0014](.) | Human approval on every merge | planned | [31](../01-bible/31-git-workflow.md) |
| [0015](.) | Local-only observability | planned | [29](../01-bible/29-monitoring-observability.md) |

---

## Numbering

Sequential, four digits, never reused, never renumbered. `docs/adr/0014-choose-tauri.md` is a
permanent address that other documents link to.
