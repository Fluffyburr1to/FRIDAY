import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app'
import { DEFAULT_LAYOUT, type HudLayout } from '../../src/hud/layout'
import { queryClient } from '../../src/trpc'

/**
 * The face, and the promises it makes.
 *
 * ── What these guard ─────────────────────────────────────────────────────────
 *
 * Two failures, neither of which is "a number did not render".
 *
 * The first is faking: ADR-0041 §2, in the owner's words, *"do not fake this
 * state."* A metric FRIDAY cannot measure must never appear as a zero.
 *
 * The second is **scope**: Chapter 29's vitals are FRIDAY's process, and a host
 * figure under one of these labels looks exactly like a correct reading. The
 * panel has to say whose numbers these are.
 */

/** What each procedure returns, keyed as core's router names them. */
const RESPONSES: Record<string, unknown> = {
  'vitals.current': {
    measuredAt: 1_786_161_772_245,
    sampleIntervalMs: 1_000,
    vitals: [
      {
        id: 'cpu',
        label: 'CPU',
        unit: '%',
        reading: {
          status: 'measured',
          value: 12.5,
          state: 'healthy',
          qualifier: 'her share of 10 cores',
        },
      },
      {
        id: 'memory',
        label: 'Memory',
        unit: 'MB',
        reading: {
          status: 'measured',
          value: 94.2,
          state: 'healthy',
          qualifier: 'resident, this process',
        },
      },
      {
        // Measured with no verdict — the case `unrated` was wrongly invented for.
        id: 'uptime',
        label: 'Uptime',
        unit: 'm',
        reading: { status: 'measured', value: 7.5, qualifier: 'since she started' },
      },
      {
        id: 'temperature',
        label: 'Temp',
        unit: '',
        reading: {
          status: 'absent',
          reason: 'No FRIDAY-scoped temperature exists.',
          needs: 'A native sampler',
        },
      },
    ],
  },
  'events.list': { events: [] },
  'approvals.pending': { approvals: [] },
  'plans.list': { plans: [] },
}

/**
 * Answers a batched tRPC request procedure by procedure.
 *
 * The HUD issues three queries and `httpBatchLink` folds them into one request
 * whose last path segment is the comma-separated procedure list. A stub
 * returning a fixed single-entry array leaves the others with "Missing result",
 * which surfaces as the offline state and hides whatever was being tested.
 */
