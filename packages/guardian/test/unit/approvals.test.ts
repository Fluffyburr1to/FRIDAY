import { type Explanation, type RiskClass, uuidv7 } from '@friday/contracts'
import {
  type ApprovalRegistry,
  type ApprovalRequestInput,
  createApprovalRegistry,
  createInMemoryApprovalStore,
  DEFAULT_APPROVAL_LIFETIME_MS,
  requiredAuthFor,
  STEP_UP_WINDOW_MS,
} from '@friday/guardian'
import { beforeEach, describe, expect, it } from 'vitest'

const START = 1_700_000_000_000

const COMPLETE: Explanation = {
  what: 'Send the drafted message to sarah@example.com.',
  why: 'You asked me to follow up on the contract thread this morning.',
  confidence: 0.8,
  risks: ['Sending an email cannot be undone.'],
  alternatives: ['Save it as a draft instead.'],
}

let clock: number
let approvals: ApprovalRegistry

function input(overrides: Partial<ApprovalRequestInput> = {}): ApprovalRequestInput {
  return {
    principalId: 'usr_tyler',
    title: 'Send a follow-up email to Sarah Chen',
    riskClass: 'high',
    explanation: COMPLETE,
    preview: { kind: 'text', content: 'Hi Sarah — following up on the contract.' },
    impact: {
      reversible: false,
      dataLeavesDevice: true,
      dataCategories: ['correspondence'],
      estimatedCostCents: null,
    },
    actor: { type: 'agent', id: 'agent:communications/send' },
    action: 'connector.gmail.message.send',
    resource: 'connector:gmail/messages/draft-1',
    decisionId: uuidv7(),
    ...overrides,
  }
}

