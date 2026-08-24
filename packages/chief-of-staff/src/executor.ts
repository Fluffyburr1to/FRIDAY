import type {
  Actor,
  FridayError,
  GuardianDecision,
  PlanStatus,
  PlanStepStatus,
  PrincipalId,
  Result,
} from '@friday/contracts'
import { err, fridayError, ok } from '@friday/contracts'
import { nextStatus, nextStepStatus, type PlanEvent } from './machine.js'
import type { CapabilityRegistry, Route } from './routing.js'
import { readySteps } from './validate.js'

/**
 * The executor.
 *
 * ★ **The Guardian gate is structural here, not procedural.** The state
 * machine established what the system *permits*; this establishes what it
 * *does*, and the difference is where a safety property is actually lost.
 *
 * The mechanism is one type, `Authorised`:
 *
 *   - `runCapability` accepts an `Authorised`, never a step.
 *   - The **only** way to obtain one is `authorise()`, which calls the
 *     Guardian.
 *   - It carries a private symbol, so it cannot be forged, spread, or
 *     constructed from an object literal.
 *
 * So "step is ready to execute" cannot reach "capability executes" without
 * passing through a current Guardian decision — not because every path
 * remembers to ask, but because **no other path can produce the value the
 * execution function requires.** A future contributor adding a retry path, an
 * error path, or an internal shortcut cannot bypass it without deliberately
 * calling `authorise` themselves, which is the thing they were trying to skip.
 *
 * ★ None of the following is a shortcut around it:
 *
 *   - **Plan approval.** Approving a plan moves it to `running`. It authorises
 *     no step. Every step still calls `authorise`.
 *   - **Resume.** A resumed plan re-authorises from scratch, so it runs under
 *     the rules, grants, and expiries that exist *now* — not the ones that
 *     existed when it was approved.
 *   - **Routing.** A `Route` says who would perform an action. It is not, and
 *     cannot be converted into, an `Authorised`.
 *   - **A previous step's answer.** Each `Authorised` is minted for one step.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/19-approval-system.md
 */

/** ★ Unforgeable. Nothing outside this module can produce this symbol. */
const GUARDED = Symbol('friday.executor.guarded')

/**
 * Proof that the Guardian allowed this exact step, just now.
 *
 * ★ There is deliberately no constructor, no factory but `authorise`, and no
 * way to widen one. It is the capability-token pattern applied to the
 * executor's own internals.
 */
export interface Authorised {
  readonly [GUARDED]: true
  readonly stepId: string
  readonly route: Route
  readonly decision: GuardianDecision
}

/** What the executor is told about a step it might run. */
export interface ExecutableStep {
  readonly id: string
  readonly sequence: number
  readonly dependsOn: readonly string[]
  readonly description: string
  readonly actionType: string
  readonly department: string
  readonly resource: string
  readonly onFailure: 'retry' | 'skip' | 'abort' | 'ask_user' | 'alternate'
}

/**
 * Asking the Guardian.
 *
 * ★ Asynchronous, and that is not incidental. The real Guardian does not just
 * answer — it **records** the answer and, when the answer is "ask the owner",
 * raises the approval. Both are writes. A synchronous port would have forced
 * the composition either to skip the recording or to build a second, quieter
 * path to a decision, and a decision nobody wrote down is the one thing
 * authorization cannot have.
 */
export type Authorize = (input: {
  actor: Actor
  principalId: PrincipalId
  action: string
  resource: string

  /**
   * Which step is asking.
   *
   * ★ Carried because an agent must present a capability to act at all, and a
   * capability is *evidence of which step* rather than permission to act — the
   * thing that ties an action to work the owner asked for. Without the step id
   * the composition could only mint a capability that named no step, which is
   * precisely the untraceable state the requirement exists to prevent.
   */
  stepId: string
}) => Promise<Result<GuardianDecision, FridayError>>

/** Performs the work, once something has proved it may be performed. */
export type PerformCapability = (
  authorised: Authorised,
  step: ExecutableStep,
) => Promise<Result<unknown, FridayError>>

export interface ExecutorOptions {
  readonly registry: CapabilityRegistry
  readonly authorize: Authorize
  readonly perform: PerformCapability
  readonly actor: Actor
  readonly principalId: PrincipalId
}

export type AuthorisationOutcome =
  | { readonly kind: 'authorised'; readonly authorised: Authorised }
  | { readonly kind: 'needs_approval'; readonly decision: GuardianDecision }
  | { readonly kind: 'refused'; readonly decision: GuardianDecision }
  | { readonly kind: 'unavailable'; readonly error: FridayError }

export interface Executor {
  /**
   * Asks the Guardian about one step, right now.
   *
   * ★ The only source of an `Authorised` in the system.
   */
  authorise(step: ExecutableStep): Promise<AuthorisationOutcome>

