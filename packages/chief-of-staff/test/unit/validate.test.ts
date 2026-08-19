import {
  MAX_DEPTH,
  MAX_STEPS,
  type ProposedStep,
  readySteps,
  validatePlan,
} from '@friday/chief-of-staff'
import { uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Plan validation.
 *
 * ★ Every bound here is about the plan being *reviewable* or the executor
 * being *terminating*. Neither is about the plan being permitted — that is the
 * Guardian's question, asked per step, at the moment the step runs. A
 * validator that also authorised would be a second authority path.
 */

function aStep(overrides: Partial<ProposedStep> = {}): ProposedStep {
  return {
    id: uuidv7(),
    sequence: 1,
    dependsOn: [],
    description: 'Check that the record is intact.',
    actionType: 'diagnostics.self-check.run',
    department: 'operations',
    onFailure: 'abort',
    ...overrides,
  }
}

/** A chain of `length` steps, each depending on the one before. */
function aChain(length: number): ProposedStep[] {
  const steps: ProposedStep[] = []

  for (let i = 0; i < length; i++) {
    const previous = steps[i - 1]
    steps.push(
      aStep({
        sequence: i + 1,
        dependsOn: previous === undefined ? [] : [previous.id],
      }),
    )
  }

  return steps
}

describe('what makes a plan reviewable', () => {
  it('accepts an ordinary plan', () => {
    expect(validatePlan([aStep()]).ok).toBe(true)
  })

  it('refuses a plan with no steps', () => {
    expect(validatePlan([]).ok).toBe(false)
  })

  it(`★ refuses more than ${MAX_STEPS} steps`, () => {
    // ★ The bound keeps a plan reviewable, not small. A hundred-step plan is
    // one the owner approves without reading, which is approval theatre.
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => aStep({ sequence: i + 1 }))

    const result = validatePlan(many)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('sub-plans')
  })

  it(`accepts exactly ${MAX_STEPS} steps`, () => {
    const most = Array.from({ length: MAX_STEPS }, (_, i) => aStep({ sequence: i + 1 }))

    expect(validatePlan(most).ok).toBe(true)
  })

  it('refuses two steps at the same position', () => {
    expect(validatePlan([aStep({ sequence: 1 }), aStep({ sequence: 1 })]).ok).toBe(false)
  })

  it('refuses two steps sharing an id', () => {
    const id = uuidv7()

    expect(validatePlan([aStep({ id, sequence: 1 }), aStep({ id, sequence: 2 })]).ok).toBe(false)
  })
})

describe('what makes the executor terminate', () => {
  it('★ refuses a dependency cycle, and names it', () => {
    // ★ A rejected plan, never a hung executor. That is the whole reason this
    // check is here rather than in the state machine.
    const first = aStep({ sequence: 1 })
    const second = aStep({ sequence: 2, dependsOn: [first.id] })
    const cyclic = [{ ...first, dependsOn: [second.id] }, second]

    const result = validatePlan(cyclic)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('circle')
      expect(result.error.detail?.cycle).toBeDefined()
    }
  })

  it('refuses a step that depends on itself', () => {
    const step = aStep()

    expect(validatePlan([{ ...step, dependsOn: [step.id] }]).ok).toBe(false)
  })

  it('★ refuses a dependency on something outside this plan', () => {
    // ★ Cross-plan dependencies are not expressible on purpose. A dependency
    // pointing outside is either a hallucinated id or an attempt to build one.
    const result = validatePlan([aStep({ dependsOn: [uuidv7()] })])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('not in this plan')
  })

  it(`refuses a chain deeper than ${MAX_DEPTH}`, () => {
    const result = validatePlan(aChain(MAX_DEPTH + 1))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail?.depth).toBe(MAX_DEPTH + 1)
  })

  it(`accepts a chain exactly ${MAX_DEPTH} deep`, () => {
    expect(validatePlan(aChain(MAX_DEPTH)).ok).toBe(true)
  })

  it('measures depth as the longest chain, not the number of steps', () => {
    // Twenty independent steps are depth 1. Depth is about how much has to
    // happen in order, which is what the bound is actually about.
    const wide = Array.from({ length: MAX_STEPS }, (_, i) => aStep({ sequence: i + 1 }))

    expect(validatePlan(wide).ok).toBe(true)
  })
})

describe('what may run now', () => {
  it('★ returns independent steps together', () => {
    // ★ Chapter 12's own example is three independent lookups. Running them one
    // after another would be three times slower for no reason.
    const steps = [aStep({ sequence: 1 }), aStep({ sequence: 2 }), aStep({ sequence: 3 })]

    expect(readySteps(steps, new Set())).toHaveLength(3)
  })

  it('holds a step until everything it waits on has finished', () => {
    const first = aStep({ sequence: 1 })
    const second = aStep({ sequence: 2 })
    const last = aStep({ sequence: 3, dependsOn: [first.id, second.id] })
    const steps = [first, second, last]

    expect(readySteps(steps, new Set()).map((s) => s.id)).toEqual([first.id, second.id])
    expect(readySteps(steps, new Set([first.id])).map((s) => s.id)).toEqual([second.id])
    expect(readySteps(steps, new Set([first.id, second.id])).map((s) => s.id)).toEqual([last.id])
  })

  it('never returns a step that has already run', () => {
    const step = aStep()

    expect(readySteps([step], new Set([step.id]))).toEqual([])
  })

  it('returns them in presentation order, which is what the owner reads', () => {
    const steps = [aStep({ sequence: 3 }), aStep({ sequence: 1 }), aStep({ sequence: 2 })]

    expect(readySteps(steps, new Set()).map((s) => s.sequence)).toEqual([1, 2, 3])
  })
})
