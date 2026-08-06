# ADR-0009 — Tauri 2 for the desktop and mobile shells

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 07](../01-bible/07-desktop-strategy.md), [Bible 08](../01-bible/08-mobile-strategy.md)

## Context

FRIDAY needs a Mac application, an iPhone application, and a web dashboard. The owner set a
one-language-everywhere constraint. Tauri's shell is written in Rust, which bends that constraint —
so this decision needs to be made deliberately rather than by default.

## Decision

We will use **Tauri 2** as a thin shell around the single React application in `apps/web`, for both
desktop and mobile.

**Hard limit: `src-tauri/` Rust must stay under 500 lines.** Exceeding it means the shell is doing
too much, and the correct response is to move that logic into the core — never to accept more Rust.

**Documented fallbacks:** Electron for desktop, Capacitor for mobile. The React app is unchanged in
either case; only the shell is replaced.

## Constitutional review

- **Manifest ("technology that quietly disappears"):** ~10–15 MB and 60–100 MB memory, against
  Electron's ~150 MB and 200–400 MB. On a laptop also running FRIDAY's core and local models, that
  difference is the difference between a background presence and something you notice.
- **Article V (Security):** Tauri requires explicitly allowlisting every shell capability — least
  privilege enforced by the framework rather than by discipline.

- [x] Can we replace it? — Yes, about a week, and no FRIDAY logic is touched.

## Alternatives considered

### Electron
**Advantages.** By far the most mature; enormous ecosystem; 100% TypeScript with zero Rust;
consistent rendering because it ships its own browser; better-documented OS integration.
**Why rejected.** Resource usage, a weaker default security posture, and — decisively — **no mobile
path at all**, which would force adopting a second, entirely different technology for iOS.
**Retained as the documented desktop fallback.**

### Native SwiftUI
**Advantages.** The best possible Mac and iOS experience. Instant launch, tiny memory, perfect
platform conventions, code shared between Mac and iPhone.
**Why rejected.** Swift is a second language, violating the owner's explicit constraint, and it
means a separate UI codebase that will drift from the web dashboard. It also strands Windows and
the browser entirely. **The strongest technical alternative here** — worth revisiting only if an
experienced Mac developer joins.

### Progressive Web App
**Advantages.** No shell to maintain, no distribution problem, no code signing.
**Why rejected.** Cannot deliver a persistent menu bar presence, a global hotkey that works when
unfocused, reliable native notifications, or Keychain access. Safari's PWA support on macOS is the
weakest of any major platform. **Kept as a supported access path** — the dashboard works in any
browser on the local network.

### Capacitor for mobile alongside Electron for desktop
**Advantages.** Both mature; zero Rust; Capacitor's mobile plugin ecosystem is better than Tauri's.
**Why not chosen.** Two shell technologies, two build systems, two plugin models. **This is the
fallback if the M7 spike fails** — and it is a close call, taken without hesitation if there is any
friction.

## Consequences

**Positive**
- One shell technology reaches macOS, iOS, Windows, Android, and the browser.
- Small, fast, and low-memory — appropriate for something always running.

**Negative**
- Rust exists in the repository, bending the one-language rule. Bounded, boilerplate, and fenced by
  a hard line limit.
- Tauri mobile is younger than Tauri desktop. **Mitigated by a timeboxed go/no-go spike at the start
  of M7**, before committing a milestone to it.
- Rendering differs subtly per platform, since each uses its own system web view.

## Reversibility

- **Cost to reverse:** low — about a week. The React app is untouched.

## Review triggers

- **The M7 spike fails any of its four questions** → switch to Capacitor immediately
- Desktop memory exceeds 250 MB at rest
- `src-tauri/` exceeds 500 lines → move logic to the core
- Tauri loses maintainer momentum → begin Electron migration planning
