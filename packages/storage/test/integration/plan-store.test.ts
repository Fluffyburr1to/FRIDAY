import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Plan, type PlanStep, uuidv7 } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

const OWNER = 'usr_owner'
const SOMEONE_ELSE = 'usr_someone_else'

function aPlan(overrides: Partial<Plan> = {}): Plan {
  const now = Date.now()

  return {
    id: uuidv7(),
    principalId: OWNER,
    intent: 'remind Sarah about the budget',
    status: 'draft',
    correlationId: uuidv7(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    budgetTokens: 50_000,
    budgetCents: 200,
    spentTokens: 0,
    spentCents: 0,
    ...overrides,
  }
}

function aStep(planId: string, overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: uuidv7(),
    planId,
    principalId: OWNER,
    sequence: 1,
    status: 'pending',
    actionType: 'calendar.event.create',
    actionPayload: { title: 'Budget review' },
    riskClass: 'medium',
    approvalId: null,
    agentId: null,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    idempotencyKey: uuidv7(),
    ...overrides,
  }
}

describe('the plan store', () => {
  let directory: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-plans-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('round-trips a plan', () => {
    const plan = aPlan()
    expect(storage.plans.createPlan(plan).ok).toBe(true)

    const read = storage.plans.getPlan({ id: plan.id, principalId: OWNER })

    expect(read.ok && read.value).toEqual(plan)
  })

  it('round-trips a step, with its JSON columns decoded', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)

    const step = aStep(plan.id, { result: { messageId: 'abc' } })
    expect(storage.plans.addStep(step).ok).toBe(true)

    const read = storage.plans.listSteps({ planId: plan.id, principalId: OWNER })

    expect(read.ok && read.value[0]).toEqual(step)
  })

  it('does not return another principal’s plan', () => {
    // ★ The isolation that has to be exercised now, so it is not retrofitted
    // by auditing every query in the system years from now.
    const plan = aPlan({ principalId: OWNER })
    storage.plans.createPlan(plan)

    const read = storage.plans.getPlan({ id: plan.id, principalId: SOMEONE_ELSE })

    expect(read.ok && read.value).toBeUndefined()
  })

  it('does not list another principal’s plans', () => {
    storage.plans.createPlan(aPlan({ principalId: OWNER }))
    storage.plans.createPlan(aPlan({ principalId: SOMEONE_ELSE }))

    const mine = storage.plans.listPlans({ principalId: OWNER })

    expect(mine.ok && mine.value).toHaveLength(1)
    expect(mine.ok && mine.value[0]?.principalId).toBe(OWNER)
  })

  it('does not list another principal’s steps', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)
    storage.plans.addStep(aStep(plan.id))

    const theirs = storage.plans.listSteps({ planId: plan.id, principalId: SOMEONE_ELSE })

    expect(theirs.ok && theirs.value).toEqual([])
  })

  it('filters by status inside the query', () => {
    storage.plans.createPlan(aPlan({ status: 'awaiting_approval' }))
    storage.plans.createPlan(aPlan({ status: 'completed' }))

    const waiting = storage.plans.listPlans({ principalId: OWNER, status: 'awaiting_approval' })

    expect(waiting.ok && waiting.value).toHaveLength(1)
  })

  it('orders steps by their position in the plan', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)

    storage.plans.addStep(aStep(plan.id, { sequence: 2 }))
    storage.plans.addStep(aStep(plan.id, { sequence: 1 }))

    const steps = storage.plans.listSteps({ planId: plan.id, principalId: OWNER })

    expect(steps.ok && steps.value.map((step) => step.sequence)).toEqual([1, 2])
  })

  it('refuses a duplicate idempotency key', () => {
    // ★ The constraint that stops a resumed plan sending the same email twice.
    // Enforced by a unique index, not by whoever writes the plan engine.
    const plan = aPlan()
    storage.plans.createPlan(plan)

    const key = uuidv7()
    storage.plans.addStep(aStep(plan.id, { sequence: 1, idempotencyKey: key }))

    const duplicate = storage.plans.addStep(aStep(plan.id, { sequence: 2, idempotencyKey: key }))

    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.code).toBe('STORAGE_WRITE_FAILED')
  })

  it('refuses a step whose plan does not exist', () => {
    // Foreign keys are off by default in SQLite, which surprises everyone.
    // This asserts the pragma that turns them on is actually applied.
    const orphan = storage.plans.addStep(aStep(uuidv7()))

    expect(orphan.ok).toBe(false)
  })

  it('refuses two steps at the same position in one plan', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)
    storage.plans.addStep(aStep(plan.id, { sequence: 1 }))

    expect(storage.plans.addStep(aStep(plan.id, { sequence: 1 })).ok).toBe(false)
  })
})

describe('subscriber checkpoints', () => {
  let directory: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-checkpoints-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('reports zero for a subscriber that has never run', () => {
    // Zero means "start from the beginning", which is correct for a newly
    // added subscriber that needs to see the history.
    expect(storage.checkpoints.lastAcked('memory-ingest')).toBe(0)
  })

  it('records and advances progress', () => {
    storage.checkpoints.acknowledge({ subscriberId: 'memory-ingest', seq: 7 })
    expect(storage.checkpoints.lastAcked('memory-ingest')).toBe(7)

    storage.checkpoints.acknowledge({ subscriberId: 'memory-ingest', seq: 12 })
    expect(storage.checkpoints.lastAcked('memory-ingest')).toBe(12)
  })

  it('keeps subscribers independent', () => {
    storage.checkpoints.acknowledge({ subscriberId: 'a', seq: 5 })
    storage.checkpoints.acknowledge({ subscriberId: 'b', seq: 2 })

    expect(storage.checkpoints.lastAcked('a')).toBe(5)
    expect(storage.checkpoints.lastAcked('b')).toBe(2)
    expect(storage.checkpoints.list()).toHaveLength(2)
  })

  it('records a dead letter and can list it back', () => {
    storage.checkpoints.deadLetter({
      subscriberId: 'memory-ingest',
      eventSeq: 41,
      attempts: 8,
      error: 'handler kept failing',
    })

    expect(storage.checkpoints.countDeadLetters()).toBe(1)
    expect(storage.checkpoints.listDeadLetters()[0]?.eventSeq).toBe(41)
    expect(storage.checkpoints.listDeadLetters({ subscriberId: 'other' })).toEqual([])
  })
})
