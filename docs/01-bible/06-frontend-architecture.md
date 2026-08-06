# 06 — Frontend Architecture

> **Governing provisions:** Manifesto — The User Experience ("calm, not noisy"), Principle 2
> (Transparency), Principle 7 (Explainability), Principle 10 (Simplicity Wins); Constitution
> Article II, Article IX (Respect); Core Value 10.

---

## In plain language

The frontend is everything you see: the dashboard in a browser, the app on your Mac, the app on
your phone.

The central decision here is that **there is only one of them**. One codebase for the user
interface, which is then wrapped in different containers to become a website, a Mac application,
and an iPhone application. Write a screen once; it appears in all three.

The alternative — building the Mac app separately from the phone app separately from the website —
is what most companies do, and it requires roughly three times the work and three teams to keep in
sync. You have neither. More importantly, three separate interfaces drift: the approval screen on
your phone slowly stops matching the one on your Mac, and eventually one of them shows you
something misleading about an action you are being asked to authorize. For a system whose entire
premise is *informed consent*, interface drift is not a cosmetic problem. It is a safety problem.

The second decision is subtler and comes from your Manifesto: **the interface's job is to make
FRIDAY's thinking visible, not to hide it.** Most software hides complexity behind a clean surface.
FRIDAY must do something harder — feel calm and simple while making every action inspectable by
anyone who asks. Chapter 26 covers what that looks like; this chapter covers how it is built.

---

## Recommendation

A single React application in `apps/web`, built with Vite, styled with Tailwind, using Radix UI
primitives, sharing components from `packages/ui-kit` and types from `packages/contracts`.

That application is consumed three ways:

```
                    packages/contracts   (types shared with the backend)
                              │
                    packages/ui-kit      (shared components, design system)
                              │
                       apps/web          ← THE ONLY UI CODEBASE
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    served directly     Tauri desktop        Tauri mobile
    by friday-core      (Chapter 07)         (Chapter 08)
          │                   │                   │
      browser              Mac app           iPhone app
```

**Adaptive, not identical.** The same codebase, but layout and information density respond to
context. The Mac shows a dense multi-panel dashboard. The phone shows a focused single-column view
optimized for one thing: approving or declining something quickly, with enough context to decide
well. Same components, same data, same types — different composition.

---

## Why

### Why one codebase across all surfaces

**Consistency is a safety property here.** When FRIDAY asks permission to move money, the
explanation you read must be identical whether you are at your desk or on a train. Shared
components make that structural rather than a QA checklist item.

**Your capacity is the binding constraint.** Ten to twenty hours a week across four platforms is
not enough to maintain four interfaces. It is comfortably enough to maintain one.

**Type sharing extends all the way to the screen.** The `ApprovalRequest` type defined in
`packages/contracts` is the same type the Guardian uses, the same type the API returns, and the
same type the React component renders. Add a field to an approval and the compiler tells you
exactly which components must be updated — on every platform at once.

### Why React specifically

I want to be honest that this is not a "React is the best framework" argument. Svelte produces
smaller, faster applications with less ceremony. SolidJS has a better reactivity model. On pure
technical merit, React would not necessarily win.

React wins on three grounds that matter more here:

1. **AI assistants write correct React far more reliably than correct anything else**, because the
   training data is overwhelmingly React. Since AI assistants are writing most of this code, their
   accuracy rate in a given framework is a first-class engineering concern rather than an
   embarrassing one.
2. **Both shells target it natively.** Tauri and Capacitor both have first-class React paths.
3. **Ecosystem depth for the specific hard parts.** Virtualized lists for a million-row audit log,
   accessible dialog primitives, streaming data hooks — all exist, mature, in React.

Principle 10 says simplicity wins, and the simplest thing for *this project* is the thing the tools
building it understand best.

### Why Tailwind

Styles live in the component file. When a component moves, its styling moves with it — no orphaned
CSS accumulating in a stylesheet nobody dares delete. For a codebase that will be edited by
assistants with no memory of prior sessions, keeping a component's appearance and behavior in one
file materially reduces breakage.

The common objection — that the markup becomes cluttered with class names — is real. Mitigated by
extracting anything used more than twice into `packages/ui-kit`.

### Why Radix UI

Dialogs, dropdown menus, tooltips, and popovers are far harder to build correctly than they appear:
focus trapping, keyboard navigation, screen-reader announcements, click-outside behavior, scroll
locking. Getting these wrong makes an application unusable for people who rely on assistive
technology.

Radix provides the behavior and accessibility, unstyled, and we style it with Tailwind. Given a
founding document about respect and service, an inaccessible interface would be a contradiction we
should not ship.

---

## Architectural principles

### 1. The interface owns no truth

Every piece of information on screen comes from the backend and is displayed. The frontend never
computes something the backend should have computed, never caches something authoritative, and
never decides anything.

This matters more than it sounds. If the frontend decided that an action was low-risk and therefore
did not need approval, we would have two authorities on risk that could disagree — and the one on
the screen is the one an attacker can modify. **The Guardian's decision is the only decision.** The
UI renders it.

### 2. State is split by ownership, not by convenience

| State kind | Tool | Example |
|---|---|---|
| Server data | **TanStack Query** | plans, approvals, audit events, health |
| Live streams | **WebSocket → Query cache** | events arriving in real time |
| UI state | **Zustand** | which panel is open, sidebar collapsed |
| Form state | **React Hook Form + Zod** | approval responses, settings |
| URL state | **TanStack Router** | current view, filters, selected item |

The rule: **server data is never copied into client state.** Copying is how a screen ends up
showing a stale approval that was already granted. TanStack Query owns the cache, knows what is
stale, and refetches.

