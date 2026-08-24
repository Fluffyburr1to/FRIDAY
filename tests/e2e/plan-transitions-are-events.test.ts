import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuditor } from '@friday/audit'
import {
  approvePlan,
  approveStep,
  beginning,
  createCapabilityRegistry,
  createExecutor,
  type ExecutableStep,
  eventsFor,
  type PlanTransition,
  runPlan,
} from '@friday/chief-of-staff'
import type { Actor, CorrelationId, DepartmentManifest, GuardianDecision } from '@friday/contracts'
import { err, fridayError, ok, registerPlanEventTypes, uuidv7 } from '@friday/contracts'
import { createEventBus, type EventBus } from '@friday/kernel'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ Every transition publishes an event, through the real bus.
 *
 * Chapter 12: *"Every transition publishes an event. The plan's current state
 * is a projection of those events."* This file holds that to its word against
 * the actual event log — registered types, validated payloads, the hash chain,
 * and the auditor that reads it back.
 *
 * Two things are being defended, and they are different:
 *
 *   1. **The events are the transitions.** Replaying them arrives at the same
 *      status the kernel holds. An event that merely narrated what happened
 *      could drift from it, and nothing would notice.
 *   2. **A transition that did not happen has no event.** A refused move
 *      publishes nothing, and an unrecordable move does not happen at all.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/10-event-bus.md
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }
const OWNER = 'usr_tyler'

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 7).toString('base64'),
})

let directory: string
let storage: Storage
let bus: EventBus
let correlationId: CorrelationId

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
 * The real recorder: a transition becomes events on the real bus.
 *
 * ★ This is the whole seam, and it is four lines. `eventsFor` derives the
 * events from the accepted transition, `publish` validates them against the
 * registered schemas, and a publish that fails is returned as a failure —
 * which stops the plan.
 */
function recorder(planId: string) {
  const published: string[] = []

  const record = async (transition: PlanTransition) => {
    for (const event of eventsFor(transition, {
      actor: AGENT,
      principalId: OWNER,
      correlationId,
    })) {
      const written = await bus.publish(event)
      if (!written.ok) return written

      published.push(written.value.type)
    }

    return ok(undefined)
  }

  return { record, published, planId }
}

function executorAnswering(
  byAction: Readonly<Record<string, Partial<GuardianDecision>>>,
  options: { performFails?: boolean } = {},
) {
  const performed: string[] = []

  const executor = createExecutor({
    registry: registry(),
    actor: AGENT,
    principalId: OWNER,
    authorize: (input) =>
      ok({
        id: uuidv7(),
        decision: 'allow',
        reason: 'policy_allowed',
        riskClass: 'low',
        matched: ['agents-may-run-diagnostics'],
        summary: 's',
        ...byAction[input.action],
      } as GuardianDecision),
    perform: (_authorised, step) => {
      performed.push(step.actionType)

      return Promise.resolve(
        options.performFails === true
          ? err(fridayError({ code: 'SUBSCRIBER_FAILED', message: 'the capability failed' }))
          : ok({ done: true }),
      )
    },
  })

  return { executor, performed }
}

function run(
  steps: readonly ExecutableStep[],
  executor: ReturnType<typeof executorAnswering>['executor'],
  progress: Parameters<typeof runPlan>[0]['progress'],
  clerk: ReturnType<typeof recorder>,
  overrides: { estimateCents?: number; maxAttempts?: number } = {},
) {
  return runPlan({
    steps,
    executor,
    progress,
    planId: clerk.planId,
    record: clerk.record,
    riskClasses: ['low'],
    estimateCents: overrides.estimateCents ?? 1,
    approvalThresholdCents: 25,
    maxAttempts: overrides.maxAttempts ?? 3,
  })
}

/** Every event this run wrote, in the log's own order. */
function log(): { type: string; payload: Record<string, unknown> }[] {
  const read = storage.events.readByCorrelation({ correlationId, principalId: OWNER })
  if (!read.ok) throw new Error('the log would not read back')

  return read.value.map((event) => ({ type: event.type, payload: event.payload }))
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-plan-events-'))
  correlationId = uuidv7()

  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })

  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)

  storage = opened.value
  bus = createEventBus({ storage, principalId: OWNER })
  registerPlanEventTypes(bus.registry)
})