  /**
   * Runs one step that has been authorised.
   *
   * ★ Takes an `Authorised`, not a step id and not a step. There is no
   * overload, no options bag, and no escape hatch that accepts anything else.
   */
  runStep(authorised: Authorised, step: ExecutableStep): Promise<Result<unknown, FridayError>>

  /** Which steps could start now, given what has finished. */
  ready(steps: readonly ExecutableStep[], completed: ReadonlySet<string>): ExecutableStep[]
}

/**
 * Builds the executor.
 *
 * @param options - The registry, the Guardian, and how to perform work.
 * @returns An executor whose only route to execution passes the Guardian.
 */
export function createExecutor(options: ExecutorOptions): Executor {
  const { registry, authorize, perform, actor, principalId } = options

  return {
    async authorise(step) {
      // Routing first: it says WHO would do this. It grants nothing, and the
      // value it returns cannot be executed with.
      const route = registry.route(step.actionType)

      if (!route.ok) return { kind: 'unavailable', error: route.error }

      if (route.value.department !== step.department) {
        return {
          kind: 'unavailable',
          error: fridayError({
            code: 'VALIDATION_FAILED',
            message:
              `A step says ${step.department} would do "${step.actionType}", ` +
              `but that is ${route.value.department}'s to do.`,
            detail: { step: step.id },
          }),
        }
      }

      // ★ Asked EVERY time this is called. Nothing is cached, nothing is
      // carried across steps, and nothing consults a previous answer. A
      // resumed plan therefore runs against current rules, grants, and
      // expiries by construction rather than by remembering to refresh.
      const decided = await authorize({
        actor,
        principalId,
        action: step.actionType,
        resource: step.resource,
        stepId: step.id,
      })

      if (!decided.ok) {
        // ★ A Guardian that cannot answer is not a Guardian that said yes.
        return { kind: 'unavailable', error: decided.error }
      }

      const decision = decided.value

      if (decision.decision === 'needs_approval') return { kind: 'needs_approval', decision }
      if (decision.decision !== 'allow') return { kind: 'refused', decision }

      return {
        kind: 'authorised',
        authorised: { [GUARDED]: true, stepId: step.id, route: route.value, decision },
      }
    },

    runStep(authorised, step) {
      // ★ Belt as well as braces. The type already makes a forged `Authorised`
      // impossible; this catches the one thing the type cannot — an
      // `Authorised` minted for a DIFFERENT step being reused for this one.
      // That is "answering one step's question satisfies another", and it is
      // the bypass most likely to be written by accident.
      if (authorised.stepId !== step.id) {
        return Promise.resolve(
          err(
            fridayError({
              code: 'NOT_AUTHORIZED',
              message:
                'FRIDAY refused to run a step using permission that was granted for a different ' +
                'step. Each step is asked about on its own.',
              detail: { authorisedFor: authorised.stepId, attempted: step.id },
            }),
          ),
        )
      }

      return perform(authorised, step)
    },

    ready(steps, completed) {
      return readySteps(steps, completed)
    },
  }
}

/**
 * Events that concern the plan as a whole and no particular step.
 *
 * ★ Kept explicit because conflating the two levels is how plan approval
 * quietly becomes step approval. `plan_approved` moves the PLAN to `running`
 * and leaves every step exactly where it was — pending, and still owing the
 * Guardian a question.
 */
const PLAN_LEVEL: readonly PlanEvent['kind'][] = ['validated', 'plan_approved', 'plan_declined']

/**
 * Advances a plan, and its step when the event concerns one.
 *
 * ★ A plan-level event does **not** advance a step. That is not a convenience:
 * if `plan_approved` moved a step out of `pending`, approving a plan would
 * have changed the state of work the owner has not been asked about — which is
 * the erosion this whole package is arranged to prevent.
 *
 * @param input - Where the plan and step are, and what happened.
 * @returns The next statuses, or a refusal when the transition is not real.
 */
export function advance(input: {
  planStatus: PlanStatus
  stepStatus?: PlanStepStatus | undefined
  event: PlanEvent
}): Result<{ plan: PlanStatus; step: PlanStepStatus | undefined }, FridayError> {
  const plan = nextStatus(input.planStatus, input.event)
  if (!plan.ok) return plan

  // ★ The step is untouched by a plan-level event, and untouched when there is
  // no step in play at all.
  if (PLAN_LEVEL.includes(input.event.kind) || input.stepStatus === undefined) {
    return ok({ plan: plan.value, step: input.stepStatus })
  }

  const step = nextStepStatus(input.stepStatus, input.event)
  if (!step.ok) return step

  return ok({ plan: plan.value, step: step.value })
}
