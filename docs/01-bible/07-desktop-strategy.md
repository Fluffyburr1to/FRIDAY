# 07 — Desktop Strategy

> **Governing provisions:** Constitution Article IV (Privacy — local processing), Article VI
> (Modularity), Article IX (Respect); Manifesto — "the best interface is often the one that
> disappears," Principle 10 (Simplicity Wins).

---

## In plain language

The desktop app is FRIDAY's primary home. Your Mac is where her core runs, where her memory lives,
and where you will spend most of your time with her.

An important distinction, because it shapes everything: **the Mac app is not FRIDAY.** FRIDAY is
the core service running quietly in the background. The Mac app is a window into her. Close it and
she keeps working; open it and you see what she has been doing. This separation is what lets her
act on schedules, watch for things, and be reachable from your phone.

The choice here is *what kind of window*. There are three families: a truly native Mac app written
in Apple's language, a web page wrapped in a desktop container, or a hybrid. I am recommending the
wrapper, and this chapter explains why that is the right call rather than a concession.

---

## Recommendation

**Tauri 2** as the desktop shell, loading the React application from `apps/web`, with a native
system tray presence and a global keyboard shortcut for instant access.

The desktop application does four things and nothing else:

1. **Renders the dashboard** — the shared React app, in the system's built-in web view.
2. **Lives in the menu bar** — a small tray icon showing FRIDAY's health at a glance, with pending
   approval count. This is her ambient presence.
3. **Provides instant summon** — a global hotkey (default `⌥Space`) opens a focused command bar from
   anywhere, without switching applications.
4. **Bridges to the operating system** — native notifications, keychain access, microphone access,
   launch-at-login, and auto-update.

All logic stays in the core. The shell is deliberately thin — if it were rewritten in something
else, nothing about FRIDAY would change.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│  Your Mac                                            │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  friday-core  (background service via launchd) │  │
│  │  Runs at login. Survives the app being closed. │  │
│  └───────────────────┬────────────────────────────┘  │
│                      │ localhost, authenticated      │
│  ┌───────────────────▼────────────────────────────┐  │
│  │  FRIDAY.app  (Tauri)                           │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  WKWebView → apps/web (React)            │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │  Rust shell: tray · hotkey · notifications ·   │  │
│  │  keychain · updater · deep links               │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**The core is a separate process from the app on purpose.** If the app crashes, FRIDAY keeps
running. If you quit the app, she keeps running. `launchd` supervises the core and restarts it
within seconds if it dies. The app is disposable; the service is not.

---

## Why Tauri

### It uses the system's web view instead of shipping a browser

Electron — the obvious alternative — bundles an entire copy of Chromium into every application.
That means roughly 150 MB of download, 200–400 MB of memory at rest, and a browser engine you are
responsible for security-patching.

Tauri uses the web view already built into macOS (WKWebView), Windows (WebView2), and Linux
(WebKitGTK). The result is a **10–15 MB application using 60–100 MB of memory**, and the web engine
is patched by the operating system rather than by you.

For an application that sits in your menu bar all day on the same machine that runs FRIDAY's core,
AI inference, and everything else you do, that difference is not academic. It is the difference
between FRIDAY being a background presence and FRIDAY being a thing you notice in Activity Monitor.

### One shell technology reaches desktop and mobile

Tauri 2 added iOS and Android support. Choosing Tauri means the same shell approach, the same
plugin APIs, and the same build pipeline serve the Mac app and the iPhone app. Electron cannot do
this at all — it is desktop-only, so a mobile app would require adopting a second, entirely
different technology.

Given that you want Mac, iPhone, web, and eventually Windows and Android, this is decisive.

### Security posture aligned with Article V

Tauri requires you to *explicitly allowlist* every capability the shell may use. A Tauri app cannot
read arbitrary files or make arbitrary network requests unless the configuration permits it. This
is least privilege enforced by the framework rather than by discipline — precisely what Article V
asks for, obtained for free.

Electron's default posture is the opposite: full Node.js access from the renderer unless carefully
locked down, which is a well-documented source of vulnerabilities.

---

## The honest problem: Tauri means some Rust

Tauri's shell is written in Rust. This is in tension with your "one language everywhere" decision
and I am not going to pretend otherwise.

**How much Rust, concretely.** For FRIDAY's shell: roughly 100–200 lines total, and almost all of
it is configuration-shaped — registering a tray icon, binding a hotkey, declaring permissions. The
window content, all UI logic, and all business logic are TypeScript. You will not be writing Rust
business logic and neither will an AI assistant.

**Why this is acceptable.** The Rust is confined to `apps/desktop/src-tauri/`, it is boilerplate
that follows well-documented patterns, and it never touches FRIDAY's actual behavior. The boundary
is a real architectural boundary, not a convention that will erode.

**When it would become unacceptable.** If we found ourselves writing meaningful logic in Rust —
more than roughly 500 lines, or anything with business meaning — that would be a signal the shell
is doing too much, and the correct response is to move that logic into the core, not to accept the
Rust.

**The fallback.** If Tauri proves problematic, Electron is a well-understood migration: the React
application is unchanged; only the shell is replaced. Roughly a week of work, and no FRIDAY logic
is touched. That reversibility is what makes this a safe bet rather than a gamble.