afterEach(async () => {
  await bus.stop()
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('the events ARE the transitions', () => {
  it('★ replaying the events arrives at the status the kernel holds', async () => {
    // ★ The property Chapter 12 actually claims. A projection built from
    // nothing but the log lands on the same status the kernel is holding — so
    // the dashboard's live view and the audit trail are one thing, not two
    // that have to be kept in step.
    const step = aStep()
    const clerk = recorder(uuidv7())

    const outcome = await run([step], executorAnswering({}).executor, beginning([step]), clerk)

    const planStatus = log()
      .map((event) => event.payload.to ?? event.payload.planTo)
      .filter((status): status is string => typeof status === 'string')
      .at(-1)

    expect(outcome.progress.planStatus).toBe('completed')
    expect(planStatus).toBe(outcome.progress.planStatus)
  })

  it('★ the moves join up end to end, so the log is one continuous account', async () => {
    // ★ What makes these transitions rather than log lines, and it is not
    // enough that a `from` field exists — it has to be the status the plan was
    // ACTUALLY in. Every event's `from` must be the previous event's `to`, at
    // both levels, or a reader rebuilding the plan is quietly rebuilding a
    // different one.
    //
    // The run below is deliberately the awkward shape: suspended for the
    // owner, answered, and resumed, so the step moves through five statuses
    // rather than the easy two.
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })
    const clerk = recorder(uuidv7())

    const suspending = executorAnswering({
      'operations.log.compact': { decision: 'needs_approval', riskClass: 'high' },
    })

    const stopped = await run([step], suspending.executor, beginning([step]), clerk)
    if (stopped.kind !== 'awaiting_approval') throw new Error('expected suspension')

    const answered = await approveStep({
      progress: stopped.progress,
      step,
      planId: clerk.planId,
      record: clerk.record,
    })

    if (answered === undefined) throw new Error('expected the answer to apply')

    await run([step], executorAnswering({}).executor, answered, clerk)

    let plan = 'draft'
    let stepStatus = 'pending'

    for (const event of log()) {
      if (event.type.startsWith('plan.step.')) {
        expect([event.type, event.payload.stepFrom]).toEqual([event.type, stepStatus])
        stepStatus = event.payload.stepTo as string
        continue
      }

      expect([event.type, event.payload.from]).toEqual([event.type, plan])
      plan = event.payload.to as string
    }

    // And the walk ended where the kernel did, having passed through
    // suspension and back rather than going straight there.
    expect(plan).toBe('completed')
    expect(stepStatus).toBe('completed')
  })

  it('★ plan-level and step-level are different events', async () => {
    // ★ Conflating them is how approving a plan quietly becomes approving its
    // steps. `plan.resumed` is emitted for the owner approving the SHAPE and
    // names no step at all; the steps still ask afterwards.
    const step = aStep()
    const clerk = recorder(uuidv7())

    const suspended = await run([step], executorAnswering({}).executor, beginning([step]), clerk, {
      estimateCents: 100,
    })

    expect(suspended.kind).toBe('awaiting_plan_approval')

    const approved = await approvePlan({
      progress: suspended.progress,
      planId: clerk.planId,
      record: clerk.record,
    })

    if (approved === undefined) throw new Error('expected the approval to apply')

    const resumed = log().find((event) => event.type === 'plan.resumed')

    expect(resumed).toBeDefined()
    expect(resumed?.payload.stepId).toBeUndefined()
    expect(clerk.published).toEqual(['plan.created', 'plan.resumed'])

    // And the steps still had to ask, afterwards.
    const w = executorAnswering({})
    await run([step], w.executor, approved, clerk)

    expect(clerk.published).toContain('plan.step.started')
  })
})