function ask(overrides: Partial<ApprovalRequestInput> = {}) {
  const result = approvals.request(input(overrides))
  if (!result.ok) throw new Error(`fixture request rejected: ${result.error.message}`)
  return result.value
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const swept = () => unwrap(approvals.sweepExpired())
const pending = (principalId: string) => unwrap(approvals.pending(principalId))
const statusOf = (id: string) => unwrap(approvals.get(id))?.status

beforeEach(() => {
  clock = START
  approvals = createApprovalRegistry({ store: createInMemoryApprovalStore(), now: () => clock })
})

describe('asking', () => {
  it('raises a complete request', () => {
    const request = ask()

    expect(request.status).toBe('pending')
    expect(request.expiresAt - START).toBe(DEFAULT_APPROVAL_LIFETIME_MS)
  })

  it('refuses to interrupt the owner with an explanation it cannot complete', () => {
    // Chapter 19: you cannot be asked to approve something FRIDAY cannot
    // explain. This fails before the owner is interrupted, not after.
    const result = approvals.request(
      input({ explanation: { ...COMPLETE, risks: [], alternatives: [] } }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses a request whose preview claims an artifact it does not have', () => {
    const result = approvals.request(input({ preview: { kind: 'text', content: '' } }))

    expect(result.ok).toBe(false)
  })

  it('demands step-up in step with the risk', () => {
    const expected: Record<RiskClass, string> = {
      low: 'none',
      medium: 'none',
      high: 'biometric',
      critical: 'passkey',
      self_modification: 'passkey',
    }

    for (const [riskClass, auth] of Object.entries(expected)) {
      expect(requiredAuthFor(riskClass as RiskClass)).toBe(auth)
    }
  })

  it('surfaces pending requests oldest first', () => {
    const first = ask()
    clock += 1_000
    const second = ask({ title: 'Another one' })

    expect(pending('usr_tyler').map((r) => r.id)).toEqual([first.id, second.id])
    expect(pending('usr_someone-else')).toEqual([])
  })
})

describe('answering', () => {
  it('records an approval with a live biometric', () => {
    const request = ask()

    const result = approvals.respond({
      approvalId: request.id,
      decision: 'approve',
      via: 'desktop',
      authenticatedAt: clock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('approved')
    expect(result.value.respondedVia).toBe('desktop')
  })

  it('records a denial and the reason, which is information rather than noise', () => {
    const request = ask()

    const result = approvals.respond({
      approvalId: request.id,
      decision: 'decline',
      via: 'desktop',
      reason: 'Wrong Sarah.',
      authenticatedAt: clock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('declined')
    expect(result.value.responseReason).toBe('Wrong Sarah.')
  })

  it('needs no step-up for something routine', () => {
    const request = ask({ riskClass: 'medium' })

    expect(approvals.respond({ approvalId: request.id, decision: 'approve', via: 'web' }).ok).toBe(
      true,
    )
  })

  it('refuses an approval resting on a session established earlier', () => {
    // The unattended-laptop threat. An unlocked device is not authorisation.
    const request = ask()

    const stale = approvals.respond({
      approvalId: request.id,
      decision: 'approve',
      via: 'desktop',
      authenticatedAt: clock - STEP_UP_WINDOW_MS - 1,
    })

    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.error.code).toBe('STEP_UP_REQUIRED')
  })

  it('refuses an approval with no step-up at all when one is required', () => {
    const request = ask()

    const result = approvals.respond({
      approvalId: request.id,
      decision: 'approve',
      via: 'desktop',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('STEP_UP_REQUIRED')
  })

  it('never accepts a code change approved from a phone', () => {
    // Enforced in code rather than in policy, deliberately. A policy file the
    // owner could edit is the wrong place for "this is not review".
    const request = ask({ riskClass: 'self_modification' })

    const result = approvals.respond({
      approvalId: request.id,
      decision: 'approve',
      via: 'mobile',
      authenticatedAt: clock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SURFACE_NOT_PERMITTED')
  })

  it('accepts the same code change from a computer', () => {
    const request = ask({ riskClass: 'self_modification' })

    const result = approvals.respond({
      approvalId: request.id,
      decision: 'approve',
      via: 'desktop',
      authenticatedAt: clock,
    })

    expect(result.ok).toBe(true)
  })

  it('refuses to answer the same request twice', () => {
    const request = ask({ riskClass: 'medium' })
    approvals.respond({ approvalId: request.id, decision: 'approve', via: 'web' })

    const again = approvals.respond({ approvalId: request.id, decision: 'decline', via: 'web' })

    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error.code).toBe('APPROVAL_ALREADY_RESOLVED')
  })

  it('reports an answer to a request that does not exist', () => {
    const result = approvals.respond({ approvalId: uuidv7(), decision: 'approve', via: 'web' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('timeout means denied', () => {
  it('refuses a yes that arrives after the deadline, and settles the request', () => {
    // Chapter 19's seventh absolute rule. A "yes" a second late is a denial;
    // treating it as an approval would make the deadline advisory.
    const request = ask({ riskClass: 'medium' })
    clock = request.expiresAt

    const late = approvals.respond({ approvalId: request.id, decision: 'approve', via: 'web' })

    expect(late.ok).toBe(false)
    expect(statusOf(request.id)).toBe('expired')
  })

  it('lapses unanswered requests on a sweep', () => {
    const soon = ask({ riskClass: 'medium', lifetimeMs: 1_000 })
    const later = ask({ riskClass: 'medium', title: 'Not yet due' })

    clock += 1_000
    const lapsed = swept()

    expect(lapsed.map((r) => r.id)).toEqual([soon.id])
    expect(statusOf(soon.id)).toBe('expired')
    expect(statusOf(later.id)).toBe('pending')
  })

  it('records when a request lapsed, and that nobody answered it', () => {
    const request = ask({ riskClass: 'medium', lifetimeMs: 1_000 })
    clock += 5_000

    const [lapsed] = swept()

    expect(lapsed?.respondedAt).toBe(clock)
    expect(lapsed?.respondedVia).toBeNull()
    expect(request.status).toBe('pending')
  })

  it('sweeps nothing when nothing is due', () => {
    ask()

    expect(swept()).toEqual([])
  })

  it('uses the wall clock when none is injected', () => {
    const live = createApprovalRegistry({ store: createInMemoryApprovalStore() })
    const result = live.request(input())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.createdAt).toBeLessThanOrEqual(Date.now())
    expect(unwrap(live.sweepExpired())).toEqual([])
  })
})
