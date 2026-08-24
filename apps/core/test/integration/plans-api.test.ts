import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { appRouter, type OpenedContext, openContext } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createInMemoryKeyProvider, KEY_LENGTH_BYTES, type KeyProvider } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Plans on the dashboard, from real plans that really ran.
 *
 * ★ Nothing is stubbed and nothing is hand-written into a table. Every plan
 * below was produced by `friday ask` going through the real planner, the real
 * Guardian, and the real departments — because the thing being proved is that
 * **what the owner sees on the screen is what actually happened**, and a
 * fixture would prove only that the fixture came back.
 *
 * The second thing being proved is what this router *cannot* do. Chapter 26's
 * overview answers *what is happening* and *what needs you*; neither question
 * is answered by changing anything, and there is no procedure here that could.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md · docs/adr/0029
 */

const POLICIES = new URL('../../../../packages/guardian/policies', import.meta.url).pathname
const DEPARTMENTS = new URL('../../../../departments', import.meta.url).pathname

let directory: string
let config: FridayConfig
let keys: KeyProvider
const environment: Record<string, string | undefined> = {}

function remember(name: string, value: string) {
  environment[name] = process.env[name]
  process.env[name] = value
}

function inspect(): OpenedContext {
  const opened = openContext({ config, keys })
  if (!opened.ok) throw new Error(opened.error.message)

  return opened.value
}

/** Unwraps a `Result`, or fails with the reason it carried. */
function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)

  return result.value
}

/**
 * Runs a real plan and returns its id.
 *
 * `stopAtShape` leaves a plan waiting on the owner, which is the state
 * Chapter 26's "needs you" section exists to show.
 */
