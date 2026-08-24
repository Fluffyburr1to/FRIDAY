import type {
  Actor,
  CorrelationId,
  FridayError,
  NewEvent,
  PlanApprovalReason,
  PlanStatus,
  PlanStepStatus,
  PrincipalId,
  Result,
  StepFailureAction,
} from '@friday/contracts'
import type { PlanEvent } from './machine.js'

/**
 * Transitions, and the events that are the transitions.
 *
 * ★ Chapter 12: *"Every transition publishes an event. The plan's current
 * state is a projection of those events."* This file is what makes that a
 * property rather than a habit.
 *
 * A `PlanTransition` is produced in exactly one place — where the state
 * machine **accepted** a move — and an event is produced in exactly one place:
 * from a `PlanTransition`. So an event cannot describe a move that did not
 * happen, because there is no way to write one that is not derived from an
 * accepted transition. A refused transition produces no `PlanTransition` and
 * therefore no event, which is the structural form of *"a failed transition
 * does not emit a false success event"*.
 *
 * ★ **Plan-level and step-level stay separate.** A step-level transition emits
 * a step event, and emits a plan event as well only when the plan itself
 * reached an end in the same move. There is no event meaning "the plan and its
 * steps were approved" because there is no such transition: approving a plan
 * approves its shape and leaves every step pending.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/10-event-bus.md
 */

/** Where one level moved. */
export interface Move<Status> {
  readonly from: Status
  readonly to: Status
}

/** The step half of a transition, when one was in play. */
export interface StepMove {
  readonly id: string
  readonly description: string
  readonly actionType: string

  /** Which attempt this is, from 1. */
  readonly attempt: number

  readonly move: Move<PlanStepStatus>
}

/** Facts the emitting event needs that the statuses do not carry. */
export interface TransitionDetail {
  readonly stepCount?: number | undefined
  readonly estimateCents?: number | undefined
  readonly needsPlanApproval?: boolean | undefined
  readonly approvalReason?: PlanApprovalReason | undefined
  readonly stepsCompleted?: number | undefined
  readonly stepsSkipped?: number | undefined
  readonly because?: string | undefined
  readonly onFailure?: StepFailureAction | undefined
  readonly willRetry?: boolean | undefined
}

/**
 * One accepted move.
 *
 * ★ Constructed only where `advance` returned ok. Nothing else in the package
 * builds one, and nothing outside it can, because the kernel never hands out
 * the pieces.
 */
export interface PlanTransition {
  readonly planId: string
  readonly event: PlanEvent
  readonly plan: Move<PlanStatus>
  readonly step?: StepMove | undefined
  readonly detail: TransitionDetail
}

/**
 * Where a transition goes to be recorded.
 *
 * ★ Required by `runPlan` rather than optional, and it is the whole reason
 * this is a port: a plan cannot be run without saying where its transitions
 * go. There is no exported no-op — a caller that wants to discard them has to
 * write the discard themselves, where a reviewer can see it.
 *
 * ★ It returns a `Result`, and a failure stops the plan. Chapter 10's rule is
 * that writing the event *is* how the thing happens; a transition that could
 * not be written down is therefore a transition that did not happen, and
 * carrying on would leave the log and the plan describing different runs.
 */
export type RecordTransition = (transition: PlanTransition) => Promise<Result<void, FridayError>>

/** Who the events are published as, and about whom. */
export interface EventContext {
  readonly actor: Actor
  readonly principalId: PrincipalId

  /** The root request. Groups the whole operation for the audit trail. */
  readonly correlationId?: CorrelationId | undefined

  /** The event that caused this run — usually the owner's request. */
  readonly causationId?: string | undefined
}

/**
 * The plan event for arriving at a status, when the plan actually moved.
 *
 * ★ Keyed on where the plan LANDED, not on what the caller thought it was
 * doing. A step that suspends the plan and a plan approval that resumes it are
 * the same two statuses either way round, and reading them off the machine's
 * answer is what stops an event announcing a move the machine did not make.
 */
function planEventType(transition: PlanTransition): string | undefined {
  if (transition.event.kind === 'validated') return 'plan.created'

  switch (transition.plan.to) {
    case 'awaiting_approval':
      return 'plan.suspended'
    case 'running':
      return 'plan.resumed'
    case 'completed':
      return 'plan.completed'
    case 'failed':
      return 'plan.failed'
    case 'cancelled':
      return 'plan.cancelled'
    default:
      return undefined
  }
}

