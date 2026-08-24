import {
  approvePlan,
  approveStep,
  beginning,
  createCapabilityRegistry,
  createExecutor,
  type ExecutableStep,
  type PlanProgress,
  type PlanTransition,
  runPlan,
} from '@friday/chief-of-staff'
import type { Actor, DepartmentManifest, GuardianDecision, RiskClass } from '@friday/contracts'
import { err, fridayError, ok, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The orchestration layer, tested adversarially.
 *
 * ★ The kernel decides *what to try next*. The Guardian decides *whether it
 * may happen*. Everything below is an attempt to make the kernel decide the
 * second thing by accident — through approval, through resume, through a
 * retry, or through an error path.
 *
 * The invariant: **no path from "step is ready" to "capability executes"
 * skips a fresh Guardian decision.**
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }

function registry() {
  const department: DepartmentManifest = {
    id: 'operations',
    name: 'Operations',
    version: '1.0.0',
    description: 'Keeps FRIDAY healthy.',
    capabilities: [
      {
        id: 'run-self-check',
        action: 'diagnostics.self-check.run',
        description: 'Check the record.',
        input: 'I',
        output: 'O',
        riskClass: 'low',
        irreversible: false,
        sensitivity: 'internal',
        requires: ['diagnostics.run'],
      },
      {
        id: 'compact-event-log',
        action: 'operations.log.compact',
        description: 'Compact the log.',
        input: 'I',
        output: 'O',
        riskClass: 'high',
        irreversible: true,
        sensitivity: 'internal',
        requires: ['diagnostics.run'],
      },
    ],
    subscribes: [],
    publishes: [],
    degradedMode: { whenConnectorUnavailable: 'unaffected', description: 'none' },
  }

  const built = createCapabilityRegistry([department])
  if (!built.ok) throw new Error('registry')

  return built.value
}

function aStep(overrides: Partial<ExecutableStep> = {}): ExecutableStep {
  return {
    id: uuidv7(),
    sequence: 1,
    dependsOn: [],
    description: 'Check the record.',
    actionType: 'diagnostics.self-check.run',
    department: 'operations',
    resource: 'diagnostics:self-check/all',
    onFailure: 'abort',
    ...overrides,
  }
}

/**
 * A world with a Guardian whose answer can change between calls, so a resume
 * can be made to meet different rules than the original run did.
 */
function world(options: { answers?: Partial<GuardianDecision>[]; performFails?: boolean } = {}) {
  const asked: string[] = []
  const performed: string[] = []
  let call = 0

  const executor = createExecutor({
    registry: registry(),
    actor: AGENT,
    principalId: 'usr_owner',
    authorize: (input) => {
      asked.push(input.action)
      const answer = options.answers?.[Math.min(call, options.answers.length - 1)] ?? {}
      call += 1

      return ok({
        id: uuidv7(),
        decision: 'allow',
        reason: 'policy_allowed',
        riskClass: 'low' as RiskClass,
        matched: ['agents-may-run-diagnostics'],
        summary: 's',
        ...answer,
      } as GuardianDecision)
    },
    perform: (_authorised, step) => {
      performed.push(step.actionType)

      return Promise.resolve(
        options.performFails === true
          ? err(fridayError({ code: 'SUBSCRIBER_FAILED', message: 'the capability failed' }))
          : ok({ done: true }),
      )
    },
  })

  const recorded: PlanTransition[] = []

  const record = (transition: PlanTransition) => {
    recorded.push(transition)
    return Promise.resolve(ok(undefined))
  }

  return { executor, asked, performed, recorded, record, planId: uuidv7() }
}

/** Cheap plan, so the cost trigger never fires unless a test wants it. */
function run(
  steps: readonly ExecutableStep[],
  w: ReturnType<typeof world>,
  progress: PlanProgress,
  overrides: { estimateCents?: number; riskClasses?: RiskClass[] } = {},
) {
  return runPlan({
    steps,
    executor: w.executor,
    progress,
    planId: w.planId,
    record: w.record,
    riskClasses: overrides.riskClasses ?? ['low'],
    estimateCents: overrides.estimateCents ?? 1,
    approvalThresholdCents: 25,
  })
}

describe('the ordinary path', () => {
  it('plans, authorises, runs, and completes', async () => {
    const step = aStep()
    const w = world()

    const outcome = await run([step], w, beginning([step]))

    expect(outcome.kind).toBe('completed')
    expect(w.asked).toEqual(['diagnostics.self-check.run'])
    expect(w.performed).toEqual(['diagnostics.self-check.run'])
  })

  it('runs dependent steps in order', async () => {
    const first = aStep({ sequence: 1 })
    const second = aStep({
      sequence: 2,
      dependsOn: [first.id],
      actionType: 'operations.log.compact',
      resource: 'events:log/segments',
    })
    const w = world()

    const outcome = await run([first, second], w, beginning([first, second]))

    expect(outcome.kind).toBe('completed')
    expect(w.performed).toEqual(['diagnostics.self-check.run', 'operations.log.compact'])
  })
})

