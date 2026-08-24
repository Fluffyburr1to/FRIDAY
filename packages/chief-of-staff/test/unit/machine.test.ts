import type { PlanEvent } from '@friday/chief-of-staff'
import { nextStatus, nextStepStatus, planApprovalReason } from '@friday/chief-of-staff'
import type { PlanStatus } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The plan state machine.
 *
 * ★ The assertions that matter are about what approval **does not** buy. A
 * plan the owner approved as a whole must not become a plan whose steps stop
 * asking, because that would turn one click into a standing grant nobody wrote
 * down and nobody could expire.
 */

/** Walks a plan through a sequence of events, failing on the first refusal. */
function walk(from: PlanStatus, events: readonly PlanEvent[]): PlanStatus {
  let status = from

  for (const event of events) {
    const next = nextStatus(status, event)
    if (!next.ok) throw new Error(`${status} could not ${event.kind}: ${next.error.message}`)
    status = next.value
  }

  return status
}

describe('when the owner approves the shape before anything runs', () => {
  it('asks when a step is high risk', () => {
    const reason = planApprovalReason({
      riskClasses: ['low', 'high'],
      estimateCents: 1,
      thresholdCents: 100,
    })

    expect(reason).toBe('high_risk_step')
  })

  it('asks when the plan costs more than the threshold', () => {
    const reason = planApprovalReason({
      riskClasses: ['low', 'low'],
      estimateCents: 500,
      thresholdCents: 100,
    })

    expect(reason).toBe('over_cost_threshold')
  })

  it('★ asks even when every individual step is low risk, if it costs enough', () => {
    // ★ Chapter 12's reason: a sequence of individually-low-risk steps can be
    // collectively consequential. Reading mail is low risk, summarising it is
    // low risk, sending the summary somewhere is where it matters — and by
    // then five steps have run.
    expect(
      planApprovalReason({
        riskClasses: ['low', 'low', 'low', 'low', 'low'],
        estimateCents: 101,
        thresholdCents: 100,
      }),
    ).toBe('over_cost_threshold')
  })

  it('does not ask for ordinary cheap work', () => {
    expect(
      planApprovalReason({ riskClasses: ['low'], estimateCents: 1, thresholdCents: 100 }),
    ).toBeUndefined()
  })
})

describe('★ approving a plan is not approving its actions', () => {
  it('★ moves the plan to running, and nothing further', () => {
    // ★ THE rule this file is arranged around. `plan_approved` says the work
    // may BEGIN. It does not say any step inside it is permitted — every step
    // still goes to the Guardian on its own, at the moment it runs.
    expect(walk('draft', [{ kind: 'validated', needsPlanApproval: true }])).toBe(
      'awaiting_plan_approval',
    )
    expect(
      walk('draft', [{ kind: 'validated', needsPlanApproval: true }, { kind: 'plan_approved' }]),
    ).toBe('running')
  })

  it('★ still suspends a step that needs approval, inside an approved plan', () => {
    // ★ The assertion that would fail if plan approval were treated as blanket
    // authorization. The plan was approved; a step inside it asks anyway.
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: true },
      { kind: 'plan_approved' },
      { kind: 'step_started' },
      { kind: 'step_needs_approval' },
    ])

    expect(status).toBe('awaiting_approval')
  })

  it('★ suspends every step that asks, not only the first', () => {
    // ★ Answering one step's question must not answer the next one's. If it
    // did, a plan would need one approval and then run unattended.
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: false },
      { kind: 'step_needs_approval' },
      { kind: 'step_approved' },
      { kind: 'step_needs_approval' },
    ])

    expect(status).toBe('awaiting_approval')
  })

  it('a declined plan is cancelled rather than left waiting', () => {
    expect(
      walk('draft', [{ kind: 'validated', needsPlanApproval: true }, { kind: 'plan_declined' }]),
    ).toBe('cancelled')
  })
})

describe('running to the end', () => {
  it('completes when the last step completes', () => {
    expect(
      walk('draft', [
        { kind: 'validated', needsPlanApproval: false },
        { kind: 'step_started' },
        { kind: 'step_completed', remaining: 0 },
      ]),
    ).toBe('completed')
  })

  it('keeps running while steps remain', () => {
    expect(
      walk('draft', [
        { kind: 'validated', needsPlanApproval: false },
        { kind: 'step_completed', remaining: 2 },
      ]),
    ).toBe('running')
  })

  it('skips plan approval when nothing warrants it', () => {
    expect(walk('draft', [{ kind: 'validated', needsPlanApproval: false }])).toBe('running')
  })
})

