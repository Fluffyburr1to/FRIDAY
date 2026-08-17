# apps/web — The Dashboard

**The only UI codebase in FRIDAY — and, since ADR-0041, her face.**

Milestone: **M2** (thin) → **M6** (full)

Run it with `pnpm hud`. How it is put together, how to add a section, and how voice will eventually
rearrange it: [`docs/guides/how-to/hud.md`](../../docs/guides/how-to/hud.md).

Served by `core` at localhost, and loaded by both the desktop and mobile shells. Write a screen
once; it appears everywhere.

## Charter

This is where Article II lives: *"every action should be observable through logs, dashboards, or
explanations."* A record nobody can read is not transparency.

## The four layers

| Layer | Content |
|---|---|
| **1 Ambient** | Menu bar — one glance, five states |
| **2 Overview** | What needs you · what is happening · today · organization health |
| **3 Detail** | Plan graph · "why?" · memory browser · privacy view |
| **4 Forensic** | Raw events, exact prompts, exact costs, causal graph, integrity status |

Most use lives in 1 and 2. Layer 4 exists so the answer to *"can I see exactly what happened?"* is
always yes. **Nothing is hidden. Not everything is shown.**

## Rules

1. **The interface owns no truth.** Everything comes from core. The UI never computes, caches
   authoritatively, or decides — least of all whether an action is permitted.
2. **Live by default.** No refresh button exists.
3. **"Needs you" is always first.** Article III depends on you noticing.
4. **Offline is a designed state**, not an error — last known data with a clear staleness marker.
5. **Every user-facing string goes through a translation function** from day one. English only for
   now; retrofitting i18n later is weeks of tedium.
6. **No panel without a source.** A panel is built *after* its event or query exists, never before
   ([ADR-0041 §2](../../docs/adr/0041-one-hud-is-the-dashboard-grown-up.md)). Three panels are drawn
   today; the surfaces waiting on M5–M7 subsystems are documented, not rendered as placeholders.

Reference: [Chapter 26](../../docs/01-bible/26-dashboard-architecture.md)
