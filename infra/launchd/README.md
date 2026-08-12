# launchd — Keeping FRIDAY Alive

`com.friday.core.plist` — the macOS LaunchAgent definition. Installed to
`~/Library/LaunchAgents/`.

See [infra/README.md](../README.md) for the settings and the sleep/wake behavior.

## Why a LaunchAgent rather than a LaunchDaemon

A LaunchAgent runs as **you**, in your login session, with access to **your Keychain**. A
LaunchDaemon runs as root at boot, which would mean FRIDAY holds more privilege than she needs and
cannot reach the Keychain entries protecting your credentials.

Least privilege (Article V), applied at the level of process ownership.

## Commands

```bash
launchctl load   ~/Library/LaunchAgents/com.friday.core.plist
launchctl unload ~/Library/LaunchAgents/com.friday.core.plist
launchctl list | grep friday
```

---

## Installing and removing it

```bash
friday service install     # writes the plist, loads the agent, prints what undoes it
friday service uninstall   # unloads and removes it
```

**The plist is generated, never copied.** `com.friday.core.plist.tmpl` is a template; the command
fills in the absolute paths of the copy of FRIDAY it is running from. A plist copied between
machines carries the paths of the one that built it.

**It only installs from an installed FRIDAY.** Run from a source checkout the command refuses, because
a service pointing into a working tree breaks the moment that tree moves or is rebuilt. Build one with
`node tools/scripts/release.ts`.

**Uninstall proves ownership before deleting.** The `Label` must be `com.friday.core` *and* the
program path must point at a FRIDAY. A file it cannot account for is left exactly where it is.

**Nothing secret is in the plist, and there is no `EnvironmentVariables` block to put one in.** A plist
is world-readable and survives in backups; key material reaches FRIDAY through the Keychain only.

## What has been demonstrated

| | |
|---|---|
| **Automatically tested** | The rendered plist's settings, that no placeholder survives, that nothing secret is in it, that installing from a checkout is refused, and that the deletion guard rejects a file FRIDAY did not write. Portable — runs on the Linux CI runner. |
| **Manually demonstrated on macOS** | `plutil -lint` accepts the generated plist, and `plutil -p` parses every key as intended. Path resolution and rendering were exercised against a real extracted artifact. |
| **Not yet demonstrated** | `launchctl load`, starting at login, surviving a logout, and the locked-Keychain race. **The race is not solved** — the diagnostics now describe it, which is not the same as having met it. |
