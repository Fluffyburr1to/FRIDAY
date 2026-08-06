# apps/cli — friday

**The tool you reach for when the interface is unavailable.**

Milestone: **M1** — the first thing you can actually run

## Charter

A terminal client over the same tRPC API the apps use. Connects over a local Unix socket, so only a
process running as you can reach it.

## Commands

```
friday status                    is she healthy?
friday events tail               watch the event log live
friday verify                    check the audit hash chain
friday plans list | show <id>    what is she doing?
friday explain <id>              why did she do that?
friday approvals list | respond  approve or decline from the terminal
friday memory search | forget    inspect and correct what she knows

friday safe-mode                 ★ halt agents and connectors, keep the dashboard
friday panic --revoke-all        ★ revoke every credential, immediately, no prompt
friday rollback                  restore the previous version + snapshot
friday restore --point-in-time   recover to a moment
friday export --all              take your data and leave
```

## Rules

1. **The recovery commands must work when everything else is broken.** Minimal dependencies, no
   dependency on the dashboard or any department.
2. **`panic` runs without confirmation.** A confirmation prompt during a compromise is the wrong
   design.
3. **Every command is authorized by the Guardian**, exactly like any other surface. The CLI is not a
   back door.
4. **Output is human-readable by default, `--json` for machines.**

Reference: [Chapter 34](../../docs/01-bible/34-disaster-recovery.md)
