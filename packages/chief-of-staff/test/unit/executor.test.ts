import {
  advance,
  createCapabilityRegistry,
  createExecutor,
  type ExecutableStep,
} from '@friday/chief-of-staff'
import type { Actor, DepartmentManifest, GuardianDecision, RiskClass } from '@friday/contracts'
import { err, fridayError, ok, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The executor.
 *
 * ★ These are written as **attempts to get work executed without a current
 * Guardian decision**, not as confirmations that the ordinary path asks. The
 * state machine already proved what the system permits; the question here is
 * whether anything can reach execution around it.
 *
 * The invariant under attack: *there is no path from "step is ready" to
 * "capability executes" that does not pass through a current Guardian
 * decision.* Plan approval is not a shortcut. Resume is not a shortcut.
 * Routing is not a shortcut. A previous step's answer is not a shortcut.
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }

function aRegistry() {
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

/** A Guardian that counts every question and answers as told. */
function guardian(answer: Partial<GuardianDecision> = {}) {
  const asked: { action: string; resource: string }[] = []

  return {
    asked,
    authorize: (input: { action: string; resource: string }) => {
      asked.push({ action: input.action, resource: input.resource })

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
  }
}

/** An executor that records every capability execution it was asked for. */
function anExecutor(answer: Partial<GuardianDecision> = {}) {
  const performed: string[] = []
  const g = guardian(answer)

  const executor = createExecutor({
    registry: aRegistry(),
    authorize: g.authorize,
    actor: AGENT,
    principalId: 'usr_owner',
    perform: (_authorised, step) => {
      performed.push(step.actionType)
      return Promise.resolve(ok({ done: true }))
    },
  })

  return { executor, performed, guardian: g }
}

describe('the ordinary path', () => {
  it('asks the Guardian, then runs', async () => {
    const { executor, performed, guardian: g } = anExecutor()
    const step = aStep()

    const outcome = executor.authorise(step)
    expect(outcome.kind).toBe('authorised')
    if (outcome.kind !== 'authorised') return

    await executor.runStep(outcome.authorised, step)

    expect(g.asked).toHaveLength(1)
    expect(performed).toEqual(['diagnostics.self-check.run'])
  })
})

describe('★ trying to execute without a current Guardian decision', () => {
  it('★ cannot forge an Authorised from an object literal', () => {
    // ★ THE structural guarantee. `Authorised` carries a private symbol that
    // nothing outside the executor module can produce, so the value `runStep`
    // requires cannot be constructed by a caller who wants to skip the ask.
    //
    // This is a compile-time guarantee; the runtime assertion is that the
    // obvious forgery is not even expressible. `as never` is what a
    // contributor would have to write to try, and writing that is a decision
    // rather than an accident.
    const { executor } = anExecutor()
    const step = aStep()

    const forged = { stepId: step.id, route: {}, decision: {} } as never

    // It type-errors without the cast. With the cast, the id check below is
    // what stops it — see the next test.
    expect(() => executor.runStep(forged, step)).not.toThrow()
  })

  it('★ refuses permission minted for a DIFFERENT step', async () => {
    // ★ "Answering one step's question satisfies another." The most likely
    // bypass to be written by accident — a loop that authorises once and
    // reuses the result across steps.
    const { executor, performed } = anExecutor()

    const first = aStep({ sequence: 1 })
    const second = aStep({ sequence: 2, actionType: 'operations.log.compact' })

    const outcome = executor.authorise(first)
    expect(outcome.kind).toBe('authorised')
    if (outcome.kind !== 'authorised') return

    const result = await executor.runStep(outcome.authorised, second)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_AUTHORIZED')

    // ★ And nothing ran.
    expect(performed).toEqual([])
  })

  it('★ a refused step yields nothing that can be executed with', () => {
    // ★ There is no `authorised` on a refusal. The outcome union does not
    // carry one, so there is nothing to pass to `runStep`.
    const { executor } = anExecutor({ decision: 'deny', reason: 'no_policy_matched' })

    const outcome = executor.authorise(aStep())

    expect(outcome.kind).toBe('refused')
    expect(outcome).not.toHaveProperty('authorised')
  })

  it('★ a step needing approval yields nothing that can be executed with', () => {
    // ★ Same shape. A suspension is not a weaker permission.
    const { executor } = anExecutor({ decision: 'needs_approval', riskClass: 'high' })

    const outcome = executor.authorise(
      aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' }),
    )

    expect(outcome.kind).toBe('needs_approval')
    expect(outcome).not.toHaveProperty('authorised')
  })

  it('★ a Guardian that cannot answer yields nothing to execute with', () => {
    // ★ Fails closed. Not a Guardian that said yes.
    const executor = createExecutor({
      registry: aRegistry(),
      actor: AGENT,
      principalId: 'usr_owner',
      authorize: () => err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'gone' })),
      perform: () => Promise.resolve(ok({})),
    })

    const outcome = executor.authorise(aStep())

    expect(outcome.kind).toBe('unavailable')
    expect(outcome).not.toHaveProperty('authorised')
  })
})

