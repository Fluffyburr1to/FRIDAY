import {
  err,
  type FridayError,
  fridayError,
  ok,
  type PlanStep,
  type Result,
} from '@friday/contracts'

/**
 * Plan validation — the gate between a model's output and a durable plan.
 *
 * ★ The planner is the most powerful component in FRIDAY and the least
 * trustworthy thing that writes to the plan record. Everything here exists
 * because **a plan is inspected by the owner and then executed**, so an
 * invalid one is either something he cannot evaluate or something that hangs
 * the executor.
 *
 * Chapter 12 and [ADR-0011](../../../docs/adr/0011-plan-engine-state-machine.md)
 * set the bounds: twenty steps, depth three, a DAG rather than a list. They are
 * enforced here, once, before a plan exists — **not** discovered at execution
 * time, where a cycle is a hung plan and an over-large one is a wall of steps
 * nobody can review.
 *
 * ★ What this deliberately does **not** check: whether a step is *permitted*.
 * Risk is assigned by the Guardian and permission is decided by the Guardian,
 * per step, at the moment it runs. A validator that also authorised would be a
 * second authority path, and the plan engine must never become one.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md
 */

/** Chapter 12: "Maximum 20 steps and depth 3." */
export const MAX_STEPS = 20

/** How deep a dependency chain may run before it must become a sub-plan. */
export const MAX_DEPTH = 3

/** A step as the planner proposes it, before it becomes a row. */
export type ProposedStep = Pick<
  PlanStep,
  'id' | 'sequence' | 'dependsOn' | 'description' | 'actionType' | 'department' | 'onFailure'
>

/**
 * Checks a proposed plan against every bound Chapter 12 sets.
 *
 * @param steps - The steps the planner produced, in any order.
 * @returns Ok when the plan may exist, or the first reason it may not.
 */
export function validatePlan(steps: readonly ProposedStep[]): Result<void, FridayError> {
  if (steps.length === 0) {
    return refuse('a plan with no steps does nothing', { steps: 0 })
  }

  if (steps.length > MAX_STEPS) {
    // ★ The bound exists to keep a plan reviewable, not to save memory. A
    // hundred-step plan is one the owner approves without reading, which is
    // approval theatre — the failure Chapter 19 says is fatal.
    return refuse(
      `a plan may have at most ${MAX_STEPS} steps, and this one has ${steps.length}. ` +
        'Larger work is decomposed into sub-plans, each reviewable on its own.',
      { steps: steps.length },
    )
  }

  const byId = new Map(steps.map((step) => [step.id, step]))

  if (byId.size !== steps.length) {
    return refuse('two steps in the plan share an id', { steps: steps.length })
  }

  const sequences = new Set(steps.map((step) => step.sequence))
  if (sequences.size !== steps.length) {
    return refuse('two steps in the plan claim the same position', { steps: steps.length })
  }

  for (const step of steps) {
    const dangling = step.dependsOn.filter((id) => !byId.has(id))

    if (dangling.length > 0) {
      // ★ Cross-plan dependencies are not expressible on purpose. Sub-plans
      // are the mechanism, and a dependency pointing outside this plan is
      // either a hallucinated id or an attempt to build one.
      return refuse(
        `a step depends on something that is not in this plan (${dangling.join(', ')})`,
        { step: step.id, dangling },
      )
    }

    if (step.dependsOn.includes(step.id)) {
      return refuse('a step depends on itself', { step: step.id })
    }
  }

  const cyclic = findCycle(steps, byId)
  if (cyclic !== undefined) {
    // ★ A rejected plan, never a hung executor. This is the whole reason the
    // check is here rather than in the state machine.
    return refuse(`the steps depend on each other in a circle (${cyclic.join(' → ')})`, {
      cycle: cyclic,
    })
  }

  const deepest = depthOf(steps, byId)
  if (deepest > MAX_DEPTH) {
    return refuse(
      `this plan is ${deepest} steps deep and the limit is ${MAX_DEPTH}. ` +
        'Work that needs more is decomposed into sub-plans.',
      { depth: deepest },
    )
  }

  return ok(undefined)
}

/**
 * Finds one dependency cycle, if there is one.
 *
 * Returns the cycle itself rather than a boolean: *"these three steps depend
 * on each other in a circle"* is something the owner can act on, and "this
 * plan is invalid" is not.
 */
function findCycle(
  steps: readonly ProposedStep[],
  byId: ReadonlyMap<string, ProposedStep>,
): string[] | undefined {
  const visiting = new Set<string>()
  const done = new Set<string>()
  const trail: string[] = []

  function walk(id: string): string[] | undefined {
    if (done.has(id)) return undefined

    if (visiting.has(id)) {
      const from = trail.indexOf(id)
      return [...trail.slice(from), id]
    }

    visiting.add(id)
    trail.push(id)

    for (const next of byId.get(id)?.dependsOn ?? []) {
      const found = walk(next)
      if (found !== undefined) return found
    }

    visiting.delete(id)
    done.add(id)
    trail.pop()

    return undefined
  }

  for (const step of steps) {
    const found = walk(step.id)
    if (found !== undefined) return found
  }

  return undefined
}

/** The longest dependency chain in the plan, counted in steps. */
function depthOf(steps: readonly ProposedStep[], byId: ReadonlyMap<string, ProposedStep>): number {
  const known = new Map<string, number>()

  function depth(id: string): number {
    const cached = known.get(id)
    if (cached !== undefined) return cached

    const step = byId.get(id)
    const longest =
      step === undefined || step.dependsOn.length === 0
        ? 1
        : 1 + Math.max(...step.dependsOn.map(depth))

    known.set(id, longest)
    return longest
  }

  return Math.max(...steps.map((step) => depth(step.id)))
}

/** Every refusal reads the same way, and says what the owner would need. */
function refuse(because: string, detail: Record<string, unknown>): Result<never, FridayError> {
  return err(
    fridayError({
      code: 'VALIDATION_FAILED',
      message: `FRIDAY would not make this plan: ${because}.`,
      detail,
    }),
  )
}

/**
 * The steps that may start now — everything whose dependencies are finished.
 *
 * ★ Execution order comes from here, not from `sequence`. Independent steps
 * come back together because Chapter 12's own example is three independent
 * lookups, and running them one after another would be three times slower for
 * no reason.
 *
 * @param steps - Every step in the plan.
 * @param completed - The ids that have finished.
 * @returns The steps that are ready, in presentation order.
 */
export function readySteps(
  steps: readonly ProposedStep[],
  completed: ReadonlySet<string>,
): ProposedStep[] {
  return steps
    .filter((step) => !completed.has(step.id))
    .filter((step) => step.dependsOn.every((id) => completed.has(id)))
    .sort((left, right) => left.sequence - right.sequence)
}
