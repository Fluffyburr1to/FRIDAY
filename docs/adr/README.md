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

The seed ADRs extract the decisions already reasoned through in the Project Bible, so each is
individually addressable and can be superseded on its own rather than as part of a chapter.

| # | Title | Status | Reverse | Bible |
|---|---|---|---|---|
| [0001](0001-typescript-everywhere.md) | TypeScript across the entire stack | accepted | high | [02](../01-bible/02-technology-stack.md) |
| [0002](0002-monorepo.md) | Single monorepo with pnpm and Turborepo | accepted | medium | [04](../01-bible/04-monorepo-vs-multirepo.md) |
| [0003](0003-sqlite.md) | SQLite as the primary datastore | accepted | medium | [09](../01-bible/09-database-design.md) |
| [0004](0004-event-sourced-core.md) | Event-sourced core with a SQLite-backed bus | accepted | high | [10](../01-bible/10-event-bus.md) |
| [0005](0005-guardian-sole-authorization.md) | The Guardian as the sole authorization point | accepted | high | [19](../01-bible/19-approval-system.md) |
| [0006](0006-capability-based-authorization.md) | Capability tokens rather than RBAC | accepted | med-high | [17](../01-bible/17-authentication-authorization.md) |
| [0007](0007-no-agent-framework.md) | Build the agent runtime rather than adopt a framework | accepted | medium | [11](../01-bible/11-agent-framework.md) |
| [0008](0008-model-router.md) | Vendor-neutral Model Router | accepted | low | [02](../01-bible/02-technology-stack.md) |
| [0009](0009-tauri-shells.md) | Tauri 2 for the desktop and mobile shells | accepted | **low** | [07](../01-bible/07-desktop-strategy.md) |
| [0010](0010-departments-communicate-via-events.md) | Departments communicate only via events | accepted | low | [13](../01-bible/13-department-architecture.md) |
| [0011](0011-plan-engine-state-machine.md) | Plan engine as a durable state machine, not a loop | accepted | medium | [12](../01-bible/12-chief-of-staff.md) |
| [0012](0012-standing-grants-expire.md) | Every standing grant must expire | accepted | low* | [19](../01-bible/19-approval-system.md) |
| [0013](0013-local-only-speech.md) | Speech processing is local-only | accepted | low* | [25](../01-bible/25-voice-architecture.md) |
| [0014](0014-human-approval-every-merge.md) | FRIDAY proposes; the owner approves every merge | accepted | low* | [31](../01-bible/31-git-workflow.md) |
| [0015](0015-local-only-observability.md) | Observability is local-only | accepted | low* | [29](../01-bible/29-monitoring-observability.md) |

Decisions taken since, as implementation met the design:

| # | Title | Status | Reverse | Bible |
|---|---|---|---|---|
| [0016](0016-build-configuration-is-outside-the-boundary-graph.md) | Build configuration is outside the boundary graph | accepted | low | [03](../01-bible/03-repository-structure.md) |
| [0017](0017-shared-tool-configuration-packages.md) | `tools/<tool>-config` is a pattern, not a closed list | accepted | low | [03](../01-bible/03-repository-structure.md) |
| [0018](0018-better-sqlite3-as-the-sqlite-driver.md) | `better-sqlite3` as the SQLite driver | accepted | medium | [09](../01-bible/09-database-design.md) |

\* **Low cost to reverse technically, but constitutional in effect.** These four encode founding
guarantees rather than engineering convenience. Changing any of them is a change to what FRIDAY
promises, and requires a new ADR making that explicit — never a quiet edit.

### Where the real risk sits

Two entries are worth watching more than the rest:

- **0011 (plan engine)** — Temporal is genuinely the stronger tool and we chose to build a small
  version instead. That is the most defensible-but-arguable call in the set.
- **0009 (Tauri)** — the only decision resting on a technology whose maturity is unproven for our
  case. It is also the cheapest to reverse, which is why it was an acceptable bet. The M7 spike is
  the checkpoint.

---

## Numbering

Sequential, four digits, never reused, never renumbered. `docs/adr/0014-choose-tauri.md` is a
permanent address that other documents link to.
