# ADR-0041 — ONE HUD is the dashboard grown up, not a second application

- **Status:** accepted — 2026-08-17
- **Date:** 2026-08-12
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **extends** [Chapter 26](../01-bible/26-dashboard-architecture.md)
- **Related:** [ADR-0009 — Tauri 2 for the desktop and mobile shells](0009-tauri-shells.md),
  [ADR-0029 — `apps/core` begins at Milestone 2 to serve the dashboard](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md),
  [ADR-0030 — Loopback identifies the owner's machine, not the owner's presence](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md),
  [Chapter 06 — Frontend Architecture](../01-bible/06-frontend-architecture.md),
  [`apps/web/README.md`](../../apps/web/README.md),
  [`packages/ui-kit/README.md`](../../packages/ui-kit/README.md)

---

## Context

The owner wants one screen he can leave open all day: dark, monospaced, instrument-panel dense,
showing system vitals, available capabilities and their status, today's schedule, audio input/output
state, and FRIDAY's live state — `IDLE`, `LISTENING`, `THINKING`, `SEARCHING MEMORY`, `RUNNING SKILL`,
`SPEAKING`. He called it FRIDAY's face, and he was specific that it must not fake any of it:

> Do not fake this state. It should come from the actual system.

That sentence is the reason this ADR is short. **It is the same requirement Chapter 26 already
imposes**, arrived at independently, and it does most of the work here.

### What already exists

`apps/web` is a real, working dashboard: 378 lines, a live event list and an approvals queue, reading
`apps/core` over tRPC with a shared `AppRouter` type and no server code in the bundle
([ADR-0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)). It is thin, and it is
the correct shape.

[Chapter 26](../01-bible/26-dashboard-architecture.md) specifies four layers of progressive
disclosure — ambient menu bar, overview, detail, forensic — organized around one idea:

> Nothing is hidden. Not everything is shown.

### The apparent conflict, and why it is smaller than it looks

Chapter 26's Layer 2 mock is calm and sparse. The owner's HUD is dense. That reads as a
contradiction, and it mostly is not: **the HUD's density is nearly all Layer 1 and Layer 2 content
that Chapter 26 splits across a menu bar and a home screen.** Vitals, current state, what needs you,
what is happening now — the chapter's own Layer 2 mock already carries all four.

Where they genuinely differ is *persistence*: Chapter 26 assumes a screen you visit, and the owner
wants one he never closes. An always-open surface has a stricter obligation than a visited one,
because anything that moves on it will be seen a thousand times — which argues for **more** calm than
Chapter 26 requires, not less.

### What we did not know

Whether the owner wanted a replacement for the dashboard or an evolution of it. Asked on 2026-08-12,
he chose evolution, and asked that Chapter 26's progressive-disclosure philosophy be preserved rather
than overwritten.

---

## Decision

We will **grow `apps/web` into ONE HUD. No second application, no state of its own, and no panel that
is not backed by something FRIDAY actually recorded.**

### 1. One surface

The HUD is `apps/web`, extended. Shared components land in `packages/ui-kit` as its charter already
specifies, so the Tauri shell ([ADR-0009](0009-tauri-shells.md)) and the phone render the same
approval screen.

**A second UI application is prohibited by this decision**, for the reason `ui-kit`'s charter already
gives about approval screens: *"a drifting approval screen misdescribes what you are authorizing."*
Two faces drift. The one that drifts is the one the owner is not looking at, and he will not know
which that is.

### 2. Every panel maps to something recorded

**★ The load-bearing rule, and the acceptance test for every future panel:**

> If the HUD can display it, an event or a core query produced it. If FRIDAY has not recorded it, the
> HUD does not show it — not as a placeholder, not as a guess, not as a spinner implying work.

So a `RUNNING SKILL` indicator requires a `skill.started` event to exist first. A vitals number
requires something that computes and records it. The panel is built *after* the event, never before,
and a panel with no source is not a UI task but a missing event contract.

This is what makes the owner's "do not fake this state" enforceable rather than aspirational: faking
becomes impossible without first writing a fake event, which is visible in a diff and refused by
review.