describe('what is asked for, and what is answered', () => {
  it('★ suspension, approval, and resumption are each represented', async () => {
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })
    const clerk = recorder(uuidv7())

    const suspending = executorAnswering({
      'operations.log.compact': { decision: 'needs_approval', riskClass: 'high' },
    })

    const stopped = await run([step], suspending.executor, beginning([step]), clerk)

    expect(stopped.kind).toBe('awaiting_approval')
    expect(clerk.published).toEqual([
      'plan.created',
      'plan.step.started',
      'plan.step.suspended',
      // ★ The step suspended, and so did the plan. Two levels, two events —
      // and the plan's own move appears exactly once.
      'plan.suspended',
    ])

    const answered = await approveStep({
      progress: stopped.progress,
      step,
      planId: clerk.planId,
      record: clerk.record,
    })

    if (answered === undefined) throw new Error('expected the answer to apply')

    expect(clerk.published.slice(-2)).toEqual(['plan.step.resumed', 'plan.resumed'])

    // ★ And the resumed step went back through the Guardian: a second
    // `plan.step.started` for the same step, on a second attempt.
    const after = executorAnswering({})
    await run([step], after.executor, answered, clerk)

    const starts = log().filter((event) => event.type === 'plan.step.started')

    expect(starts).toHaveLength(2)
    expect(starts.map((event) => event.payload.attempt)).toEqual([1, 1])
    expect(after.performed).toEqual(['operations.log.compact'])
  })

  it('★ a retry is on the record, not a quiet second go', async () => {
    // ★ Three attempts appear as three failures and two retries. A log that
    // collapsed a retry into "back to pending" would show a step that failed
    // once, and the owner asking why something took three times as long would
    // find no answer.
    const step = aStep({ onFailure: 'retry' })
    const clerk = recorder(uuidv7())
    const w = executorAnswering({}, { performFails: true })

    await run([step], w.executor, beginning([step]), clerk, { maxAttempts: 3 })

    const failures = log().filter((event) => event.type === 'plan.step.failed')
    const retries = log().filter((event) => event.type === 'plan.step.retried')

    expect(w.performed).toHaveLength(3)
    expect(failures).toHaveLength(3)
    expect(retries).toHaveLength(2)

    // ★ The intention is recorded on the failure itself. A reader counting
    // failures would have to know the retry policy that was in force at the
    // time — and it does not, so it would guess.
    expect(failures.map((event) => event.payload.willRetry)).toEqual([true, true, false])
    expect(failures.map((event) => event.payload.attempt)).toEqual([1, 2, 3])
  })

  it('★ terminal transitions are represented, at both levels', async () => {
    const step = aStep()
    const clerk = recorder(uuidv7())

    await run([step], executorAnswering({}).executor, beginning([step]), clerk)

    expect(clerk.published).toEqual([
      'plan.created',
      'plan.step.started',
      'plan.step.completed',
      'plan.completed',
    ])
  })

  it('★ the step event comes before the plan event that ends the run', async () => {
    // ★ Fixed order, and it matters: an explanation is read top to bottom, and
    // "the plan finished" before "the last step finished" reads as though the
    // plan finished early.
    const step = aStep()
    const clerk = recorder(uuidv7())

    await run([step], executorAnswering({}).executor, beginning([step]), clerk)

    const types = log().map((event) => event.type)

    expect(types.indexOf('plan.step.completed')).toBeLessThan(types.indexOf('plan.completed'))
  })
})

describe('a step that is passed over', () => {
  it('★ is skipped, not completed, and still finishes the plan', async () => {
    // ★ Two things at once, and the second used to be a bug. A skipped step is
    // published as SKIPPED — never as completed, which would tell the owner
    // work happened that did not. And a plan whose last step was passed over
    // still ends, rather than sitting in `running` for ever with nothing left
    // that could run.
    const step = aStep({ onFailure: 'skip' })
    const clerk = recorder(uuidv7())
    const w = executorAnswering({}, { performFails: true })

    const outcome = await run([step], w.executor, beginning([step]), clerk)

    expect(outcome.kind).toBe('completed')
    expect(clerk.published).toEqual([
      'plan.created',
      'plan.step.started',
      'plan.step.skipped',
      'plan.completed',
    ])

    const finished = log().find((event) => event.type === 'plan.completed')

    expect(finished?.payload.stepsCompleted).toBe(0)
    expect(finished?.payload.stepsSkipped).toBe(1)
  })
})