---

## Platform priority

| Platform | When | Notes |
|---|---|---|
| **macOS (Apple Silicon)** | M4 | Primary target. Where the core runs. Where you work. |
| **macOS (Intel)** | M4 | Nearly free — universal binary from the same build. |
| **Windows** | M8+ | Only when there is a reason. Tauri makes it a build target, but it needs real testing and a code-signing certificate (~$200/yr). |
| **Linux** | M8+ | Same. Lowest priority absent a reason. |

Building for a platform you do not use is a maintenance liability, not a feature. Windows and Linux
stay *possible* (Tauri handles them) and stay *unbuilt* until needed.

---

## Distribution and updates

**Code signing and notarization from the first release.** An unsigned Mac app triggers alarming
security warnings and, on recent macOS versions, is actively difficult to open. This requires the
Apple Developer Program ($99/year), which you will need for the iPhone app regardless.

**Auto-update via Tauri's updater**, with a critical constraint: **update packages must be
cryptographically signed, and the app must refuse unsigned updates.** An auto-updater is a remote
code execution channel into a machine holding your entire digital life. If someone compromises the
update feed, they own FRIDAY completely.

The signing key is stored offline, never in the repository, and never on a CI runner with broad
permissions. This is called out specifically in [Chapter 18](18-security-model.md) and is on the
risk register.

**Updates are never silent.** Article II and Article III both apply: FRIDAY tells you an update is
available, shows what changed in plain language, and installs it when you agree. A system built on
"never act without approval" should not upgrade itself while you sleep.

---

## Alternatives considered

### Electron

**Advantages:** the most mature option by far, enormous ecosystem, 100% JavaScript/TypeScript with
zero Rust, consistent rendering across platforms because it ships its own browser, and
better-documented deep OS integration.

**Rejected** on resource usage (a 300 MB always-running menu bar app is not "quietly disappearing
into the background"), on security posture, and decisively on the lack of any mobile path.

**Retained as the documented fallback.** If Tauri disappoints during M4 or M7, we switch. The cost
is bounded and the React app is untouched.

### Native SwiftUI application

**Advantages:** the best possible Mac experience. Instant launch, tiny memory, perfect platform
conventions, first access to new macOS capabilities, and the ability to share code with a native
iPhone app.

**Rejected** because it means Swift — a second language, violating your explicit constraint — and a
separate UI codebase that will drift from the web dashboard. It also strands Windows and the
browser entirely.

This is the strongest technical alternative in the chapter, and if you ever hire an experienced Mac
developer it becomes worth revisiting for the desktop surface specifically. As a solo builder
directing AI assistants, it is the wrong choice.

### Progressive Web App (browser only, installable)

**Advantages:** zero shell to maintain, zero distribution problem, zero code signing.

**Rejected** because the things FRIDAY needs from the desktop are exactly the things PWAs cannot do
well on macOS: a persistent menu bar presence, a global hotkey that works when the browser is not
focused, reliable native notifications, and keychain access. Safari's PWA support on macOS is also
the weakest of any major platform.

**Kept as a supported access path** — the dashboard remains reachable in any browser at
`localhost`, which is genuinely useful for a quick look from another machine on your network.

### Menu-bar-only application (no main window)

**Advantages:** maximally "disappears into the background," the purest reading of the Manifesto's
interface philosophy.

**Rejected as the whole strategy** because Article II requires deep inspectability — the audit log,
the plan graph, the memory browser — and those need real screen space. **Adopted as the default
mode**: FRIDAY lives in the menu bar, and the full window is opened when you want depth. This is
the synthesis, and it is what the Manifesto actually asks for.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Some Rust exists in the repository.** | Accepted — bounded, boilerplate, architecturally isolated, with a defined limit that triggers reconsideration. |
| **Tauri mobile is younger than desktop Tauri.** | Accepted with an explicit fallback in [Chapter 08](08-mobile-strategy.md). Validated early in M7 before committing. |
| **Rendering differs subtly between platforms** because each uses its own web view. | Accepted — an inherent cost of using system web views, and the price of the memory savings. Tested on real macOS; Windows/Linux tested when built. |
| **The app will not feel perfectly Mac-native.** | Accepted — mitigated by respecting platform conventions where they are cheap (menu bar, keyboard shortcuts, dark mode, reduced motion). |
| **Apple Developer Program is a hard $99/year dependency** for a properly distributed app. | Accepted — needed for iOS anyway, and inside budget. |
| **The updater is a high-value attack surface.** | Accepted and actively mitigated: signed updates, offline keys, explicit user consent. On the risk register. |

---

## Review triggers

- Tauri 2 mobile fails validation at the start of M7 → evaluate Electron + React Native
- Desktop memory exceeds 250 MB at rest → investigate; consider a lighter tray-only mode
- Tauri's maintainers signal a slowdown or the project loses momentum → begin Electron migration
  planning
- Rust in `src-tauri/` exceeds 500 lines → the shell is doing too much; move logic to the core
- A native Mac developer joins the project → reconsider SwiftUI for the desktop surface

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