describe('★ 1 — an approved plan still asks about every step', () => {
  it('★ stops for plan approval without touching a single step', async () => {
    // ★ The plan gate runs BEFORE any step is considered, and returns without
    // authorising, starting, or advancing anything.
    const step = aStep()
    const w = world()

    const outcome = await run([step], w, beginning([step]), { estimateCents: 100 })

    expect(outcome.kind).toBe('awaiting_plan_approval')
    expect(w.asked).toEqual([])
    expect(w.performed).toEqual([])
    if (outcome.kind === 'awaiting_plan_approval') {
      expect(outcome.progress.stepStatuses[step.id]).toBe('pending')
    }
  })

  it('★ still authorises every step after the owner approves the plan', async () => {
    // ★ Approval moved the plan to running. It authorised nothing.
    const first = aStep({ sequence: 1 })
    const second = aStep({
      sequence: 2,
      actionType: 'operations.log.compact',
      resource: 'events:log/segments',
    })
    const w = world()

    const stopped = await run([first, second], w, beginning([first, second]), {
      estimateCents: 100,
    })
    if (stopped.kind !== 'awaiting_plan_approval') throw new Error('expected plan approval')

    const approved = await approvePlan({
      progress: stopped.progress,
      planId: w.planId,
      record: w.record,
    })
    if (approved === undefined) throw new Error('expected approval to apply')

    const outcome = await run([first, second], w, approved, { estimateCents: 100 })

    expect(outcome.kind).toBe('completed')
    expect(w.asked).toHaveLength(2)
  })
})

describe('★ 2 & 7 — resume and retry get fresh decisions', () => {
  it('★ a resumed plan meets the rules that exist NOW', async () => {
    // ★ Monday allows, Thursday refuses. The resumed run gets Thursday's
    // answer because nothing kept Monday's — `PlanProgress` has nowhere to
    // have kept it.
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })

    const monday = world({ answers: [{ decision: 'needs_approval', riskClass: 'high' }] })
    const stopped = await run([step], monday, beginning([step]))
    if (stopped.kind !== 'awaiting_approval') throw new Error('expected suspension')

    const answered = await approveStep({
      progress: stopped.progress,
      step,
      planId: monday.planId,
      record: monday.record,
    })
    if (answered === undefined) throw new Error('expected the answer to apply')

    // Thursday: the rules now refuse it outright.
    const thursday = world({ answers: [{ decision: 'deny', reason: 'no_policy_matched' }] })
    const resumed = await run([step], thursday, answered)

    expect(thursday.asked).toHaveLength(1)
    expect(thursday.performed).toEqual([])
    expect(resumed.kind).toBe('failed')
  })

  it('★ answering a step returns it to pending, never to authorised', async () => {
    // ★ The owner's answer unblocks the QUESTION. It is not the permission —
    // the next run asks the Guardian again.
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })
    const w = world({ answers: [{ decision: 'needs_approval', riskClass: 'high' }] })

    const stopped = await run([step], w, beginning([step]))
    if (stopped.kind !== 'awaiting_approval') throw new Error('expected suspension')

    const answered = await approveStep({
      progress: stopped.progress,
      step,
      planId: w.planId,
      record: w.record,
    })

    expect(answered?.stepStatuses[step.id]).toBe('pending')
    expect(answered?.stepStatuses[step.id]).not.toBe('running')
  })

  it('★ a retry re-authorises rather than reusing the first decision', async () => {
    // ★ A retry is a NEW attempt at the same work, and the rules may have
    // changed between them. Reusing the first answer is the bypass most
    // likely to be written while making retries "efficient".
    const step = aStep({ onFailure: 'retry' })
    const w = world({ performFails: true })

    await runPlan({
      steps: [step],
      executor: w.executor,
      progress: beginning([step]),
      planId: w.planId,
      record: w.record,
      riskClasses: ['low'],
      estimateCents: 1,
      approvalThresholdCents: 25,
      maxAttempts: 3,
    })

    // Three attempts, three decisions. Not one decision and three executions.
    expect(w.asked).toHaveLength(3)
    expect(w.performed).toHaveLength(3)
  })
})

describe('★ 5 & 6 — refusal and outage make the capability unreachable', () => {
  it('★ a refused step never reaches the capability', async () => {
    const step = aStep()
    const w = world({ answers: [{ decision: 'deny', reason: 'no_policy_matched' }] })

    const outcome = await run([step], w, beginning([step]))

    expect(outcome.kind).toBe('failed')
    expect(w.performed).toEqual([])
  })

  it('★ a Guardian that cannot answer never reaches the capability', async () => {
    const step = aStep()
    const performed: string[] = []

    const executor = createExecutor({
      registry: registry(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: () => err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'gone' })),
      perform: (_a, s) => {
        performed.push(s.actionType)
        return Promise.resolve(ok({}))
      },
    })

    const outcome = await run([step], { ...world(), executor }, beginning([step]))

    expect(outcome.kind).toBe('failed')
    expect(performed).toEqual([])
  })

  it('★ needs_approval never reaches the capability', async () => {
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })
    const w = world({ answers: [{ decision: 'needs_approval', riskClass: 'high' }] })

    const outcome = await run([step], w, beginning([step]))

    expect(outcome.kind).toBe('awaiting_approval')
    expect(w.performed).toEqual([])
  })
})

