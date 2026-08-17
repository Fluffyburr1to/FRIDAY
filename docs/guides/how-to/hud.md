# The HUD

**FRIDAY's face — one screen, three panels, nothing on it she did not produce.**

Governed by [ADR-0041](../../adr/0041-one-hud-is-the-dashboard-grown-up.md),
[ADR-0042](../../adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md), and
[Chapter 26](../../01-bible/26-dashboard-architecture.md).

---

## Running it

```
pnpm hud
```

Builds, starts `apps/core`, starts the HUD, opens a browser, stops both on Ctrl-C.

On a machine where FRIDAY has never been set up it refuses and says so. Provision once:

```
pnpm friday init
```

Two processes exist because core serves the API on `127.0.0.1:7420` while Vite serves the HUD and
proxies `/trpc` to it — same origin, so no CORS surface exists to be misconfigured.

> [!warning] The success path of `pnpm hud` has not been run end to end.
> Verified: the build, core starting, the readiness wait, the unprovisioned-machine failure message,
> exit code 1, and clean process teardown. **Not** verified: core reaching "listening" under a real
> Keychain-backed key provider, the browser opening, and shutdown of both processes together.
>
> The HUD itself has been exercised against a real `apps/core` using an in-memory key provider
> (ADR-0020's injection seam). That proves the *interface*, not the *launcher* — the launcher spawns
> `apps/core/dist/index.js`, which always builds a Keychain provider. Closing the gap needs
> `pnpm friday init`, which had not been run when this was written.

---

## The one rule

> **The panel is built *after* the event, never before.** A panel with no source is not a UI task but
> a missing event contract. — [ADR-0041 §2](../../adr/0041-one-hud-is-the-dashboard-grown-up.md)

So there are three panels, not eight. The subsystems behind FRIDAY state, the command deck, the
schedule, audio, and vault context do not exist, so **they are not drawn at all** — not as
placeholders, not as empty boxes. They appear here, in documentation, and nowhere in the UI.

| Deferred panel | Would come from | Arrives |
|---|---|---|
| FRIDAY state | plan and capability events | M5 |
| Command deck | department manifests | M5 |
| Schedule | a calendar connector | M6 |
| Current context | `packages/memory` | M5–M7 |
| Audio | `packages/voice` | M7 |

---

## What is where

| File | Holds |
|---|---|
| [`hud/layout.ts`](../../../apps/web/src/hud/layout.ts) | **Configuration** — which panels, which slot, which vitals hidden |
| [`app.tsx`](../../../apps/web/src/app.tsx) | **Structure** — reads the layout, draws the slots |
| [`hud/panel.tsx`](../../../apps/web/src/hud/panel.tsx) | The frame every panel sits in |
| [`hud/vitals.tsx`](../../../apps/web/src/hud/vitals.tsx) | The vitals panel |
| [`hud/header.tsx`](../../../apps/web/src/hud/header.tsx) | Wordmark, clock, link state |
| [`index.css`](../../../apps/web/src/index.css) | **Styling** |
| [`i18n.ts`](../../../apps/web/src/i18n.ts) | Every user-facing string |

Configuration, structure, data, and styling are separate files because Brief §16 requires it — that
is the only reason `layout.ts` exists as a file rather than as JSX.

---

## Where the data comes from

Everything arrives over tRPC from [`apps/core`](../../../apps/core). The HUD reads no files, runs no
commands, and calls no application APIs.

| Panel | Procedure |
|---|---|
| System vitals | `vitals.current` → [`packages/diagnostics`](../../../packages/diagnostics) |
| Needs you | `approvals.pending` · `approvals.respond` |
| Event log | `events.list` |

Two things on screen do **not** come from core, because they are not about FRIDAY: the clock, and the
`LINK ONLINE` indicator. That indicator says the browser can reach core. It never says FRIDAY is
*well* — that needs Chapter 23's health aggregation, which no component implements.

### Vitals are FRIDAY-scoped

`CPU`, `MEMORY`, and `UPTIME` describe **the FRIDAY process**, not the Mac. This follows
[Chapter 29](../../01-bible/29-monitoring-observability.md), whose system-health metrics are
`friday_cpu_percent`, `friday_memory_bytes`, `friday_uptime_seconds`, `friday_disk_free_bytes` — it
defines no host-CPU or host-memory metric at all.

The panel carries the line *"The FRIDAY runtime, not this Mac"* for this reason, and it is not
decoration: a `MEMORY` row reading 94 MB, on a panel the owner takes for his machine's vitals, is the
same substitution ADR-0042 forbids.

`os.freemem()`, `os.loadavg()`, and `os.uptime()` are banned in `packages/diagnostics`, and a test
asserts their absence from the source.

---

## Adding a section

1. **Find the event or query behind it.** If there is none, stop — that is a missing event contract,
   not a UI task, and the panel does not get built yet.
2. Add its id to `PanelId` in `layout.ts` and place it in `DEFAULT_LAYOUT`.
3. Add a `case` in `PanelFor` in `app.tsx`, and its title to `i18n.ts`.

## Connecting a new data source

1. Add the schema to [`packages/contracts`](../../../packages/contracts). Schemas are defined once.
2. Compute it in a package — never in `apps/core`, which translates and does not decide, and never in
   the HUD, which renders and does not compute.
3. Expose it as a procedure in [`router.ts`](../../../apps/core/src/router.ts).

**Absence is a value, not an error.** A source that can fail per item returns an `absent` reading with
a `reason` and a `needs`, so one dead metric degrades one row instead of blanking the panel.

---

## How voice will change it

**There is no voice control today, and nothing here implements any.** Brief §16 is explicit —
*"Do not implement the full voice-control system as part of this task unless it already exists"* — and
`packages/voice` is an empty directory.

What exists is the precondition: the arrangement is a plain object, so changing it is a data edit
rather than a component edit.

| Would be said | Would change |
|---|---|
| "Hide the vitals panel" | drop its entry from `panels` |
| "Move vitals to the right" | `slot: 'left'` → `'right'` |
| "Hide the temperature row" | `hiddenVitals: ['temperature']` |

**What is still required for that to work:** move `DEFAULT_LAYOUT` into
[`packages/config`](../../../packages/config), serve it over tRPC, and write it back through an
authorized path so the change is recorded. `app.tsx` takes the layout as a prop so that touches one
file. It is deliberately not in `localStorage` — ADR-0041 §4, the HUD holds no store.

---

## Viewport

No repository document specifies a supported size, so the code asserts none. The invariant is tested
at **1280×800, 1440×900, and 1920×1080**: the page never scrolls, the event feed is the only
scrolling region, and no panel overflows or clips. Those are test viewports, not a product contract.

Below 1200px the right rail folds under the main column.

## Things that look like bugs and are not

- **`CPU 0.4%`** — FRIDAY idling, not your Mac idling. See the scope note above.
- **`UNAVAILABLE` on temperature and network** — no truthful FRIDAY-scoped source exists, and a host
  substitute is forbidden.
- **`UPTIME` has no colour** — no duration makes uptime a problem, so it carries no verdict. Absent
  state is not the same as healthy.
- **Nothing animates** — ADR-0041 §3: nothing animates without meaning, and nothing yet has one.