async function aPlan(
  opened: OpenedContext,
  utterance: string,
  options: { toCompletion?: boolean } = {},
): Promise<string> {
  const session = must(opened.ask)
  const proposed = must(await session.propose(utterance))

  must(await session.run(proposed))

  if (options.toCompletion === true) return proposed.plan.id

  return proposed.plan.id
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-plans-api-'))

  remember('FRIDAY_DATA_DIR', directory)
  remember('FRIDAY_POLICIES_DIR', POLICIES)
  remember('FRIDAY_DEPARTMENTS_DIR', DEPARTMENTS)

  const loaded = loadConfig({})
  if (!loaded.ok) throw new Error(loaded.error.message)

  config = loaded.value

  keys = createInMemoryKeyProvider({
    [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
    [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
  })
})

afterEach(() => {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  rmSync(directory, { recursive: true, force: true })
})

describe('what is happening, and what needs you', () => {
  it('★ returns plans that really ran, with the steps that really ran', async () => {
    const opened = inspect()

    try {
      const planId = await aPlan(opened, 'check my records', { toCompletion: true })
      const caller = appRouter.createCaller(opened.context)
      const page = await caller.plans.list({ showing: 'recent', limit: 10 })

      expect(page.plans).toHaveLength(1)

      const only = page.plans[0]

      expect(only?.plan.id).toBe(planId)
      expect(only?.plan.status).toBe('completed')
      expect(only?.steps).toHaveLength(1)
      expect(only?.steps[0]?.actionType).toBe('diagnostics.self-check.run')
    } finally {
      opened.close()
    }
  })

  it('★ separates what needs the owner from what finished on its own', async () => {
    // ★ The distinction Chapter 26's home screen is built around, and it is
    // read from the plan's status rather than assembled by the caller. A
    // finished plan must never appear under "needs you", because the whole
    // premise of Article III is that the owner can trust that list.
    const opened = inspect()

    try {
      await aPlan(opened, 'check my records')
      const waiting = await aPlan(opened, 'compact the event log')

      const caller = appRouter.createCaller(opened.context)

      const needsYou = await caller.plans.list({ showing: 'needs_you', limit: 10 })
      const live = await caller.plans.list({ showing: 'live', limit: 10 })

      expect(needsYou.plans.map((entry) => entry.plan.id)).toEqual([waiting])
      expect(live.plans.map((entry) => entry.plan.id)).toEqual([waiting])

      const all = await caller.plans.list({ showing: 'recent', limit: 10 })

      expect(all.plans).toHaveLength(2)
    } finally {
      opened.close()
    }
  })

  it('★ the completed plan is not offered as something needing an answer', async () => {
    // ★ The mutation this guards: `needs_you` returning everything still on
    // the screen. A list that includes finished work teaches the owner to skim
    // it, and skimming the approvals list is how approval theatre starts.
    const opened = inspect()

    try {
      await aPlan(opened, 'check my records', { toCompletion: true })

      const caller = appRouter.createCaller(opened.context)
      const needsYou = await caller.plans.list({ showing: 'needs_you', limit: 10 })

      expect(needsYou.plans).toEqual([])
    } finally {
      opened.close()
    }
  })

  it('filters by an exact status when asked for one', async () => {
    const opened = inspect()

    try {
      await aPlan(opened, 'check my records', { toCompletion: true })
      await aPlan(opened, 'compact the event log')

      const caller = appRouter.createCaller(opened.context)

      const done = await caller.plans.list({ showing: 'completed', limit: 10 })
      const waiting = await caller.plans.list({ showing: 'awaiting_plan_approval', limit: 10 })

      expect(done.plans).toHaveLength(1)
      expect(waiting.plans).toHaveLength(1)
    } finally {
      opened.close()
    }
  })

  it('says plainly when there is no such plan', async () => {
    const opened = inspect()

    try {
      const caller = appRouter.createCaller(opened.context)

      await expect(
        caller.plans.get({ planId: '01930000-0000-7000-8000-000000000001' }),
      ).rejects.toThrow(/no plan with that id/)
    } finally {
      opened.close()
    }
  })
})

describe('why she did it', () => {
  it('★ every line carries the event it came from', async () => {
    // ★ What separates an explanation from a story, and what makes Chapter
    // 26's Layer 4 reachable from Layer 3. A line without an event id is a
    // claim with nothing behind it.
    const opened = inspect()

    try {
      const planId = await aPlan(opened, 'check my records', { toCompletion: true })

      const caller = appRouter.createCaller(opened.context)
      const why = await caller.plans.why({ planId, depth: 'full' })

      expect(why.lines.length).toBeGreaterThan(0)
      expect(why.lines.every((line) => line.eventId.length > 0)).toBe(true)

      // ★ The owner's own words, not the model's restatement of them.
      expect(why.asked).toBe('check my records')
      expect(why.lines.map((line) => line.text)).toContain(
        'Done: Check that FRIDAY is internally consistent and her record is intact.',
      )
    } finally {
      opened.close()
    }
  })

  it('★ says what it left out rather than implying it is the whole story', async () => {
    const opened = inspect()

    try {
      const planId = await aPlan(opened, 'check my records', { toCompletion: true })

      const caller = appRouter.createCaller(opened.context)
      const summary = await caller.plans.why({ planId, depth: 'summary' })
      const full = await caller.plans.why({ planId, depth: 'full' })

      // A shallower depth says less AND says that it said less.
      expect(summary.lines.length).toBeLessThan(full.lines.length)
      expect(summary.omitted.belowDepth).toBeGreaterThan(0)
      expect(full.orphaned).toEqual([])
    } finally {
      opened.close()
    }
  })

  it('★ is recomposed from the events, not read from the stored column', async () => {
    // ★ Chapter 12 §2: if the stored text and the events ever disagree, the
    // events are right. The plan's `explanation` column is null here and the
    // account is complete anyway, which is only possible if nothing read it.
    const opened = inspect()

    try {
      const planId = await aPlan(opened, 'check my records', { toCompletion: true })

      const caller = appRouter.createCaller(opened.context)
      const stored = await caller.plans.get({ planId })
      const why = await caller.plans.why({ planId })

      expect(stored.plan.explanation).toBeNull()
      expect(why.headline.length).toBeGreaterThan(0)
      expect(why.lines.length).toBeGreaterThan(0)
    } finally {
      opened.close()
    }
  })
})

describe('★ what this router cannot do', () => {
  it('★ offers no way to advance, approve, or write a plan', () => {
    // ★ ADR-0029's rule as an assertion rather than a comment. A procedure
    // that could move a plan would be a procedure that decides when FRIDAY
    // acts — and it would do it without the state machine and without an
    // event, which is the one way the log and the plan can come to describe
    // different runs.
    //
    // Read off the router DEFINITION rather than a caller: a caller is a
    // Proxy and answers `Object.keys` with nothing, so the same assertion
    // written against one would pass no matter what this router grew.
    const defined = Object.keys(
      (appRouter._def as { procedures: Record<string, unknown> }).procedures,
    )

    expect(defined.filter((name) => name.startsWith('plans.')).sort()).toEqual([
      'plans.get',
      'plans.list',
      'plans.why',
    ])

    // Every one is a query. A mutation on this router is the thing being
    // guarded against, and it would be added without looking like a decision.
    const mutations = defined.filter((name) => {
      const procedure = (
        appRouter._def as { procedures: Record<string, { _def?: { type?: string } }> }
      ).procedures[name]

      return procedure?._def?.type === 'mutation'
    })

    expect(mutations).toEqual(['approvals.respond'])
  })

  it('★ the context holds no way to write a plan either', () => {
    // ★ The type says `PlanReader`; this asserts the running object agrees. A
    // `Pick<>` alone leaves `saveProgress` sitting on the object, one `as`
    // away — the same gap a test already found on `EventReader`.
    const opened = inspect()

    try {
      const plans = opened.context.plans as unknown as Record<string, unknown>

      expect(Object.keys(plans).sort()).toEqual(['getPlan', 'listPlans', 'listSteps'])
      expect(plans.saveProgress).toBeUndefined()
      expect(plans.createPlan).toBeUndefined()
      expect(plans.addStep).toBeUndefined()
    } finally {
      opened.close()
    }
  })
})
