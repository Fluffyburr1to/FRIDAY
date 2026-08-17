import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { trpc } from '../trpc'

/**
 * Who this is, what time it is, and whether the screen is live.
 *
 * ★ It says `LINK ONLINE`, never `FRIDAY ONLINE`, and the distinction is the
 * whole reason it is up here rather than inside a panel. Whether the browser
 * can reach core is a fact the HUD owns about its own transport. Whether FRIDAY
 * is *well* would need Chapter 23's health aggregation, which no component
 * implements — so the HUD does not claim it.
 *
 * Collapsing the two is the easiest lie available on this screen: the owner
 * would read "ONLINE" as "she is up and healthy", when it means only that a
 * port answered.
 *
 * Reference: docs/adr/0041-one-hud-is-the-dashboard-grown-up.md §2
 */

/** Ticks once a second so the clock is a clock, not a render artefact. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(timer)
  }, [])

  return now
}

export function Header(input: { pollIntervalMs: number }): React.JSX.Element {
  const now = useClock()

  // Shares a cache key with the vitals panel, so this costs no extra request —
  // and it keeps polling when that panel is hidden, because the link indicator
  // has to stay true either way.
  const link = useQuery({
    ...trpc.vitals.current.queryOptions(),
    refetchInterval: input.pollIntervalMs,
    refetchIntervalInBackground: true,
  })

  const status = link.isError ? 'offline' : link.data === undefined ? 'connecting' : 'online'

  return (
    <header className="hud__head">
      <h1 className="hud__mark">{t('app.title')}</h1>

      <time className="hud__clock" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(undefined, { hour12: false })}
      </time>

      <span className={`hud__link hud__link--${status}`}>
        <span className="dot" aria-hidden="true" />
        {t(`link.${status}`)}
      </span>
    </header>
  )
}
