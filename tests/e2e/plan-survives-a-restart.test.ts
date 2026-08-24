import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approveStep,
  beginning,
  createCapabilityRegistry,
  createExecutor,
  type ExecutableStep,
  fromStored,
  type PlanProgress,
  runPlan,
  toStored,
} from '@friday/chief-of-staff'
import type {
  Actor,
  DepartmentManifest,
  GuardianDecision,
  Intent,
  Plan,
  PlanStep,
  RiskClass,
} from '@friday/contracts'
import { ok, uuidv7 } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ A plan that survives a restart, and asks again when it comes back.
 *
 * This is the lifecycle rather than the serialisation: **run → suspend →
 * persist → close every handle → reopen from disk → resume → fresh Guardian
 * decision → continue.** Every handle is genuinely closed and the databases
 * are genuinely reopened, because a test that kept the object in memory would
 * prove only that a field survived an assignment.
 *
 * The property being defended is the one that cannot be recovered once lost:
 * **nothing that could stand in for a Guardian answer crosses the restart.**
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · ADR-0045
 */

const AGENT: Actor = { type: 'agent', id: 'agent:operations/self-check' }
const OWNER = 'usr_tyler'

const KEYS = createInMemoryKeyProvider({
  'field-encryption-key': Buffer.alloc(32, 4).toString('base64'),
})

let directory: string
let storage: Storage

function boot(): Storage {
  const opened = openStorage({
    mainDbPath: join(directory, 'friday.db'),
    eventsDbPath: join(directory, 'events.db'),
    keys: KEYS,
    fieldKeyReference: 'field-encryption-key',
  })

  if (!opened.ok) throw new Error(`storage would not open: ${opened.error.message}`)

  return opened.value
}

function registry() {
  const department: DepartmentManifest = {
    id: 'operations',
    name: 'Operations',
    version: '1.0.0',
    description: 'Keeps FRIDAY healthy.',
    capabilities: [
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
    ],
    subscribes: [],
    publishes: [],
    degradedMode: { whenConnectorUnavailable: 'unaffected', description: 'none' },
  }

  const built = createCapabilityRegistry([department])
  if (!built.ok) throw new Error('registry')

  return built.value
}

function anIntent(): Intent {
  return { kind: 'operations.maintenance', confidence: 0.9, entities: {}, ambiguities: [] }
}

