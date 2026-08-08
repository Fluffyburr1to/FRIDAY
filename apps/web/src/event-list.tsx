import type { FridayEvent } from '@friday/contracts'
import { useQuery } from '@tanstack/react-query'
import { t } from './i18n'
import { trpc } from './trpc'

/**
 * The live event log.
 *
 * The first screen in the dashboard, and the whole of Article II at Milestone
 * 2: what FRIDAY has recorded, as she recorded it.
 *
 * ── Why it polls ────────────────────────────────────────────────────────────
 *
 * Chapter 26 rule 2 says live, never stale, and that no refresh button exists.
 * The eventual mechanism is a WebSocket subscription; until core has one, a
 * one-second poll keeps the rule true from the owner's side. This mirrors what
 * `friday events tail` does at 400 ms and for the same reason, and it goes
 * away when the subscription lands — see ADR-0021's note on the same trade.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md
 */

/** How many events the view holds. Matches core's default page. */
const PAGE_SIZE = 50

const POLL_INTERVAL_MS = 1_000

export function EventList(): React.JSX.Element {
  const query = useQuery({
    ...trpc.events.list.queryOptions({ limit: PAGE_SIZE }),
    refetchInterval: POLL_INTERVAL_MS,

    // TanStack Query pauses interval refetching while the window is not
    // focused. That default is right for a page hitting someone else's API
    // over the network, and wrong here: this is a transparency surface reading
    // a local socket, and "what FRIDAY is doing" has to be true on a screen
    // being glanced at rather than only on one being clicked into.
    refetchIntervalInBackground: true,
  })

  // No data has ever arrived. Distinct from an empty log, which is a fact
  // about FRIDAY rather than about the connection.
  if (query.data === undefined) {
    return (
      <p className="notice">
        {query.isError
          ? `${t('events.unreachable')} ${query.error.message}`
          : t('events.connecting')}
      </p>
    )
  }

  return (
    <>
      {/*
        Rule 4: offline is a designed state. The last known data stays on
        screen and says so, rather than being replaced by an error that
        discards what the owner was reading.
      */}
      {query.isError && (
        <p className="notice notice--stale">
          {t('events.unreachable')} {t('events.stale')}
        </p>
      )}

      {query.data.events.length === 0 ? (
        <p className="notice">{t('events.empty')}</p>
      ) : (
        <EventTable events={query.data.events} />
      )}
    </>
  )
}

function EventTable(input: { events: readonly FridayEvent[] }): React.JSX.Element {
  return (
    <table className="events">
      <thead>
        <tr>
          <th scope="col">{t('events.column.seq')}</th>
          <th scope="col">{t('events.column.time')}</th>
          <th scope="col">{t('events.column.type')}</th>
          <th scope="col">{t('events.column.actor')}</th>
        </tr>
      </thead>
      <tbody>
        {input.events.map((event) => (
          <tr key={event.id}>
            <td className="events__seq">{event.seq}</td>
            <td>
              <time dateTime={new Date(event.recordedAt).toISOString()}>
                {new Date(event.recordedAt).toLocaleTimeString()}
              </time>
            </td>
            <td className="events__type">{event.type}</td>
            <td>{event.actor.id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
