# apps/core — friday-core

**The kernel service. This is FRIDAY.**

Milestone: **M1**

Runs as a `launchd` LaunchAgent on the host Mac: starts at login, restarts within seconds if it
dies, and keeps running whether or not any window is open.

## What lives here

- Process bootstrap and dependency wiring
- The tRPC API server and WebSocket event stream
- Static serving of `apps/web`
- Sidecar process supervision (whisper, Piper, Ollama)
- Signal handling, graceful drain, sleep/wake handling, Safe Mode entry

## What does NOT

- **Any business logic.** This app is composition only. Everything of substance lives in
  `packages/` and `departments/`.

## Rules

1. **Startup validates configuration and database integrity.** Failure → Safe Mode with an
   explanation, never a silent partial start.
2. **Graceful shutdown checkpoints in-flight plans** so nothing is lost on sleep or restart.
3. **`Nice 5`** — FRIDAY yields to your foreground work.
4. **Five crashes in 60 seconds → Safe Mode**, not an infinite restart loop.

Reference: [Chapter 05](../../docs/01-bible/05-backend-architecture.md)
