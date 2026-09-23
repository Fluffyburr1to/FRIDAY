# apps/desktop — FRIDAY.app

**A window onto the core, and nothing more.**

Milestone: **M6**

## What this is

A Tauri shell that opens a native macOS window at `http://127.0.0.1:7420` — the address
`apps/core` already serves, where the dashboard and the API share one origin.

That is the whole shell. There is no bundled copy of the interface, no Rust that talks to the API,
and no command exposed to the web view.

## What it is deliberately not

★ **It is not trusted because it is native.**
[ADR-0052](../../docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md): a Tauri process
running as this user, talking to the same loopback port, is exactly as unprivileged as a browser
tab. Core cannot tell them apart, so `via: 'desktop'` would be a claim rather than evidence.

This shell therefore has **exactly the authority the browser has** — and structurally, not by
promise: it loads the same bytes from the same origin. High-risk approvals remain unanswerable in
it, as they are in the browser.

**It does not manufacture `authenticatedAt`.** There is no code path here that could. Adding one
requires ADR-0052 §4 *and* §5 — Touch ID **and** a device key core can verify — landing together.

## What it is not yet

Not built, and each is its own milestone: menu-bar presence, status indicator, pending-approval
badge, global hotkey, native notifications, close-to-tray, signing, notarization, auto-update.

The window also does not yet handle the core being unavailable — it will show whatever the web view
shows for a refused connection. Lifecycle is the next milestone.

## Running it

The core must be running and serving the dashboard. From the repository root:

```bash
pnpm --filter @friday/web build     # the interface the core serves
pnpm --filter @friday/desktop app:dev
```

`app:build` produces `FRIDAY.app`. Both need Rust; **neither runs in CI**, which has no Rust
toolchain — that is why they are not called `build`, so `turbo run build` does not pick them up. A
macOS build workflow arrives with the release pipeline.

The icons are **placeholders** — a solid square. Real branding is a design decision, not something
to invent in a build step.

## Its one rule

Closing this window must never stop FRIDAY. The core runs under `launchd`, started at login and
restarted if it dies. Article III requires an approval to survive waiting days; a window that took
the core with it would silently decline every approval waiting in it.

Reference: [Chapter 07](../../docs/01-bible/07-desktop-strategy.md) · [ADR-0052](../../docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md)