### 3. Progressive disclosure is preserved, with the HUD as Layer 2

Chapter 26's four layers stand. The HUD **is** Layer 2, made denser and made persistent. Every tile
opens into Layer 3, and Layer 4 remains reachable — the owner's requirement that the HUD "prioritize
useful information over decoration" and Chapter 26's "nothing is hidden, not everything is shown" are
the same instruction.

Two rules follow from always-open that Chapter 26 did not need:

- **Nothing animates without meaning.** A pulse means work is happening; it does not mean the page is
  alive.
- **Nothing moves that the owner is not being asked to look at.** Layout stability beats density when
  they conflict — a number that relocates when a list grows is a number he has to hunt for.

### 4. It renders decisions; it never makes them

The HUD never decides whether an action is permitted — it displays the Guardian's decision, and
approvals go through the same path as any other client
([ADR-0005](0005-guardian-sole-authorization.md), [ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md)).
It holds no store beyond a request cache: **reloading it must produce identical state**, which is the
cheap test that it has not started keeping its own truth.

### 5. What each panel actually needs — and why most of it is not buildable yet

| Panel | Source | Available |
|---|---|---|
| Live events | `events.list` over tRPC | **today** |
| Approvals | `approvals.pending` / `respond` | **today** |
| System vitals | `packages/diagnostics` — empty directory | M5+ |
| FRIDAY state | plan and capability events — none exist | M5 |
| Capabilities and status | department manifests (ADR-0040) — none exist | M5 |
| Memory / context | memory interface (ADR-0039) — empty directory | M5–M7 |
| Schedule | a calendar connector — none exists | M6 |
| Voice state | `packages/voice` — empty directory | M7 |

**★ Two of eight panels can be built today, and both already are.** Everything that makes the HUD
feel like a face depends on layers that do not exist. This is the concrete reason the HUD is last in
the implementation order, and it is recorded here so that a future session tempted to build the
beautiful empty version finds the argument against it — a HUD full of zeroes and `—` teaches the
owner to stop looking at it, and that habit is expensive to reverse.

---

## Constitutional review

- **Article II (Transparency):** the HUD is the primary instrument of it. §2 is what keeps it honest
  rather than decorative.
- **Article III (Approval):** unchanged — §4 keeps the HUD a client of the Guardian, never a peer.
- **Article IX (Respect):** an always-open surface can disrespect attention continuously. §3's two
  rules exist for that.
- **Principle 10 (Simplicity Wins):** one surface, extended, rather than a second application.

**The five questions:**

- [x] **Can the user see it?** — it is the seeing.
- [x] **Can the user stop it?** — approvals route unchanged; the HUD initiates nothing on its own.
- [x] **Can we replace it?** — it reads a typed API. A different HUD against the same `AppRouter`
      requires no core change, which is the owner's acceptance test 8.
- [x] **Can we explain it?** — every panel traces to an event or a query by construction (§2).
- [ ] **Will this still be right in five years?** — **the rules will; the layout will not.** An
      instrument panel is a strong aesthetic commitment, and §3's stability rules will be tested by
      the first panel that genuinely needs to move.

---

## Alternatives considered

### A. A separate HUD application

**What it is.** A new `apps/hud`, built for the instrument-panel design, leaving `apps/web` as the
administrative dashboard.

**Advantages.** No compromise between two visual languages. Free to use a different stack — a
terminal UI, a full-screen kiosk view — without disturbing a working dashboard. Ships faster,
because nothing existing must be respected.

**Why rejected.** Two surfaces showing the owner's system will disagree, and `ui-kit`'s charter names
the specific harm: an approval screen that drifts misdescribes what is being authorized. It also
doubles the work at every future change, and the second copy is always the stale one.

### B. Replace Chapter 26 wholesale with the instrument panel

**What it is.** Amend Chapter 26; progressive disclosure gives way to density.

**Advantages.** Honest about what is being built, rather than claiming an evolution while designing
something different. Density genuinely suits a technical owner who wants status at a glance.

