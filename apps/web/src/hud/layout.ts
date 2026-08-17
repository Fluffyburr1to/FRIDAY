import type { VitalId } from '@friday/contracts'

/**
 * Where the panels go, and how often they refresh.
 *
 * ── Why a separate file for three panels ─────────────────────────────────────
 *
 * Brief §16 requires the arrangement to be data rather than JSX, so that FRIDAY
 * can eventually change it through her normal reasoning instead of a developer
 * editing components. That requirement is the only reason this file exists, and
 * it is deliberately the smallest thing that satisfies it.
 *
 * There is **no region/order/weight/visibility machinery.** An earlier draft had
 * all four, to arrange panels that do not exist yet. Panels arrive with their
 * sources (ADR-0041 §2), and the arrangement grows when they do.
 *
 * ── Why it is a constant and not a store ─────────────────────────────────────
 *
 * ADR-0041 §4: the HUD holds no store, and reloading must produce identical
 * state. Persisting this in `localStorage` would make the face keep a truth
 * nothing else in FRIDAY could see.
 *
 * The next step is moving it into `packages/config`, served over tRPC, so a
 * change is recorded like any other configuration change. `app.tsx` takes it as
 * a prop so that day touches one file.
 *
 * Reference: docs/adr/0041-one-hud-is-the-dashboard-grown-up.md
 */

/** A panel with a source behind it. There are no others — ADR-0041 §2. */
export type PanelId = 'vitals' | 'approvals' | 'events'

/** The three areas of the screen, named for position rather than content. */
export type Slot = 'left' | 'right' | 'main'

export interface HudLayout {
  /** Panels to draw, and where. Omitting one removes it. */
  readonly panels: readonly { readonly id: PanelId; readonly slot: Slot }[]

  /** Vitals the owner does not want to see. "Hide the temperature row." */
  readonly hiddenVitals: readonly VitalId[]

  /** How often the HUD asks core for fresh data, in milliseconds. */
  readonly pollIntervalMs: number
}

export const DEFAULT_LAYOUT: HudLayout = {
  pollIntervalMs: 1_000,
  hiddenVitals: [],
  panels: [
    { id: 'vitals', slot: 'left' },
    { id: 'approvals', slot: 'right' },
    { id: 'events', slot: 'main' },
  ],
}
