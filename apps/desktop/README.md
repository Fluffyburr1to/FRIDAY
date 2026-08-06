# apps/desktop — FRIDAY.app

**A thin Tauri shell around `apps/web`.**

Milestone: **M4**

## Charter

The desktop app is a window into FRIDAY, not FRIDAY. Close it and she keeps working.

Four jobs, and nothing else:

1. Render the dashboard in the system web view
2. Live in the menu bar — health at a glance, pending approval count
3. Provide instant summon — global hotkey (`⌥Space`), 50 ms target
4. Bridge to macOS — notifications, Keychain, microphone, launch-at-login, auto-update

## What does NOT live here

**Any FRIDAY logic.** If the shell were rewritten in something else, nothing about FRIDAY would
change.

## Rules

1. **`src-tauri/` Rust stays under 500 lines.** Exceeding it means the shell is doing too much; move
   the logic into core. This is the fence around the one-language exception.
2. **Signed and notarized from the first release.** An unsigned Mac app is actively hard to open.
3. **Updates are signed and verified**, with the key held offline. The updater is a remote code
   execution channel into the machine holding your life.
4. **Updates are never silent.** Article III applies to FRIDAY updating herself.

Fallback if Tauri disappoints: Electron. The React app is unchanged; roughly a week of work.

Reference: [Chapter 07](../../docs/01-bible/07-desktop-strategy.md)