describe('when a step fails, its declared action decides', () => {
  it.each([
    ['retry', 'running'],
    ['skip', 'running'],
    ['alternate', 'running'],
    ['abort', 'failed'],
    ['ask_user', 'awaiting_approval'],
  ] as const)('%s leaves the plan %s', (onFailure, expected) => {
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: false },
      { kind: 'step_started' },
      // One step left after this one, so `skip` does not finish the plan.
      { kind: 'step_failed', onFailure, remaining: 1, willRetry: onFailure === 'retry' },
    ])

    expect(status).toBe(expected)
  })

  it('★ a retry that will not happen fails the plan rather than leaving it running', () => {
    // ★ The step said `retry` and the attempts are spent. If the machine took
    // the declared action at face value the plan would stay `running` with
    // nothing left that could run — a plan that hangs rather than one that
    // failed, and only one of those is visible to the owner.
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: false },
      { kind: 'step_started' },
      { kind: 'step_failed', onFailure: 'retry', remaining: 0, willRetry: false },
    ])

    expect(status).toBe('failed')
  })

  it('★ a skipped last step finishes the plan', () => {
    // ★ Every step reached an end, and one of those ends was "we did not do
    // this". An earlier version left the plan running for ever.
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: false },
      { kind: 'step_started' },
      { kind: 'step_failed', onFailure: 'skip', remaining: 0, willRetry: false },
    ])

    expect(status).toBe('completed')
  })

  it('★ a retried step is a transition, not a quiet reset', () => {
    // ★ A retry is how one failure becomes three. A log that did not record it
    // would show a step failing once and then working, with no account of the
    // attempts in between.
    expect(nextStepStatus('failed', { kind: 'step_retried' })).toEqual({
      ok: true,
      value: 'pending',
    })
    expect(nextStatus('running', { kind: 'step_retried' })).toEqual({ ok: true, value: 'running' })
  })

  it('★ a failed step has exactly one way out', () => {
    // ★ `step_retried` and nothing else. There is no transition from `failed`
    // to `completed`, which is what stops a failure being talked away.
    for (const event of [
      { kind: 'step_completed', remaining: 0 },
      { kind: 'step_approved' },
      { kind: 'step_started' },
    ] as const) {
      expect(nextStepStatus('failed', event).ok).toBe(false)
    }
  })

  it('★ ask_user is a fresh question, not the plan approval being reused', () => {
    // ★ The plan was already approved as a whole, and a failure still puts a
    // new question in front of the owner. An approval covers what it covered.
    const status = walk('draft', [
      { kind: 'validated', needsPlanApproval: true },
      { kind: 'plan_approved' },
      { kind: 'step_started' },
      { kind: 'step_failed', onFailure: 'ask_user', remaining: 1, willRetry: false },
    ])

    expect(status).toBe('awaiting_approval')
  })
})

describe('transitions that are not real', () => {
  it('★ refuses to restart a finished plan', () => {
    // ★ Resuming a completed plan would let work be replayed by re-delivering
    // an old event.
    for (const done of ['completed', 'failed', 'cancelled'] as const) {
      expect(nextStatus(done, { kind: 'step_started' }).ok).toBe(false)
    }
  })

  it('refuses to approve a plan that never asked', () => {
    expect(nextStatus('running', { kind: 'plan_approved' }).ok).toBe(false)
  })

  it('refuses to start a step before the plan is running', () => {
    expect(nextStatus('awaiting_plan_approval', { kind: 'step_started' }).ok).toBe(false)
  })

  it('allows cancellation from anywhere still live', () => {
    for (const live of [
      'draft',
      'awaiting_plan_approval',
      'running',
      'awaiting_approval',
    ] as const) {
      expect(nextStatus(live, { kind: 'cancelled' }).ok).toBe(true)
    }
  })
})

describe('a step of its own', () => {
  it('★ returns a resumed step to pending, so it asks the Guardian again', () => {
    // ★ The approval that unblocked it authorised THAT action. It did not
    // exempt the step from asking — a plan approved on Monday and resumed on
    // Thursday runs against Thursday's rules, grants, and expiries.
    //
    // `pending` rather than `running` is the whole mechanism: `pending` is the
    // only status the run picks up, and picking it up is what calls the
    // Guardian. A step restored straight to `running` would be work already in
    // flight, and nothing would ask about it again.
    expect(nextStepStatus('awaiting_approval', { kind: 'step_approved' })).toEqual({
      ok: true,
      value: 'pending',
    })
  })

  it('marks a skipped failure skipped, and every other failure failed', () => {
    const failure = { kind: 'step_failed', remaining: 0, willRetry: false } as const

    expect(nextStepStatus('running', { ...failure, onFailure: 'skip' })).toEqual({
      ok: true,
      value: 'skipped',
    })
    expect(nextStepStatus('running', { ...failure, onFailure: 'abort' })).toEqual({
      ok: true,
      value: 'failed',
    })
  })

  it('refuses to complete a step that never started', () => {
    expect(nextStepStatus('pending', { kind: 'step_completed', remaining: 0 }).ok).toBe(false)
  })
})
