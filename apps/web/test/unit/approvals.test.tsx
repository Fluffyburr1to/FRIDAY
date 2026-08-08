import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Approvals } from '../../src/approvals'
import { queryClient } from '../../src/trpc'

/**
 * What the owner can and cannot do from a browser.
 *
 * The behaviour under test is ADR-0030's, and it has two halves that are easy
 * to get half-right: a high-risk request must still be *visible* — hiding it
 * would be the exact failure Article II exists to prevent — and it must not be
 * *answerable* here, because a local connection is not a present owner.
 */

function anApproval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '019fdf89-b6d5-75b9-9a35-205812dbc126',
    principalId: 'usr_owner',
    title: 'Send a follow-up email to Sarah Chen',
    riskClass: 'medium',
    explanation: {
      what: 'Send a follow-up email',
      why: 'You asked to be kept on top of the contract thread',
      confidence: 0.8,
      risks: ['The tone may be wrong'],
      alternatives: ['Wait for her to reply'],
    },
    preview: { kind: 'text', content: 'Hi Sarah —' },
    impact: {
      reversible: false,
      dataLeavesDevice: true,
      dataCategories: ['correspondence'],
      estimatedCostCents: null,
    },
    actor: { type: 'agent', id: 'agent:communications/mailer' },
    action: 'connector.gmail.send',
    resource: 'gmail:thread/abc',
    planId: null,
    planStepId: null,
    correlationId: null,
    decisionId: '019fdf89-b6d5-75b9-9a35-205812dbc127',
    requiredAuth: 'none',
    createdAt: 1_786_161_772_245,
    expiresAt: 1_786_161_872_245,
    status: 'pending',
    respondedAt: null,
    respondedVia: null,
    responseReason: null,
    ...overrides,
  }
}

function respondWith(approvals: Record<string, unknown>[]): Response {
  return new Response(JSON.stringify([{ result: { data: { approvals } } }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPanel(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Approvals />
    </QueryClientProvider>,
  )
}

describe('the needs-you panel', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows what is waiting, and why FRIDAY wants to do it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respondWith([anApproval()]))),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/follow-up email to Sarah Chen/)).toBeDefined()
    })

    // Consent to something unexplained is not consent.
    expect(screen.getByText(/kept on top of the contract thread/)).toBeDefined()
  })

  it('lets the owner answer a request that does not need them present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respondWith([anApproval({ requiredAuth: 'none' })]))),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeDefined()
    })

    expect(screen.getByRole('button', { name: /approve/i }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /decline/i }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/prove it is you/i)).toBeNull()
  })

  it('shows a high-risk request but will not let it be answered here', async () => {
    // ★ The regression that matters. Both halves are asserted: still visible,
    // and inert — with the reason stated rather than left as a dead control.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          respondWith([anApproval({ riskClass: 'high', requiredAuth: 'biometric' })]),
        ),
      ),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/follow-up email to Sarah Chen/)).toBeDefined()
    })

    expect(screen.getByRole('button', { name: /approve/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /decline/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/prove it is you/i)).toBeDefined()
  })

  it('will not let FRIDAY change her own code from the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          respondWith([anApproval({ riskClass: 'self_modification', requiredAuth: 'passkey' })]),
        ),
      ),
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/prove it is you/i)).toBeDefined()
    })

    expect(screen.getByRole('button', { name: /approve/i }).hasAttribute('disabled')).toBe(true)
  })

  it('shows nothing at all when nothing is waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respondWith([]))),
    )

    renderPanel()

    // Calm is a requirement, not a preference. An empty panel announcing its
    // own emptiness is noise on the screen the owner sees most.
    await waitFor(() => {
      expect(screen.queryByRole('button')).toBeNull()
    })

    expect(screen.queryByText(/needs you/i)).toBeNull()
  })
})