function answerBatch(input: RequestInfo | URL): Response {
  const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost')
  const batch = decodeURIComponent(url.pathname.split('/').pop() ?? '')

  const body = batch
    .split(',')
    .filter((name) => name !== '')
    .map((procedure) => {
      const data = RESPONSES[procedure]
      if (data === undefined) throw new Error(`test stub has no response for "${procedure}"`)
      return { result: { data } }
    })

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function unreachable(): Response {
  return new Response('Bad Gateway', { status: 502 })
}

describe('the HUD', () => {
  beforeEach(() => {
    queryClient.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => Promise.resolve(answerBatch(input)))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders measured vitals with their units', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText('CPU')).not.toBeNull())

    const panel = screen.getByLabelText('System vitals')
    expect(panel.textContent).toContain('12.5%')
    expect(panel.textContent).toContain('94.2MB')
    expect(panel.textContent).toContain('her share of 10 cores')
  })

  it('says whose metrics these are', async () => {
    render(<App />)

    // ★ Without this line a MEMORY row reading 94 MB is read as the Mac's.
    // The scope claim is the mitigation ADR-0042 §2 relies on.
    await waitFor(() => expect(screen.queryByText(/FRIDAY runtime, not this Mac/i)).not.toBeNull())
  })

  it('never shows a number for a metric it could not measure', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText('Temp')).not.toBeNull())

    const panel = screen.getByLabelText('System vitals')

    // ★ The specific lie prevented: a temperature of 0 rendered in the same
    // typeface as a measurement that was actually taken.
    expect(panel.textContent).not.toContain('0.0')
    expect(screen.queryByText(/No FRIDAY-scoped temperature exists/i)).not.toBeNull()
    expect(screen.queryByText('UNAVAILABLE')).not.toBeNull()

    expect(screen.getByText('Temp').closest('li')?.className).toContain('vital--absent')
  })

  it('renders a measured value that carries no verdict', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText('Uptime')).not.toBeNull())

    // Uptime has no threshold, so it is shown without a state class. Neutral,
    // not green — no verdict is not the same as healthy.
    const row = screen.getByText('Uptime').closest('li')
    expect(row?.className).toContain('vital--unjudged')
    expect(row?.className).not.toContain('vital--healthy')
  })

  it('hides a vital the layout turns off', async () => {
    const layout: HudLayout = { ...DEFAULT_LAYOUT, hiddenVitals: ['temperature'] }
    render(<App layout={layout} />)

    await waitFor(() => expect(screen.queryByText('CPU')).not.toBeNull())
    expect(screen.queryByText('Temp')).toBeNull()
  })

  it('omits a panel the layout does not place', async () => {
    const layout: HudLayout = {
      ...DEFAULT_LAYOUT,
      panels: DEFAULT_LAYOUT.panels.filter((panel) => panel.id !== 'vitals'),
    }
    render(<App layout={layout} />)

    await waitFor(() => expect(screen.queryByText(/Event log/i)).not.toBeNull())

    // Configuration, not a code change — brief §16's requirement in one line.
    expect(screen.queryByLabelText('System vitals')).toBeNull()
  })

  it('places panels in the slots the layout names', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText('CPU')).not.toBeNull())

    expect(screen.getByLabelText('System vitals').closest('.slot')?.className).toContain(
      'slot--left',
    )
  })

  it('keeps the last reading and marks it stale when core goes away', async () => {
    // A faster poll than the shipped one, so the failure lands inside the
    // assertion window rather than a second after it.
    render(<App layout={{ ...DEFAULT_LAYOUT, pollIntervalMs: 30 }} />)
    await waitFor(() => expect(screen.queryByText('CPU')).not.toBeNull())

    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(unreachable()))

    // Rule 4: offline is a designed state. The data the owner was reading stays
    // on screen and says it may be old, rather than vanishing into an error.
    await waitFor(() => expect(screen.queryByText('LINK OFFLINE')).not.toBeNull())
    expect(screen.getByLabelText('System vitals').textContent).toContain('12.5%')
    expect(screen.getByLabelText('System vitals').textContent).toContain('stale')
  })

  /**
   * ★ Every class the components build by interpolation has a rule behind it.
   *
   * This exists because of a defect it would have caught: the markup emitted
   * `vital--absent` while the stylesheet defined `.vital--unavailable`, so the
   * rows FRIDAY *cannot* measure rendered brighter than the ones she can — the
   * panel's emphasis exactly inverted, and nothing failed.
   *
   * A rendering test cannot see this: `className` is correct either way, and
   * jsdom applies no stylesheet. Only comparing the two sources catches it, and
   * interpolated names are invisible to grep, so they are listed here by hand.
   */
  it('has a stylesheet rule for every state class the components compose', () => {
    // `process.cwd()` rather than `import.meta.url`: these run under jsdom,
    // where the module URL is an http:// origin and resolves to no real path.
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

    const composed = [
      // `vital--${state ?? 'unjudged'}` and the absent branch — hud/vitals.tsx
      'vital--healthy',
      'vital--warning',
      'vital--critical',
      'vital--unjudged',
      'vital--absent',
      // `hud__link--${status}` — hud/header.tsx
      'hud__link--online',
      'hud__link--offline',
      'hud__link--connecting',
      // `slot--${panel.slot}` — app.tsx
      'slot--left',
      'slot--main',
      'slot--right',
    ]

    for (const name of composed) {
      // Anchored to a rule head rather than `toContain`, which would also match
      // the name inside a comment or a descendant selector — and did, the first
      // time this was written.
      expect(new RegExp(`^\\.${name}[\\s,{]`, 'm').test(css), `.${name} has no rule`).toBe(true)
    }
  })

  it('never claims FRIDAY is well, only that the link is up', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText('LINK ONLINE')).not.toBeNull())

    // ★ A reachable socket is not a healthy assistant, and nothing implements
    // Chapter 23's health aggregation yet.
    expect(screen.queryByText(/FRIDAY ONLINE/i)).toBeNull()
  })
})