describe('★ a failed transition emits no success', () => {
  it('★ a failing plan publishes plan.failed and never plan.completed', async () => {
    const step = aStep()
    const clerk = recorder(uuidv7())
    const w = executorAnswering({}, { performFails: true })

    const outcome = await run([step], w.executor, beginning([step]), clerk)

    expect(outcome.kind).toBe('failed')
    expect(clerk.published).toContain('plan.failed')
    expect(clerk.published).not.toContain('plan.completed')
    expect(clerk.published).not.toContain('plan.step.completed')
  })

  it('★ a refused move publishes nothing at all', async () => {
    // ★ The kernel asks the machine first and records only what it accepted.
    // Approving a plan that was never waiting is not a transition, so there is
    // no event — rather than an event saying it was approved.
    const step = aStep()
    const clerk = recorder(uuidv7())

    const refused = await approvePlan({
      progress: beginning([step]),
      planId: clerk.planId,
      record: clerk.record,
    })

    expect(refused).toBeUndefined()
    expect(clerk.published).toEqual([])
    expect(log()).toEqual([])
  })

  it('★ a transition that cannot be written down does not happen', async () => {
    // ★ Chapter 10's rule taken literally: writing the event IS how the thing
    // happens. The recorder refuses, and the plan stops where it was rather
    // than running on with a log that never heard about it.
    const step = aStep()
    const w = executorAnswering({})

    const outcome = await runPlan({
      steps: [step],
      executor: w.executor,
      progress: beginning([step]),
      planId: uuidv7(),
      record: () =>
        Promise.resolve(err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'disk gone' }))),
      riskClasses: ['low'],
      estimateCents: 1,
      approvalThresholdCents: 25,
    })

    expect(outcome.kind).toBe('failed')
    expect(outcome.progress.planStatus).toBe('draft')
    expect(w.performed).toEqual([])
    expect(log()).toEqual([])
  })

  it('★ an unregistered event type is refused rather than written', async () => {
    // ★ The bus is the backstop. A plan event only reaches the log because
    // `registerPlanEventTypes` was called on THIS bus — a recovery tool or a
    // script that never called it cannot assert that a plan advanced, even
    // holding the exact type string.
    const bare = createEventBus({ storage, principalId: OWNER })
    const step = aStep()

    const outcome = await runPlan({
      steps: [step],
      executor: executorAnswering({}).executor,
      progress: beginning([step]),
      planId: uuidv7(),
      record: async (transition) => {
        const [event] = eventsFor(transition, { actor: AGENT, principalId: OWNER, correlationId })
        if (event === undefined) throw new Error('a transition produced no event')

        const written = await bare.publish(event)

        return written.ok ? ok(undefined) : written
      },
      riskClasses: ['low'],
      estimateCents: 1,
      approvalThresholdCents: 25,
    })

    await bare.stop()

    expect(outcome.kind).toBe('failed')
    expect(log()).toEqual([])
  })
})

describe('the explanation reads from these events, not from a second story', () => {
  it('★ explains a whole run from the log alone', async () => {
    const step = aStep()
    const clerk = recorder(uuidv7())

    await run([step], executorAnswering({}).executor, beginning([step]), clerk)

    const auditor = createAuditor({ events: storage.events, registry: bus.registry })
    const why = auditor.why({ correlationId, principalId: OWNER, depth: 'full' })

    expect(why.ok).toBe(true)
    if (!why.ok) return

    const text = why.value.lines.map((line) => line.text)

    expect(text).toContain('FRIDAY worked out how to do this, in 1 step.')
    expect(text).toContain('Done: Check the record.')
    expect(text).toContain('The plan finished.')

    // ★ Every line is anchored to an event that says it. Nothing was inferred.
    expect(why.value.lines.every((line) => line.eventId.length > 0)).toBe(true)
  })

  it('★ says plainly that approving a plan approved only its shape', async () => {
    // ★ The sentence the owner reads back must not leave them thinking they
    // signed off on the individual actions. They did not — every step asked.
    const step = aStep()
    const clerk = recorder(uuidv7())

    const suspended = await run([step], executorAnswering({}).executor, beginning([step]), clerk, {
      estimateCents: 100,
    })

    await approvePlan({
      progress: suspended.progress,
      planId: clerk.planId,
      record: clerk.record,
    })

    const auditor = createAuditor({ events: storage.events, registry: bus.registry })
    const why = auditor.why({ correlationId, principalId: OWNER, depth: 'full' })

    expect(why.ok).toBe(true)
    if (!why.ok) return

    expect(why.value.lines.map((line) => line.text)).toContain(
      'You approved the shape of the plan. Each step still asked on its own.',
    )
  })
})