/** Writes a real plan and its steps, so progress has rows to live in. */
function persistPlan(store: Storage, steps: readonly ExecutableStep[]): string {
  const planId = uuidv7()
  const now = Date.now()

  const plan: Plan = {
    id: planId,
    principalId: OWNER,
    utterance: 'tidy up my records',
    intent: anIntent(),
    rationale: 'A check, then a compaction.',
    explanation: null,
    status: 'draft',
    correlationId: uuidv7(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    budgetTokens: null,
    budgetCents: null,
    budgetDeadlineMs: null,
    spentTokens: 0,
    spentCents: 0,
  }

  const created = store.plans.createPlan(plan)
  if (!created.ok) throw new Error(created.error.message)

  for (const step of steps) {
    const row: PlanStep = {
      id: step.id,
      planId,
      principalId: OWNER,
      sequence: step.sequence,
      dependsOn: [...step.dependsOn],
      description: step.description,
      status: 'pending',
      actionType: step.actionType,
      actionPayload: {},
      department: step.department,
      riskClass: 'low',
      onFailure: step.onFailure,
      approvalId: null,
      agentId: null,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      attempt: 0,
      idempotencyKey: uuidv7(),
    }

    const added = store.plans.addStep(row)
    if (!added.ok) throw new Error(added.error.message)
  }

  return planId
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
 * An executor whose Guardian answers per action, so one plan can contain both
 * work that proceeds and work that stops for the owner.
 */
function executorAnswering(byAction: Record<string, Partial<GuardianDecision>>) {
  const asked: string[] = []
  const performed: string[] = []

  const executor = createExecutor({
    registry: registry(),
    actor: AGENT,
    principalId: OWNER,
    authorize: (input) => {
      asked.push(input.action)

      return ok({
        id: uuidv7(),
        decision: 'allow',
        reason: 'policy_allowed',
        riskClass: 'low' as RiskClass,
        matched: ['agents-may-run-diagnostics'],
        summary: 's',
        ...(byAction[input.action] ?? {}),
      } as GuardianDecision)
    },
    perform: (_a, step) => {
      performed.push(step.actionType)
      return Promise.resolve(ok({ done: true }))
    },
  })

  return { executor, asked, performed }
}

/** An executor whose Guardian answer can differ between restarts. */
function executorSaying(answer: Partial<GuardianDecision>) {
  const asked: string[] = []
  const performed: string[] = []

  const executor = createExecutor({
    registry: registry(),
    actor: AGENT,
    principalId: OWNER,
    authorize: (input) => {
      asked.push(input.action)

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
    perform: (_a, step) => {
      performed.push(step.actionType)
      return Promise.resolve(ok({ done: true }))
    },
  })

  return { executor, asked, performed }
}

function run(
  steps: readonly ExecutableStep[],
  executor: ReturnType<typeof executorSaying>['executor'],
  progress: PlanProgress,
) {
  return runPlan({
    steps,
    executor,
    progress,
    riskClasses: ['low'],
    estimateCents: 1,
    approvalThresholdCents: 25,
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-resume-'))
  storage = boot()
})

afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('a plan that waits across a restart', () => {
  it('★ resumes, and asks the Guardian again rather than reusing the old answer', async () => {
    const check = aStep({ sequence: 1 })
    const compact = aStep({
      sequence: 2,
      actionType: 'operations.log.compact',
      resource: 'events:log/segments',
      dependsOn: [check.id],
    })
    const steps = [check, compact]

    const planId = persistPlan(storage, steps)

    // ── Before the restart ────────────────────────────────────────────────
    // ★ One real plan: the check proceeds, and the compaction stops for the
    // owner. Running the dependent step in isolation would not have exercised
    // the dependency at all.
    const before = executorAnswering({
      'operations.log.compact': { decision: 'needs_approval', riskClass: 'high' },
    })

    const suspended = await run(steps, before.executor, beginning(steps))

    expect(suspended.kind).toBe('awaiting_approval')
    if (suspended.kind !== 'awaiting_approval') return

    // The first step really did run, and the second really did stop.
    expect(before.performed).toEqual(['diagnostics.self-check.run'])
    expect(suspended.stepId).toBe(compact.id)

    const answered = approveStep(suspended.progress, compact.id)
    if (answered === undefined) throw new Error('expected the answer to apply')

    const saved = storage.plans.saveProgress({
      planId,
      principalId: OWNER,
      ...toStored(answered),
    })
    expect(saved.ok).toBe(true)

    // ── The restart ───────────────────────────────────────────────────────
    // Every handle closed; the databases reopened from disk. Nothing is
    // carried across in memory.
    storage.close()
    storage = boot()

    const reloaded = storage.plans.loadProgress({ planId, principalId: OWNER })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok || reloaded.value === undefined) return

    const resumedProgress = fromStored(reloaded.value)

    // ★ The step is pending — unblocked, not authorised.
    expect(resumedProgress.stepStatuses[compact.id]).toBe('pending')

    // ── After the restart: the rules have changed ─────────────────────────
    const after = executorSaying({ decision: 'deny', reason: 'no_policy_matched' })
    const resumed = await run([compact], after.executor, resumedProgress)

    // ★ THE assertion. The owner approved this before the restart, and it is
    // refused now — because the Guardian was asked again, against today's
    // rules, and nothing that survived the restart could answer for it.
    expect(after.asked).toEqual(['operations.log.compact'])
    expect(after.performed).toEqual([])
    expect(resumed.kind).toBe('failed')
  })

  it('★ persists nothing that could stand in for a permission', () => {
    const step = aStep()
    const stored = toStored(beginning([step]))

    // ★ Ids, statuses, counts. Nothing else crosses the restart.
    const shape = JSON.stringify(stored)

    expect(shape).not.toContain('decision')
    expect(shape).not.toContain('authoris')
    expect(shape).not.toContain('authoriz')
    expect(shape).not.toContain('capability')
    expect(shape).not.toContain('permit')
    expect(Object.keys(stored).sort()).toEqual(['planStatus', 'steps'])
    expect(Object.keys(stored.steps[0] ?? {}).sort()).toEqual(['attempt', 'id', 'status'])
  })

  it('★ brings an interrupted step back as pending, not running', () => {
    // ★ A step that was mid-flight when the process died was interrupted, not
    // finished. `pending` is what sends it through the Guardian again;
    // restoring it as `running` would resume work whose permission was never
    // re-established.
    const step = aStep()

    const recovered = fromStored({
      planStatus: 'running',
      steps: [{ id: step.id, status: 'running', attempt: 1 }],
    })

    expect(recovered.stepStatuses[step.id]).toBe('pending')
  })

  it('★ does not replay work that already finished', async () => {
    const first = aStep({ sequence: 1 })
    const second = aStep({
      sequence: 2,
      actionType: 'operations.log.compact',
      resource: 'events:log/segments',
      dependsOn: [first.id],
    })
    const steps = [first, second]
    const planId = persistPlan(storage, steps)

    // Finish the first step only.
    const partial: PlanProgress = {
      planStatus: 'running',
      stepStatuses: { [first.id]: 'completed', [second.id]: 'pending' },
      completed: [first.id],
      attempts: {},
    }

    storage.plans.saveProgress({ planId, principalId: OWNER, ...toStored(partial) })

    storage.close()
    storage = boot()

    const reloaded = storage.plans.loadProgress({ planId, principalId: OWNER })
    if (!reloaded.ok || reloaded.value === undefined) throw new Error('no progress')

    const w = executorSaying({})
    const outcome = await run(steps, w.executor, fromStored(reloaded.value))

    expect(outcome.kind).toBe('completed')

    // ★ Only the unfinished step ran. Completed work is not repeated, and it
    // is not re-authorised either — there was nothing left to ask about.
    expect(w.performed).toEqual(['operations.log.compact'])
  })

  it('★ never counts a step waiting on the owner as finished', async () => {
    // ★ The bypass this catches is quiet and complete: if a suspended step
    // were restored as "already done", the plan would skip it and report
    // success — work the owner was asked about and never approved, recorded as
    // having happened.
    const step = aStep({ actionType: 'operations.log.compact', resource: 'events:log/segments' })
    const planId = persistPlan(storage, [step])

    const suspending = executorAnswering({
      'operations.log.compact': { decision: 'needs_approval', riskClass: 'high' },
    })

    const suspended = await run([step], suspending.executor, beginning([step]))
    expect(suspended.kind).toBe('awaiting_approval')
    if (suspended.kind !== 'awaiting_approval') return

    storage.plans.saveProgress({ planId, principalId: OWNER, ...toStored(suspended.progress) })

    storage.close()
    storage = boot()

    const reloaded = storage.plans.loadProgress({ planId, principalId: OWNER })
    if (!reloaded.ok || reloaded.value === undefined) throw new Error('no progress')

    const recovered = fromStored(reloaded.value)

    // ★ Not finished. Still owed an answer, and still owed a Guardian question.
    expect(recovered.completed).not.toContain(step.id)
    expect(recovered.stepStatuses[step.id]).toBe('awaiting_approval')

    // And the plan does not quietly complete around it.
    const after = executorAnswering({})
    const resumed = await run([step], after.executor, recovered)

    expect(resumed.kind).not.toBe('completed')
    expect(after.performed).toEqual([])
  })

  it('attempt counts and statuses survive the round trip', () => {
    const step = aStep()

    const progress: PlanProgress = {
      planStatus: 'running',
      stepStatuses: { [step.id]: 'failed' },
      completed: [],
      attempts: { [step.id]: 2 },
    }

    const recovered = fromStored(toStored(progress))

    expect(recovered.attempts[step.id]).toBe(2)
    expect(recovered.stepStatuses[step.id]).toBe('failed')
  })

  it('derives what finished rather than storing it twice', () => {
    // Two records of the same fact are two records that can disagree, and the
    // one that disagrees silently decides whether finished work is repeated.
    const done = aStep({ sequence: 1 })
    const skipped = aStep({ sequence: 2 })

    const recovered = fromStored({
      planStatus: 'running',
      steps: [
        { id: done.id, status: 'completed', attempt: 1 },
        { id: skipped.id, status: 'skipped', attempt: 1 },
      ],
    })

    expect([...recovered.completed].sort()).toEqual([done.id, skipped.id].sort())
  })
})
