# src-tauri — the Rust shell

**The only Rust in FRIDAY, and it should stay small enough to read in one sitting.**

## What lives here

`lib.rs` opens a window. That is the whole program.

`tauri.conf.json` says where the window points — `http://127.0.0.1:7420`, the origin `apps/core`
serves — and what the web view is allowed to reach.

## What must NOT live here

★ **Anything that asserts the owner is present.** No IPC command, no Touch ID call, no signed
timestamp. [ADR-0052](../../../docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md) §4 and
§5 must land together before any of that exists, and §5 — a device key core can verify — is what
makes §4 more than a claim.

**Any FRIDAY logic.** If this shell were rewritten in something else, nothing about FRIDAY would
change. That is the test for whether code belongs here.

**Anything that talks to the API.** The web view does that, over the same origin a browser would.
Rust sitting in the request path could read or alter an approval, and there is no reason for it to.

## Why Rust is here at all

Tauri's shell is Rust ([Chapter 07](../../../docs/01-bible/07-desktop-strategy.md)), which is in
tension with the one-language decision. The chapter accepts that trade for the system web view and
names Electron as the fallback. Keeping this file tiny is how the trade stays worth it.
