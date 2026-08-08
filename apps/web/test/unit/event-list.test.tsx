import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventList } from '../../src/event-list'
import { queryClient } from '../../src/trpc'

/**
 * What the owner actually sees.
 *
 * Queried by role and text rather than by class name, so these break when the
 * screen stops being readable and not when the markup is rearranged.
 *
 * The case that matters most is the last one. An early build of this screen
 * dropped its connection to core and went on showing the last events with no
 * indication anything was wrong — which is the specific failure a transparency
 * surface must not have, because a stale screen that looks healthy is worse
 * than one that is obviously broken.
 */

/** An event shaped as the log records them. */
function anEvent(seq: number): Record<string, unknown> {
  return {
    type: 'test.event.emitted',
    occurredAt: 1_786_161_772_245,
    actor: { type: 'system', id: 'system:kernel' },
    principalId: 'usr_owner',
    payload: { note: `event ${seq}` },
    payloadVersion: 1,
    sensitivity: 'internal',
    seq,
    id: `019fdf89-b6d5-75b9-9a35-20581.2dbc12${seq}`,
    recordedAt: 1_786_161_772_245,
    integrityHash: 'f'.repeat(64),
  }
}

/**
 * The batched envelope tRPC's httpBatchLink expects, captured from the real
 * server rather than written from the documentation.
 */
function respondWith(events: Record<string, unknown>[]): Response {
  return new Response(JSON.stringify([{ result: { data: { events } } }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function unreachable(): Response {
  return new Response('Bad Gateway', { status: 502 })
}

function renderList(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <EventList />
    </QueryClientProvider>,
  )
}

describe('the event list', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the events core returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respondWith([anEvent(2), anEvent(1)]))),
    )

    renderList()

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(3) // header + two events
    })

    // Every event names who acted, which is what makes the log answerable
    // rather than merely chronological.
    expect(screen.getAllByText('system:kernel')).toHaveLength(2)
    expect(screen.getAllByText('test.event.emitted')).toHaveLength(2)
    expect(screen.queryByText(/cannot reach friday/i)).toBeNull()
  })

  it('says the log is empty rather than implying a problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respondWith([]))),
    )

    renderList()

    await waitFor(() => {
      expect(screen.getByText(/nothing has been recorded yet/i)).toBeDefined()
    })

    // An empty log is a fact about FRIDAY. It must not be dressed as a fault.
    expect(screen.queryByText(/cannot reach friday/i)).toBeNull()
  })

  it('says so when core cannot be reached and nothing has arrived', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(unreachable())),
    )

    renderList()

    await waitFor(() => {
      expect(screen.getByText(/cannot reach friday/i)).toBeDefined()
    })

    // The one thing it must never do here is render an empty list, which
    // would read as "FRIDAY has done nothing" when the truth is "we cannot
    // see what FRIDAY has done".
    expect(screen.queryByText(/nothing has been recorded yet/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps the last events on screen and marks them stale when core goes away', async () => {
    const fetching = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(respondWith([anEvent(2), anEvent(1)]))
      .mockResolvedValue(unreachable())

    vi.stubGlobal('fetch', fetching)

    renderList()

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(3)
    })

    // Core goes away. The next poll is the one that fails.
    await queryClient.refetchQueries()

    await waitFor(() => {
      expect(screen.getByText(/it may no longer be current/i)).toBeDefined()
    })

    // Rule 4: the last known data stays, and says what it is. Losing it would
    // replace something true-as-of-a-moment-ago with nothing at all.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
})
