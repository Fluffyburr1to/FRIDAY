import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Intent, type Plan, type PlanStep, uuidv7 } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

const OWNER = 'usr_owner'
const SOMEONE_ELSE = 'usr_someone_else'

/**
 * A second handle on the same file, for corrupting a row deliberately.
 *
 * The store has no way to write an invalid intent — which is the point — so a
 * test that the read path refuses one has to reach past it. Callers close it.
 */
function corrupt(directory: string, sql: string): void {
  const db = new Database(join(directory, 'friday.db'))

  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

function anIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    kind: 'communications.remind',
    confidence: 0.82,
    entities: { person: 'Sarah Chen', subject: 'the budget' },
    ambiguities: [],
    ...overrides,
  }
}

function aPlan(overrides: Partial<Plan> = {}): Plan {
  const now = Date.now()

  return {
    id: uuidv7(),
    principalId: OWNER,
    utterance: 'remind Sarah about the budget',
    intent: anIntent(),
    rationale: 'One reminder, to one person, about one thing.',
    explanation: null,
    status: 'draft',
    correlationId: uuidv7(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    budgetTokens: 50_000,
    budgetCents: 200,
    budgetDeadlineMs: null,
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
    dependsOn: [],
    description: 'Put the budget review on the calendar.',
    status: 'pending',
    actionType: 'calendar.event.create',
    actionPayload: { title: 'Budget review' },
    department: 'communications',
    riskClass: 'medium',
    onFailure: 'ask_user',
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

  // ── What ADR-0045 added ───────────────────────────────────────────────────

  it('keeps the owner’s words and the reading of them apart', () => {
    // ★ ADR-0045 §1, and it is a binding condition rather than a preference.
    // The explanation of what FRIDAY did has to be able to quote him, so the
    // utterance survives a round trip untouched by whatever the parser made of
    // it — including when the parser got it wrong.
    const plan = aPlan({
      utterance: 'sort out the thing with Sarah',
      intent: anIntent({ kind: 'communications.remind', confidence: 0.4 }),
    })

    storage.plans.createPlan(plan)
    const read = storage.plans.getPlan({ id: plan.id, principalId: OWNER })

    expect(read.ok && read.value?.utterance).toBe('sort out the thing with Sarah')
    expect(read.ok && read.value?.intent.kind).toBe('communications.remind')
  })

  it('round-trips the ambiguities a parser refused to guess at', () => {
    // Chapter 12's ambiguity ladder ends in "ask the owner". A parser that
    // resolved everything is indistinguishable from one that guessed unless
    // what it declined to resolve is stored as data.
    const intent = anIntent({
      ambiguities: [
        { field: 'person', question: 'Which Sarah?', candidates: ['Sarah Chen', 'Sarah Okafor'] },
      ],
    })

    const plan = aPlan({ intent })
    storage.plans.createPlan(plan)

    const read = storage.plans.getPlan({ id: plan.id, principalId: OWNER })

    expect(read.ok && read.value?.intent.ambiguities).toHaveLength(1)
    expect(read.ok && read.value?.intent.ambiguities[0]?.candidates).toEqual([
      'Sarah Chen',
      'Sarah Okafor',
    ])
  })

  it('refuses to read a plan whose stored intent is not a valid intent', () => {
    // ★ The stored intent is the one field on this row written by a model.
    // Chapter 30: never trust AI output. A corrupted one is a typed failure,
    // not a shape that flows onward unchecked — FRIDAY does not act on a guess
    // about what was asked.
    const plan = aPlan()
    storage.plans.createPlan(plan)

    corrupt(directory, `UPDATE plans SET intent = '{"kind":"x"}' WHERE id = '${plan.id}'`)

    const read = storage.plans.getPlan({ id: plan.id, principalId: OWNER })

    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.code).toBe('VALIDATION_FAILED')
  })

  it('fails a listing rather than silently shortening it', () => {
    // A dropped row would tell the owner "nothing else is running" when
    // something else is running and could not be read. Those must not look
    // the same.
    const good = aPlan()
    const bad = aPlan()
    storage.plans.createPlan(good)
    storage.plans.createPlan(bad)

    corrupt(directory, `UPDATE plans SET intent = 'not json' WHERE id = '${bad.id}'`)

    const listed = storage.plans.listPlans({ principalId: OWNER })

    expect(listed.ok).toBe(false)
  })

  it('round-trips a step’s dependency graph', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)

    const first = aStep(plan.id, { sequence: 1 })
    const second = aStep(plan.id, { sequence: 2, dependsOn: [first.id] })

    storage.plans.addStep(first)
    storage.plans.addStep(second)

    const steps = storage.plans.listSteps({ planId: plan.id, principalId: OWNER })

    expect(steps.ok && steps.value[0]?.dependsOn).toEqual([])
    expect(steps.ok && steps.value[1]?.dependsOn).toEqual([first.id])
  })

  it('stores the failure action decided at planning time', () => {
    const plan = aPlan()
    storage.plans.createPlan(plan)
    storage.plans.addStep(aStep(plan.id, { onFailure: 'abort' }))

    const steps = storage.plans.listSteps({ planId: plan.id, principalId: OWNER })

    expect(steps.ok && steps.value[0]?.onFailure).toBe('abort')
  })

  it('holds a plan awaiting approval of its shape, distinctly from one mid-flight', () => {
    // ★ "May I begin?" and "may I continue?" are different questions, and the
    // dashboard has to be able to tell the owner which one it is asking.
    storage.plans.createPlan(aPlan({ status: 'awaiting_plan_approval' }))
    storage.plans.createPlan(aPlan({ status: 'awaiting_approval' }))

    const beforeStarting = storage.plans.listPlans({
      principalId: OWNER,
      status: 'awaiting_plan_approval',
    })
    const midFlight = storage.plans.listPlans({ principalId: OWNER, status: 'awaiting_approval' })

    expect(beforeStarting.ok && beforeStarting.value).toHaveLength(1)
    expect(midFlight.ok && midFlight.value).toHaveLength(1)
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