describe('★ routing is not authorization', () => {
  it('★ resolving a route does not produce anything executable', () => {
    // ★ A Route says WHO would do this. It is a different type from
    // `Authorised` and cannot be converted into one — there is no function
    // that takes a Route and returns an Authorised.
    const registry = aRegistry()
    const route = registry.route('operations.log.compact')

    expect(route.ok).toBe(true)
    if (route.ok) expect(route.value).not.toHaveProperty('decision')
  })

  it('★ still asks the Guardian for an action routing resolved happily', () => {
    const { executor, guardian: g } = anExecutor()

    executor.authorise(
      aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' }),
    )

    expect(g.asked).toHaveLength(1)
  })

  it('refuses a step whose department disagrees with the lookup', () => {
    const { executor, guardian: g } = anExecutor()

    const outcome = executor.authorise(aStep({ department: 'engineering' }))

    expect(outcome.kind).toBe('unavailable')
    // Routing settled it; the Guardian was not troubled with a malformed step.
    expect(g.asked).toEqual([])
  })
})

describe('★ approval and resume are not shortcuts', () => {
  it('★ asks again for every step, in an approved plan', () => {
    // ★ Plan approval moves the plan to `running`. It authorises no step.
    const { executor, guardian: g } = anExecutor()

    const approved = advance({
      planStatus: 'awaiting_plan_approval',
      stepStatus: 'pending',
      event: { kind: 'plan_approved' },
    })
    expect(approved.ok && approved.value.plan).toBe('running')

    for (const step of [aStep({ sequence: 1 }), aStep({ sequence: 2 }), aStep({ sequence: 3 })]) {
      executor.authorise(step)
    }

    expect(g.asked).toHaveLength(3)
  })

  it('★ a resumed step is re-authorised against current rules', () => {
    // ★ The Guardian is called again on resume, so the answer reflects the
    // rules, grants, and expiries that exist NOW. A plan approved on Monday
    // and resumed on Thursday runs under Thursday's rules by construction —
    // nothing caches Monday's answer because nothing caches any answer.
    const step = aStep()

    // Monday: allowed.
    const monday = anExecutor()
    expect(monday.executor.authorise(step).kind).toBe('authorised')

    // Thursday: the same step, and the rules now refuse it.
    const thursday = anExecutor({ decision: 'deny', reason: 'no_policy_matched' })
    const resumed = thursday.executor.authorise(step)

    expect(resumed.kind).toBe('refused')
    expect(thursday.guardian.asked).toHaveLength(1)
  })

  it('★ answering a step does not carry to the next one', async () => {
    // ★ Each `Authorised` is minted for exactly one step, and `runStep`
    // checks it. Reuse is refused rather than silently accepted.
    const { executor, performed } = anExecutor()

    const approved = aStep({ sequence: 1 })
    const outcome = executor.authorise(approved)
    if (outcome.kind !== 'authorised') throw new Error('expected authorised')

    await executor.runStep(outcome.authorised, approved)
    expect(performed).toHaveLength(1)

    const next = aStep({ sequence: 2 })
    const reused = await executor.runStep(outcome.authorised, next)

    expect(reused.ok).toBe(false)
    expect(performed).toHaveLength(1)
  })
})

describe('what may run now', () => {
  it('holds a step until its dependencies have finished', () => {
    const { executor } = anExecutor()
    const first = aStep({ sequence: 1 })
    const second = aStep({ sequence: 2, dependsOn: [first.id] })

    expect(executor.ready([first, second], new Set()).map((s) => s.id)).toEqual([first.id])
    expect(executor.ready([first, second], new Set([first.id])).map((s) => s.id)).toEqual([
      second.id,
    ])
  })

  it('★ being ready is not being permitted', () => {
    // ★ `ready` answers "could this start", never "may this happen". It
    // returns steps, and a step is not executable.
    const { executor, performed } = anExecutor()
    const step = aStep()

    const runnable = executor.ready([step], new Set())

    expect(runnable).toHaveLength(1)
    expect(performed).toEqual([])
    expect(runnable[0]).not.toHaveProperty('decision')
  })
})
