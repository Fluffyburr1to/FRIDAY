import { QueryClientProvider } from '@tanstack/react-query'
import { Approvals } from './approvals'
import { EventList } from './event-list'
import { Header } from './hud/header'
import { DEFAULT_LAYOUT, type HudLayout, type PanelId } from './hud/layout'
import { Panel } from './hud/panel'
import { VitalsPanel } from './hud/vitals'
import { t } from './i18n'
import { PlansPanel } from './plans'
import { queryClient } from './trpc'

/**
 * The HUD — FRIDAY's face.
 *
 * One screen, no navigation, no routes. Three panels, and every one of them is
 * backed by a procedure `apps/core` actually serves: ADR-0041 §2 says a panel
 * is built *after* its source exists, never before, so the subsystems that
 * arrive at M5–M7 have no placeholder here.
 *
 * The layout is a prop rather than an import inside the tree, so the day it
 * comes from core over tRPC — which is how FRIDAY will eventually rearrange her
 * own face — this is the only file that changes.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md · docs/guides/how-to/hud.md
 */
export function App(input: { layout?: HudLayout }): React.JSX.Element {
  const layout = input.layout ?? DEFAULT_LAYOUT

  return (
    <QueryClientProvider client={queryClient}>
      <div className="hud">
        <Header pollIntervalMs={layout.pollIntervalMs} />

        <div className="hud__grid">
          {layout.panels.map((panel) => (
            <div key={panel.id} className={`slot slot--${panel.slot}`}>
              <PanelFor id={panel.id} layout={layout} />
            </div>
          ))}
        </div>
      </div>
    </QueryClientProvider>
  )
}

function PanelFor(input: { id: PanelId; layout: HudLayout }): React.JSX.Element {
  const { id, layout } = input

  switch (id) {
    case 'vitals':
      return <VitalsPanel pollIntervalMs={layout.pollIntervalMs} hidden={layout.hiddenVitals} />

    case 'plans':
      return (
        <Panel title={t('plans.heading')}>
          <PlansPanel pollIntervalMs={layout.pollIntervalMs} />
        </Panel>
      )

    case 'events':
      return (
        <Panel title={t('events.heading')}>
          <div className="feed">
            <EventList />
          </div>
        </Panel>
      )

    // Rendered without a frame, and that is tested behaviour rather than an
    // oversight: `Approvals` renders nothing at all when nothing is waiting, so
    // a frame would be an empty box announcing that there is no news. It brings
    // its own heading when it has something to say.
    case 'approvals':
      return <Approvals />
  }
}
