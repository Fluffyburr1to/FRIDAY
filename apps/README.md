# apps/ — Things That Run

Each app has an entry point, a lifecycle, and a process. Libraries live in
[`packages/`](../packages/).

**Apps may import from anywhere.** They are the top of the dependency graph — they compose. Nothing
imports from an app.

---

## The applications

| App | What it is | Milestone |
|---|---|---|
| **core** | The kernel service. **FRIDAY herself.** Runs as a `launchd` agent on the host Mac, at login, always. | M1 |
| **cli** | `friday` — status, diagnostics, recovery, `safe-mode`, `panic`. The tool you reach for when the UI is unavailable. | M1 |
| **web** | The dashboard. Served by core at localhost. **Also the UI that both shells load.** | M2 |
| **desktop** | Tauri shell — menu bar, global hotkey, native notifications, keychain, updater. | M4 |
| **mobile** | Tauri mobile shell — iOS first. Exists primarily to make Article III practical when you are away from your desk. | M7 |

---

## The relationship between core and the shells

**The apps are not FRIDAY. `core` is FRIDAY.**

The desktop app is a window into her. Close it and she keeps working. Quit it and she keeps working.
`launchd` supervises `core` and restarts it within seconds if it dies.

This separation is what lets FRIDAY act on schedules, watch for things, and be reachable from your
phone. It also means a broken app update cannot stop her — you can still reach her from a browser or
the CLI.

```
┌──────────────────────────────────────────────┐
│  friday-core   ← the service; always running │
│  supervised by launchd                       │
└────────────────┬─────────────────────────────┘
                 │ localhost, authenticated
     ┌───────────┼───────────┬──────────┐
     ▼           ▼           ▼          ▼
  desktop      mobile       web        cli
              (shells load apps/web)
```

**`apps/web` is the only UI codebase.** Desktop and mobile are thin shells around it. This is
deliberate: three separate implementations of the approval screen would drift, and a drifting
approval screen is a safety problem, not a cosmetic one
([Chapter 06](../docs/01-bible/06-frontend-architecture.md)).

---

## Rules

1. **Apps contain composition and platform integration — never business logic.** If logic would be
   useful to a second app, it belongs in a package.
2. **The shells contain no FRIDAY logic at all.** Tray icons, hotkeys, notifications, keychain
   access. Nothing else.
3. **`src-tauri/` Rust must stay under 500 lines.** Exceeding it means the shell is doing too much;
   move the logic into core ([Chapter 07](../docs/01-bible/07-desktop-strategy.md)).
4. **No app owns truth.** Everything displayed comes from core. The frontend never decides anything,
   least of all whether an action is permitted.