### 3. Real time by default

FRIDAY is a system that acts on her own. A dashboard that requires refreshing to show what she is
doing fails Article II in spirit. A single WebSocket connection streams events; arriving events
update the relevant query caches surgically. The audit log grows as you watch it.

### 4. Offline is a first-class state, not an error

The phone will be out of signal. The Mac will be asleep. The interface must handle "cannot reach
FRIDAY" as a designed state that shows the last known information with a clear staleness marker —
never a blank screen or a spinner that never resolves.

Article VII: fail gracefully, explain clearly.

### 5. Every consequential action shows its explanation before it is confirmed

Structural, not stylistic. Any component that triggers a consequential action must render the
Guardian's risk assessment and the reasoning alongside the confirm button. Principle 7:
"recommendations without explanations are commands."

---

## The calm interface

Your Manifesto's User Experience section is unusually specific, and it translates into concrete
frontend rules rather than vague intentions:

| Manifesto requirement | Implementation rule |
|---|---|
| "Calm. Not noisy." | Maximum one animated element on screen at a time. No animation without a state change to communicate. |
| "Only interrupt when appropriate." | The UI has no modal dialogs except for approvals. Everything else is ambient. |
| "Respect attention." | Nothing blinks, pulses, or plays sound below the `urgent` notification class. |
| "Make complexity disappear." | Progressive disclosure: a summary always, the full causal chain one click away, the raw events two. |
| "Increase confidence." | Every screen answers "is FRIDAY healthy right now?" without being asked. |
| "Communicate clearly." | Plain language in the interface. Internal terms (`plan.step.completed`) never surface to the user. |

The "one animated element" and "no modals except approvals" rules are enforced in code review and
are the kind of thing that erodes silently without a written rule.

---

## Accessibility and internationalization

**Accessibility is a requirement, not a phase.** WCAG 2.2 AA. Keyboard operable throughout, visible
focus, 4.5:1 contrast, respect for `prefers-reduced-motion`, and semantic HTML. Automated checks run
in CI (`axe-core` via Playwright); violations fail the build.

**Internationalization is prepared for but not implemented.** All user-facing strings go through a
translation function from day one, with English as the only locale. Retrofitting i18n into a
codebase with hardcoded strings is weeks of tedious work; doing it correctly from the start costs
almost nothing. This is Principle 6 — long-term thinking about a cheap decision made once.

---

## Alternatives considered

### Separate native applications (SwiftUI for Mac and iOS, etc.)

**Advantages:** the best possible platform integration, the best performance, the most native feel.
For a Mac-and-iPhone-first product, genuinely tempting.

**Rejected** because it means two additional languages (Swift, and later Kotlin), three codebases to
keep synchronized, and roughly triple the interface work. It directly violates your one-language
constraint. Most decisively, it reintroduces the drift problem: three implementations of the
approval screen is three chances for one of them to describe an action inaccurately.

### Svelte or SolidJS

**Advantages:** smaller bundles, faster runtime, less boilerplate, more elegant reactivity.

**Rejected** on ecosystem depth and — decisively — on AI assistant accuracy. This is an honest
pragmatism-over-elegance call. If you were writing the code yourself, Svelte would be a defensible
choice.

### Server-rendered HTML with HTMX or similar

**Advantages:** dramatically less JavaScript, simpler mental model, excellent for
document-shaped interfaces.

**Rejected** because FRIDAY's dashboard is a live-updating, stateful application — streaming events,
long-lived connections, interactive plan graphs — which is precisely where a client framework earns
its cost. It also has no path to a native mobile app.

### A meta-framework (Next.js, Remix)

**Rejected** because those exist to solve server-side rendering, SEO, and edge deployment. FRIDAY's
dashboard is a private application behind authentication; there is nothing to optimize for search
engines, and the server is your Mac. Vite gives us the build tooling without the server framework
we would not use.

### Separate mobile via React Native

**Advantages:** genuinely native mobile components; better platform feel than a webview.

**Rejected** as the primary path because it splits the codebase — React Native components are not
web components, so `apps/web` and `apps/mobile` would share types and logic but not screens. That
reintroduces the drift risk. **Retained as the documented fallback** if Tauri mobile proves
inadequate at Milestone 7 ([Chapter 08](08-mobile-strategy.md)).

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **The interface will not feel perfectly native** on any platform. A web-based Mac app is identifiably a web-based Mac app. | Accepted. Consistency and maintainability are worth more here than platform-idiomatic polish. Revisit only if it genuinely impedes use. |
| **React ships more JavaScript** than Svelte or Solid. | Accepted. Measured against the performance budget in [Chapter 35](35-performance-goals.md); the dashboard is a local application, not a page loaded over cellular. |
| **Adaptive layout is harder than separate layouts.** Making one component work well on a 27-inch monitor and a phone takes real thought. | Accepted. Much less total work than maintaining two. |
| **Tailwind clutters markup.** | Accepted; mitigated by extraction into `ui-kit`. |
| **Offline-first support is deferred.** The phone app initially requires connectivity to FRIDAY. | Accepted for M7, revisited at M8. Full offline sync is a large project and should not be undertaken speculatively. |

---

## Review triggers

- Tauri mobile proves inadequate during M7 → adopt React Native for `apps/mobile`, keeping
  `packages/contracts` and business logic shared
- Dashboard interaction latency exceeds the budget in Chapter 35 on target hardware
- Accessibility audit finds structural issues that component-level fixes cannot resolve
- A second interface developer joins, making separate native apps affordable

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
