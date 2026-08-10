# apps/cli — friday

**The tool you reach for when the interface is unavailable.**

Milestone: **M1** — the first thing you can actually run

## Charter

A terminal client over the same tRPC API the apps use. Connects over a local Unix socket, so only a
process running as you can reach it.

## Commands

```
friday init                      set her up on this machine, once
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

1. **The recovery commands must work when everything else is broken.** No dependency on the
   dashboard, on any department, or on anything that could itself be the thing that has failed.

   The test is *what could take this command down with it*, not how long the dependency list is.
   `@friday/guardian` is here because `friday init` copies the shipped authorization rules out of it
   ([ADR-0035](../../docs/adr/0035-first-run-provisioning-is-creation-only.md)); it is pure, decides
   nothing at import time, and cannot fail in a way that stops `friday verify` from running. A
   workspace dependency that meets that bar is allowed. One that would make a recovery command
   depend on the health of the thing being recovered is not — and neither is an extra abstraction
   introduced only to keep the list looking short.
2. **`panic` runs without confirmation.** A confirmation prompt during a compromise is the wrong
   design.
3. **Every command is authorized by the Guardian**, exactly like any other surface. The CLI is not a
   back door.

   **`friday init` is the one exception, and it is bounded by what it cannot do.** It runs before a
   Guardian can exist — composing one needs the authorization rules and the capability signing key,
   which are two of the three things it creates — so asking permission first is not stricter, it is
   impossible. What keeps this from being a back door is that init **only creates**: it may bring the
   policy directory, the field-encryption key, and the capability signing key into existence, and it
   cannot overwrite, merge, delete, or author any of them. A command that cannot alter anything that
   already exists has no power over a FRIDAY that already exists. It also writes no events, issues no
   capability, and creates no standing grant.
   See [ADR-0035](../../docs/adr/0035-first-run-provisioning-is-creation-only.md).
4. **Output is human-readable by default, `--json` for machines.**

Reference: [Chapter 34](../../docs/01-bible/34-disaster-recovery.md)
