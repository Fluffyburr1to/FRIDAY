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
| [0019](0019-the-hash-chain-is-computed-inside-the-append-transaction.md) | The hash chain is computed inside the append transaction | accepted | medium | [09](../01-bible/09-database-design.md) |
| [0020](0020-key-material-comes-from-an-injected-key-provider.md) | Key material comes from an injected key provider | accepted | low | [09](../01-bible/09-database-design.md) |
| [0021](0021-the-cli-reads-the-event-log-in-process-until-m3.md) | The CLI reads the event log in-process until M3 | accepted | low | [34](../01-bible/34-disaster-recovery.md) |
| [0022](0022-toml-for-the-configuration-file.md) | TOML for the configuration file | accepted | low | [33](../01-bible/33-deployment-strategy.md) |
| [0023](0023-rotating-file-stream-for-log-rotation.md) | `rotating-file-stream` for log rotation | accepted | low | [22](../01-bible/22-logging-standards.md) |
| [0024](0024-compaction-and-archival-are-milestone-2.md) | Compaction and archival are Milestone 2 work | accepted | low | [10](../01-bible/10-event-bus.md) |
| [0025](0025-policy-evaluation-is-order-independent-and-fails-closed.md) | Policy evaluation is order-independent and fails closed | accepted | medium | [17](../01-bible/17-authentication-authorization.md) |
| [0026](0026-capability-tokens-are-signed-handles-to-kernel-state.md) | Capability tokens are signed handles to kernel state | accepted | low | [17](../01-bible/17-authentication-authorization.md) |
| [0027](0027-the-guardians-stores-are-ports-that-can-fail.md) | The Guardian's stores are ports that can fail | accepted | medium | [30](../01-bible/30-coding-standards.md) |
| [0028](0028-the-chain-covers-a-payload-digest-and-is-segmented.md) | The integrity chain covers a payload digest, and is segmented | accepted | **high** | [10](../01-bible/10-event-bus.md) |
| [0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md) | `apps/core` begins at Milestone 2 to serve the dashboard | accepted | low | [26](../01-bible/26-dashboard-architecture.md) |
| [0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md) | Loopback identifies the owner's machine, not the owner's presence | accepted | low* | [17](../01-bible/17-authentication-authorization.md) |
| [0031](0031-the-clerk-records-what-the-guardian-decided.md) | The clerk records what the Guardian decided | accepted | low | [10](../01-bible/10-event-bus.md) |
| [0032](0032-the-guardians-state-moves-into-the-event-log-database.md) | The Guardian's state moves into `events.db` | accepted | low→**high** | [09](../01-bible/09-database-design.md) |

\* **Low cost to reverse technically, but constitutional in effect.** These encode founding
guarantees rather than engineering convenience. Changing any of them is a change to what FRIDAY
promises, and requires a new ADR making that explicit — never a quiet edit.

The mark is not confined to the seed ADRs. 0030 carries it because "local access is not presence" is
a promise about Article III rather than an engineering preference — relaxing it would widen what can
be approved without the owner, which is precisely the kind of change that must be argued in the open
rather than adjusted in a settings file.

### Where the real risk sits

Three entries are worth watching more than the rest:

- **0011 (plan engine)** — Temporal is genuinely the stronger tool and we chose to build a small
  version instead. That is the most defensible-but-arguable call in the set.
- **0009 (Tauri)** — the only decision resting on a technology whose maturity is unproven for our
  case. It is also the cheapest to reverse, which is why it was an acceptable bet. The M7 spike is
  the checkpoint.
- **0032 (the Guardian's state moves to `events.db`)** — the only entry whose reverse cost *changes
  over time*, which is what `low→high` in the table means. Today there is no data, so reversing is
  the same one-line edit that applied it. After the owner's first real approval, reversing means
  copying populated tables between two SQLite files — itself non-atomic, and needing its own
  recovery procedure. The window is open now and closes on first use.

---

## Numbering

Sequential, four digits, never reused, never renumbered. `docs/adr/0014-choose-tauri.md` is a
permanent address that other documents link to.

**Numbers are claimed on the branch, not on `main`.** The dashboard work branched before the
conscience work merged, so 0025–0028 did not yet appear in this index — and it took 0029 rather than
the next number visible to it, because reusing 0025 would have collided when the two branches met
and renumbering afterwards is forbidden by the rule above.

The index looked wrong for a while and then came right, which is the correct trade: a temporary gap
costs a reader one moment of confusion, and a renumbered ADR breaks every link to it forever. When
several branches are open at once, take the number after the highest claimed **anywhere**, not the
highest merged.