**Why rejected.** The four layers are not an aesthetic preference — they are how "nothing is hidden"
coexists with "calm, not noisy". Density is a Layer 2 property and this decision adopts it there; the
menu bar, the detail view, and the forensic view are untouched and still needed. **The owner chose
this himself**: preserve the philosophy, evolve the surface.

### C. A terminal HUD

**What it is.** A TUI. Monospaced by nature, trivially always-open, no browser.

**Advantages.** Closest to the owner's stated aesthetic, cheapest to build, and it would run over SSH.
Genuinely attractive.

**Why rejected as the primary face.** Approvals require *seeing* the artifact — a draft, a diff, an
amount — and Chapter 26's Layer 4 is a causal graph. A terminal renders neither. **Worth revisiting as
a Layer 1 companion** alongside the menu bar, where its strengths are all that is needed.

### D. Menu bar only

**What it is.** Chapter 26's Layer 1, and nothing persistent beyond it.

**Advantages.** Calmest possible. Zero screen cost.

**Why rejected.** Five states in an icon is a health indicator, not a face. It does not meet the
owner's requirement to see what FRIDAY is doing. It remains Layer 1, unchanged and still wanted.

---

## Consequences

**Positive**

- One face, one component library, one approval screen across every surface.
- §2 makes dishonest UI structurally difficult rather than merely discouraged.
- The existing dashboard, its tests, and its tRPC contract are preserved and extended.
- Replacing the HUD later costs nothing in core — the owner's acceptance test 8 holds by construction.

**Negative**

- **The HUD is mostly unbuildable until M5–M7.** Six of eight panels have no source. The owner's most
  visible want is gated behind the least visible work, and that gap is where the temptation to fake
  state will live.
- **Density and calm are in permanent tension**, and §3's rules will be argued about at every panel.
  This ADR sets a direction, not a spec.
- **An always-open surface raises the cost of every visual change**, because the owner sees each one
  a thousand times.
- **`apps/web` grows well past 378 lines**, and a dashboard that becomes a face is a package that
  needs its own structure. That work is unscoped here.

**Neutral**

- Chapter 26 is extended rather than amended; both documents stand and §3 reconciles them.
- The Tauri shell is unaffected — it wraps whatever `apps/web` is.

---

## Reversibility

- **Cost to reverse:** low.
- **How:** the HUD is a client of a typed API. A different face against the same `AppRouter` changes
  nothing behind it, which is the property the owner asked to verify.
- **Point of no return:** none for the HUD. §2 is the rule with a one-way cost — the first panel
  allowed to display something FRIDAY did not record establishes that panels may be decorative, and
  that is a norm rather than a line of code.

---

## Review triggers

- **Any panel proposed without a recorded source.** §2 is this ADR's entire content; a request to
  relax it is a request to replace it.
- **The HUD is built before M5 delivers state to show.** It will look finished and be empty.
- **The owner stops leaving it open.** The most informative signal available, and it means §3's rules
  failed rather than that the design was wrong.
- **A second UI application is proposed** for any reason — re-read Alternative A first.
- **`apps/web` exceeds what one package should hold.** A structural decision, and its own ADR.
- **Voice arrives (M7)** and the audio-state panel needs sub-second updates that tRPC polling cannot
  serve. That is a transport question this ADR does not answer.

---

## Notes

**This ADR is short because the owner's brief and Chapter 26 mostly agree.** Both want a single
honest surface over real state, and both refuse decoration. The genuine decisions here are three: one
application rather than two (§1), no panel without a source (§2), and the HUD as a denser Layer 2
rather than a replacement for the layers (§3).

**Uncertainty**, ranked:

1. **That density and progressive disclosure reconcile as cleanly as §3 claims.** I have argued the
   conflict is mostly apparent. It may not be, and the place it will show is the first screen holding
   eight live panels — which nobody has seen, because six of them have no data.
2. **That §5's ordering survives contact with wanting the thing.** The pull toward building the face
   early is strong, and the argument against it is written here precisely because I expect it to be
   tested.
3. **Whether a terminal companion (Alternative C) should exist alongside the menu bar.** I have left
   it open rather than deciding it, and it is the alternative I find most likely to come back.