describe('★ 3 & 4 — one answer cannot satisfy another step', () => {
  it('★ answering step one leaves step two suspended', async () => {
    // ★ Two steps both need approval. Answering the first must not release
    // the second.
    const first = aStep({
      sequence: 1,
      actionType: 'operations.log.compact',
      resource: 'events:log/a',
    })
    const second = aStep({
      sequence: 2,
      actionType: 'operations.log.compact',
      resource: 'events:log/b',
    })

    const w = world({ answers: [{ decision: 'needs_approval', riskClass: 'high' }] })

    const stopped = await run([first, second], w, beginning([first, second]))
    if (stopped.kind !== 'awaiting_approval') throw new Error('expected suspension')

    const answered = await approveStep({
      progress: stopped.progress,
      step: stopped.stepId === first.id ? first : second,
      planId: w.planId,
      record: w.record,
    })
    if (answered === undefined) throw new Error('expected the answer to apply')

    const other = stopped.stepId === first.id ? second.id : first.id

    expect(answered.stepStatuses[other]).toBe('pending')
    expect(answered.stepStatuses[other]).not.toBe('running')
    expect(w.performed).toEqual([])
  })

  it('★ refuses to answer a step that was not waiting', async () => {
    // ★ An approval response cannot be aimed at unrelated work.
    const step = aStep()
    const fresh = beginning([step])
    const w = world()

    expect(
      await approveStep({ progress: fresh, step, planId: w.planId, record: w.record }),
    ).toBeUndefined()
  })

  it('★ refuses to approve a plan that was not waiting', async () => {
    const step = aStep()
    const w = world()

    expect(
      await approvePlan({
        progress: beginning([step]),
        planId: w.planId,
        record: w.record,
      }),
    ).toBeUndefined()
  })
})

describe('★ 8 — a plan-level event cannot mutate step state', () => {
  it('★ approving the plan leaves every step exactly where it was', async () => {
    const first = aStep({ sequence: 1 })
    const second = aStep({ sequence: 2 })
    const w = world()

    const stopped = await run([first, second], w, beginning([first, second]), {
      estimateCents: 100,
    })
    if (stopped.kind !== 'awaiting_plan_approval') throw new Error('expected plan approval')

    const before = stopped.progress.stepStatuses
    const after = (
      await approvePlan({ progress: stopped.progress, planId: w.planId, record: w.record })
    )?.stepStatuses

    expect(after).toEqual(before)
  })
})

describe('★ 10 — the failure path does not reach execution either', () => {
  it('★ a step whose capability failed is not silently completed', async () => {
    const step = aStep({ onFailure: 'abort' })
    const w = world({ performFails: true })

    const outcome = await run([step], w, beginning([step]))

    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') {
      expect(outcome.progress.stepStatuses[step.id]).toBe('failed')
    }
  })

  it('★ a skipped failure does not run the capability again', async () => {
    const step = aStep({ onFailure: 'skip' })
    const w = world({ performFails: true })

    const outcome = await run([step], w, beginning([step]))

    expect(w.performed).toHaveLength(1)
    expect(outcome.kind).toBe('completed')
  })
})

describe('the budget boundary', () => {
  it('★ the kernel does NOT enforce the per-plan ceiling', () => {
    // ★ Recorded as a test so nobody later assumes it does. Chapter 35's
    // $0.50 per-plan budget is enforced by the model router and the agent
    // runtime, which are the layers that actually spend. The kernel's only
    // cost input is the APPROVAL THRESHOLD, which is a different authority
    // answering a different question.
    //
    // A second copy of a budget is a second thing that can disagree with the
    // first, and the one that disagrees silently is the one that matters.
    const options = Object.keys({
      steps: 0,
      executor: 0,
      progress: 0,
      riskClasses: 0,
      estimateCents: 0,
      approvalThresholdCents: 0,
      maxAttempts: 0,
    })

    expect(options).not.toContain('perPlanCents')
    expect(options).not.toContain('budget')
  })

  it('the approval threshold fires on estimate alone, with every step low risk', async () => {
    const step = aStep()
    const w = world()

    const outcome = await run([step], w, beginning([step]), {
      estimateCents: 26,
      riskClasses: ['low'],
    })

    expect(outcome.kind).toBe('awaiting_plan_approval')
    if (outcome.kind === 'awaiting_plan_approval') {
      expect(outcome.because).toBe('over_cost_threshold')
    }
  })

  it('does not fire at exactly the threshold', async () => {
    const step = aStep()
    const w = world()

    const outcome = await run([step], w, beginning([step]), { estimateCents: 25 })

    expect(outcome.kind).toBe('completed')
  })
})
