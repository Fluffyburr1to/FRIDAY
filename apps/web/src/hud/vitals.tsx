import type { Vital, VitalId } from '@friday/contracts'
import { useQuery } from '@tanstack/react-query'
import { t } from '../i18n'
import { trpc } from '../trpc'
import { Panel } from './panel'

/**
 * What the FRIDAY runtime is doing.
 *
 * ★ These are **her process, not the machine** — Chapter 29's
 * `friday_cpu_percent`, `friday_memory_bytes`, `friday_uptime_seconds`,
 * `friday_disk_free_bytes`. The panel says so in its subtitle, because a row
 * labelled `MEMORY` reading 90 MB on a panel the owner takes for his Mac's
 * vitals is the same substitution ADR-0042 forbids, only in the other
 * direction.
 *
 * The numbers and their verdicts are computed in `packages/diagnostics`; this
 * renders them. A surface picking its own thresholds would hold an opinion
 * nothing else in FRIDAY could see.
 *
 * No graphs: core keeps no vitals history, so there is no trend to draw and a
 * sparkline would animate the last few seconds of this session as though it
 * were the past. The bar beside each value encodes the same number as the
 * digits, for reading at a glance across a room.
 *
 * Reference: docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
 */
export function VitalsPanel(input: {
  pollIntervalMs: number
  hidden: readonly VitalId[]
}): React.JSX.Element {
  const query = useQuery({
    ...trpc.vitals.current.queryOptions(),
    refetchInterval: input.pollIntervalMs,

    // A local socket feeding a screen that is glanced at rather than clicked
    // into, so it must stay true while the window is not focused.
    refetchIntervalInBackground: true,
  })

  if (query.data === undefined) {
    return (
      <Panel title={t('vitals.title')}>
        <p className="notice">{query.isError ? t('events.unreachable') : t('events.connecting')}</p>
      </Panel>
    )
  }

  const shown = query.data.vitals.filter((vital) => !input.hidden.includes(vital.id))

  return (
    <Panel
      title={t('vitals.title')}
      // Rule 4: the last good reading stays and says it is old, rather than
      // being replaced by an error that discards what the owner was reading.
      note={
        query.isError
          ? t('link.stale')
          : new Date(query.data.measuredAt).toLocaleTimeString(undefined, { timeStyle: 'medium' })
      }
    >
      <p className="vitals__scope">{t('vitals.scope')}</p>
      <ul className="vitals">
        {shown.map((vital) => (
          <VitalRow key={vital.id} vital={vital} />
        ))}
      </ul>
    </Panel>
  )
}

function VitalRow(input: { vital: Vital }): React.JSX.Element {
  const { vital } = input

  if (vital.reading.status === 'absent') {
    return (
      <li className="vital vital--absent">
        <span className="vital__label">{vital.label}</span>
        <span className="vital__value">{t('vitals.unavailable')}</span>
        {/*
          The reason is also a tooltip carrying `needs`. The owner asked to be
          told what is unavailable and why; a permanent paragraph beside a
          metric he cannot have would cost more room than the ones he can.
        */}
        <span className="vital__why" title={`${vital.reading.reason} ${vital.reading.needs}`}>
          {vital.reading.reason}
        </span>
      </li>
    )
  }

  const { value, state, qualifier } = vital.reading

  // Only percentages get a bar. Megabytes and durations have no natural full
  // scale, and drawing one would invent a maximum nobody set.
  const proportion = vital.unit === '%' ? Math.min(100, Math.max(0, value)) : null

  return (
    <li className={`vital vital--${state ?? 'unjudged'}`}>
      <span className="vital__label">{vital.label}</span>
      <span className="vital__value">
        {value.toFixed(1)}
        <span className="vital__unit">{vital.unit}</span>
      </span>
      {proportion === null ? (
        <span className="vital__bar vital__bar--none" />
      ) : (
        <span className="vital__bar" role="presentation">
          <span className="vital__fill" style={{ inlineSize: `${proportion}%` }} />
        </span>
      )}
      <span className="vital__qualifier">{qualifier}</span>
    </li>
  )
}