/** The step event for one step's move. */
function stepEventType(transition: PlanTransition): string {
  switch (transition.event.kind) {
    case 'step_started':
      return 'plan.step.started'
    case 'step_needs_approval':
      return 'plan.step.suspended'
    case 'step_approved':
      return 'plan.step.resumed'
    case 'step_completed':
      return 'plan.step.completed'
    case 'step_retried':
      return 'plan.step.retried'
    default:
      // A step that ended was either passed over or it failed. Never both.
      return transition.step?.move.to === 'skipped' ? 'plan.step.skipped' : 'plan.step.failed'
  }
}

/**
 * The events for one transition.
 *
 * ★ **One rule, applied at each level independently: an event is published
 * where a status changed, and nowhere else.** A step starting does not move
 * the plan, so it publishes no plan event; a step suspending the plan does, so
 * it publishes both.
 *
 * That rule is what makes the log a projection rather than a narration. An
 * earlier draft had step events also carry the plan's move, *and* published a
 * plan event for the same move — so a reader chaining `from` to `to` counted
 * one move twice and drifted from the plan on the very first suspension. The
 * fix was not a smarter reader. It was that each level says its own moves once.
 *
 * ★ The order is fixed: the step's event, then the plan's. An explanation is
 * read top to bottom, and "the plan finished" before "the last step finished"
 * reads as though the plan finished early.
 *
 * @param transition - The accepted move.
 * @param context - Who is acting, and what this belongs to.
 * @returns The events for whichever levels moved. Never empty in practice: a
 *   transition that changed nothing at either level is not one the machine
 *   produces.
 */
export function eventsFor(transition: PlanTransition, context: EventContext): readonly NewEvent[] {
  const events: NewEvent[] = []

  if (transition.step !== undefined && transition.step.move.from !== transition.step.move.to) {
    events.push(stepEvent(transition, context, stepEventType(transition), transition.step))
  }

  const planType = planEventType(transition)

  if (planType !== undefined && transition.plan.from !== transition.plan.to) {
    events.push(planEvent(transition, context, planType, planPayload(transition, planType)))
  }

  return events
}

/** What a plan event carries beyond the move itself. */
function planPayload(transition: PlanTransition, type: string): Record<string, unknown> {
  const base = {
    planId: transition.planId,
    from: transition.plan.from,
    to: transition.plan.to,
  }

  switch (type) {
    case 'plan.created':
      return {
        ...base,
        stepCount: transition.detail.stepCount ?? 0,
        estimateCents: transition.detail.estimateCents ?? 0,
        needsPlanApproval: transition.detail.needsPlanApproval ?? false,
        approvalReason: transition.detail.approvalReason ?? null,
      }

    case 'plan.suspended':
      return { ...base, stepId: transition.step?.id ?? null }

    case 'plan.completed':
      return {
        ...base,
        stepsCompleted: transition.detail.stepsCompleted ?? 0,
        stepsSkipped: transition.detail.stepsSkipped ?? 0,
      }

    case 'plan.failed':
      return {
        ...base,
        because: transition.detail.because ?? 'a step of the plan did not work',
        stepId: transition.step?.id ?? null,
      }

    default:
      return { ...base, because: transition.detail.because ?? 'the plan was called off' }
  }
}

function planEvent(
  transition: PlanTransition,
  context: EventContext,
  type: string,
  payload: Record<string, unknown>,
): NewEvent {
  return {
    type,
    actor: context.actor,
    principalId: context.principalId,
    subject: { type: 'plan', id: transition.planId },
    correlationId: context.correlationId,
    causationId: context.causationId,

    // Counts and statuses. Useful to a debugger, of no consequence if seen.
    sensitivity: 'internal',
    payload,
  }
}

function stepEvent(
  transition: PlanTransition,
  context: EventContext,
  type: string,
  step: StepMove,
): NewEvent {
  // ★ The step's move, and only the step's move. The plan's move is on the
  // plan's own event — see `eventsFor`.
  const payload: Record<string, unknown> = {
    planId: transition.planId,
    stepId: step.id,
    attempt: step.attempt,
    stepFrom: step.move.from,
    stepTo: step.move.to,
    description: step.description,
    actionType: step.actionType,
  }

  if (type === 'plan.step.failed') {
    payload.because = transition.detail.because ?? 'the step did not work'
    payload.onFailure = transition.detail.onFailure ?? 'abort'
    payload.willRetry = transition.detail.willRetry ?? false
  }

  return {
    type,
    actor: context.actor,
    principalId: context.principalId,
    subject: { type: 'plan_step', id: step.id },
    correlationId: context.correlationId,
    causationId: context.causationId,

    // ★ `private`. A step names what FRIDAY was about to do, in the owner's
    // own terms — "reply to Sarah about the invoice" is a fact about their
    // life, not metadata about a state machine.
    sensitivity: 'private',
    payload,
  }
}
