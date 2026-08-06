# apps/web — The Dashboard

**The only UI codebase in FRIDAY.**

Milestone: **M2** (thin) → **M4** (full)

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

Reference: [Chapter 26](../../docs/01-bible/26-dashboard-architecture.md)
