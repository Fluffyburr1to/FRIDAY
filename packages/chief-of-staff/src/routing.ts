import {
  type DepartmentCapability,
  type DepartmentManifest,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'

/**
 * Deterministic routing — which department performs a step.
 *
 * ★ **No model is involved, and that is the whole point.**
 * [ADR-0040](../../../docs/adr/0040-a-capability-is-a-department-inside-the-guardian-boundary.md)
 * §3: the planner proposes actions, and *deterministic code* maps them onto
 * capabilities. A model that picked the tool directly would make the audit
 * answer to *"why did FRIDAY do that?"* into *"the model chose to"*, which
 * [Chapter 12](../../../docs/01-bible/12-chief-of-staff.md) rejects as an
 * explanation. The owner's requirement — *"I should not have to know the name
 * of the skill"* — is met here, by lookup, rather than by letting a model
 * reach for a tool.
 *
 * ★ **Routing is not authorization.** It answers *who does this*, never
 * *may this be done*. The Guardian answers the second, per step, at the moment
 * the step runs, and a plan the owner approved as a whole changes nothing
 * about that. Nothing in this file reads a capability's `riskClass` to decide
 * anything — that field is declaratory, and if it ever disagrees with the
 * Guardian the Guardian is right.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/13-department-architecture.md
 */

/** Where a step goes, once the lookup has resolved it. */
export interface Route {
  readonly department: string
  readonly capability: DepartmentCapability
}

export interface CapabilityRegistry {
  /** Every action that can be performed, for the planner's catalogue. */
  readonly actions: readonly string[]

  /**
   * Finds the one capability that performs an action.
   *
   * @param action - The action a plan step proposes.
   * @returns The route, or a refusal naming what was not found.
   */
  route(action: string): Result<Route, FridayError>
}

/**
 * Builds the registry from every loaded department.
 *
 * ★ Refuses a department set in which two capabilities claim the same action.
 * A router that had to choose between them would not be deterministic, and
 * "whichever loaded first" is a routing rule nobody wrote down. It fails at
 * load — when a developer is looking — rather than at execution, when the
 * owner is.
 *
 * @param departments - The manifests the kernel discovered.
 * @returns The registry, or the collision that makes one impossible.
 */
export function createCapabilityRegistry(
  departments: readonly DepartmentManifest[],
): Result<CapabilityRegistry, FridayError> {
  const byAction = new Map<string, Route>()

  for (const department of departments) {
    for (const capability of department.capabilities) {
      const existing = byAction.get(capability.action)

      if (existing !== undefined) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message:
              `Two departments both say they perform "${capability.action}": ` +
              `${existing.department} and ${department.id}. FRIDAY will not guess which.`,
            detail: {
              action: capability.action,
              departments: [existing.department, department.id],
            },
          }),
        )
      }

      byAction.set(capability.action, { department: department.id, capability })
    }
  }

  const actions = [...byAction.keys()].sort()

  return ok({
    actions,

    route(action) {
      const found = byAction.get(action)

      if (found === undefined) {
        // ★ No guessing, and no nearest match. An action nothing declares is a
        // plan referring to something that does not exist — usually a
        // hallucinated capability — and the correct answer is that FRIDAY
        // cannot do it, not that she will try something similar.
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message: `Nothing FRIDAY has can do "${action}".`,
            detail: { action, available: actions },
          }),
        )
      }

      return ok(found)
    },
  })
}

/** A step as routing sees it: what it does, and who the planner said does it. */
export interface RoutableStep {
  readonly id: string
  readonly actionType: string
  readonly department: string
}

/**
 * Resolves every step in a plan, and checks the planner agreed with the lookup.
 *
 * ★ The disagreement check is the interesting half. The planner writes a
 * `department` onto each step, and the registry says which department actually
 * performs that action. **The lookup wins**, and a mismatch refuses the plan
 * rather than being silently corrected — a planner naming the wrong department
 * is either confused or being steered, and quietly routing it to the right
 * place would hide both.
 *
 * @param registry - Every capability the running departments declare.
 * @param steps - The plan's steps.
 * @returns One route per step, in the same order, or the first refusal.
 */
export function routePlan(
  registry: CapabilityRegistry,
  steps: readonly RoutableStep[],
): Result<Route[], FridayError> {
  const routes: Route[] = []

  for (const step of steps) {
    const route = registry.route(step.actionType)
    if (!route.ok) return route

    if (route.value.department !== step.department) {
      return err(
        fridayError({
          code: 'VALIDATION_FAILED',
          message:
            `A step says ${step.department} would do "${step.actionType}", ` +
            `but that is ${route.value.department}'s to do.`,
          detail: {
            step: step.id,
            action: step.actionType,
            claimed: step.department,
            actual: route.value.department,
          },
        }),
      )
    }

    routes.push(route.value)
  }

  return ok(routes)
}
