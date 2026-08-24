import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlansPanel } from '../../src/plans'
import { queryClient } from '../../src/trpc'

/**
 * What FRIDAY is doing, as the owner sees it.
 *
 * Two things are being defended here, and neither is layout:
 *
 *   1. **The panel reads.** There is no control on it that could advance a
 *      plan or answer FRIDAY. A second way to say yes, sitting next to the
 *      work it would authorise, is how a considered approval becomes a reflex.
 *   2. **The explanation carries its evidence.** Every line shows the event
 *      behind it. A line without one is a claim with nothing under it, which
 *      is the difference between an explanation and a story.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md · Chapter 12
 */

function aPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan: {
      id: '019fdf89-b6d5-75b9-9a35-205812dbc126',
      principalId: 'usr_owner',
      utterance: 'check my records',
      intent: { kind: 'operations.run', confidence: 1, entities: {}, ambiguities: [] },
      rationale: 'One step, because that is all she has that matches.',
      explanation: null,
      status: 'completed',
      correlationId: '019fdf89-b6d5-75b9-9a35-205812dbc199',
      createdAt: 1_786_161_772_245,
      updatedAt: 1_786_161_772_245,
      completedAt: 1_786_161_773_000,
      budgetTokens: null,
      budgetCents: null,
      budgetDeadlineMs: null,
      spentTokens: 0,
      spentCents: 0,
      ...(overrides.plan as Record<string, unknown> | undefined),
    },
    steps: overrides.steps ?? [aStep()],
  }
}

function aStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '019fdf89-b6d5-75b9-9a35-205812dbc127',
    planId: '019fdf89-b6d5-75b9-9a35-205812dbc126',
    principalId: 'usr_owner',
    sequence: 1,
    dependsOn: [],
    description: 'Check that FRIDAY is internally consistent.',
    status: 'completed',
    actionType: 'diagnostics.self-check.run',
    actionPayload: {},
    department: 'operations',
    riskClass: 'low',
    onFailure: 'abort',
    approvalId: null,
    agentId: null,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    idempotencyKey: 'step:1',
    ...overrides,
  }
}

const WHY = {
  headline: 'The plan finished.',
  asked: 'check my records',
  rationale: 'One step.',
  lines: [
    {
      text: 'FRIDAY worked out how to do this, in 1 step.',
      eventId: '019fdf89-b6d5-75b9-9a35-2058aaaaaaaa',
      eventType: 'plan.created',
      seq: 1,
      occurredAt: 1_786_161_772_245,
      depth: 0,
    },
    {
      text: 'Done: Check that FRIDAY is internally consistent.',
      eventId: '019fdf89-b6d5-75b9-9a35-2058bbbbbbbb',
      eventType: 'plan.step.completed',
      seq: 2,
      occurredAt: 1_786_161_772_999,
      depth: 1,
    },
  ],
  omitted: { belowDepth: 0, unphrased: [] as string[] },
  orphaned: [] as string[],
}

/**
 * Answers whichever procedure was called.
 *
 * The panel makes two different requests and the second only after a click, so
 * a single canned body would make the test pass for the wrong reason.
 */
function server(input: { plans: Record<string, unknown>[]; why?: Record<string, unknown> }) {
  return vi.fn((url: string | URL) => {
    const path = String(url)
    const data = path.includes('plans.why') ? (input.why ?? WHY) : { plans: input.plans }

    return Promise.resolve(
      new Response(JSON.stringify([{ result: { data } }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
}

function renderPanel(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <PlansPanel pollIntervalMs={60_000} />
    </QueryClientProvider>,
  )
}

describe('the plans panel', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('★ names a plan by what the owner asked for, not by her restatement', async () => {
    // ★ ADR-0045 keeps the utterance for exactly this. A row headed by the
    // parsed intent would be FRIDAY paraphrasing the owner back to himself.
    vi.stubGlobal('fetch', server({ plans: [aPlan()] }))

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('check my records')).toBeDefined()
    })

    expect(screen.getByText('Done')).toBeDefined()
    expect(screen.getByText('1 of 1 done')).toBeDefined()
  })

  it('★ says a plan is waiting in words, not in an enum', async () => {
    vi.stubGlobal(
      'fetch',
      server({
        plans: [
          aPlan({
            plan: { status: 'awaiting_plan_approval' },
            steps: [aStep({ status: 'pending' })],
          }),
        ],
      }),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/waiting for you to see the plan/i)).toBeDefined()
    })

    expect(screen.queryByText('awaiting_plan_approval')).toBeNull()
  })

  it('★ shows the account, with the event behind every line', async () => {
    // ★ What separates an explanation from a story. The id is rendered rather
    // than kept for debugging: it is what makes the raw record reachable.
    vi.stubGlobal('fetch', server({ plans: [aPlan()] }))

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('check my records')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /check my records/ }))

    await waitFor(() => {
      expect(screen.getByText(/Done: Check that FRIDAY is internally consistent/)).toBeDefined()
    })

    // ★ Every line shows its event, truncated but present — one per line, not
    // one for the panel. An account whose last line alone carried an id would
    // pass a laxer assertion while most of it stood on nothing.
    const ids = screen.getAllByText('019fdf89')

    expect(ids).toHaveLength(WHY.lines.length)
  })

  it('★ says what it left out rather than implying it is everything', async () => {
    vi.stubGlobal(
      'fetch',
      server({
        plans: [aPlan()],
        why: { ...WHY, omitted: { belowDepth: 3, unphrased: ['some.unknown.thing'] } },
      }),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('check my records')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /check my records/ }))

    await waitFor(() => {
      expect(screen.getByText(/4 more recorded, not shown/)).toBeDefined()
    })
  })

  it('★ offers no way to approve, retry, or advance anything', async () => {
    // ★ The guarantee this panel is built around. Answering FRIDAY happens in
    // the approvals panel, where Chapter 19's rules and ADR-0030's presence
    // restriction both apply — not here, next to the work.
    vi.stubGlobal(
      'fetch',
      server({
        plans: [
          aPlan({
            plan: { status: 'awaiting_approval' },
            steps: [aStep({ status: 'awaiting_approval' })],
          }),
        ],
      }),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('check my records')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /check my records/ }))

    await waitFor(() => {
      expect(screen.getByText(/Waiting on you/)).toBeDefined()
    })

    // Every control on this panel expands or collapses. There are no others.
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-expanded')).not.toBeNull()
    }

    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('does not present an unreadable list as an idle assistant', async () => {
    // The event log's rule, applied here: "cannot reach FRIDAY" and "she has
    // done nothing" are different statements and must read differently.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('socket closed'))),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/Cannot reach FRIDAY/)).toBeDefined()
    })

    expect(screen.queryByText(/has not been asked to do anything/)).toBeNull()
  })
})
