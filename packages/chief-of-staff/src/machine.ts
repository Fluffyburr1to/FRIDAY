import {
  err,
  type FridayError,
  fridayError,
  isTerminalPlanStatus,
  ok,
  type PlanStatus,
  type PlanStepStatus,
  type Result,
  type RiskClass,
  type StepFailureAction,
} from '@friday/contracts'

/**
 * The plan state machine.
 *
 * ★ Chapter 12's central claim made concrete: **planning is a bounded AI
 * operation; execution is deterministic code over a data structure.** Nothing
 * in this file consults a model, and nothing in it decides whether an action
 * is permitted.
 *
 * ★ **Plan-level approval is not blanket authorization.** This is the rule the
 * whole file is arranged around, and it is the one most likely to be eroded by
 * someone trying to reduce prompts. Approving a plan approves *the shape of
 * the work* — that these steps, in this order, may begin. It does **not**
 * pre-authorise the individual actions inside it. Every step still goes to the
 * Guardian on its own, at the moment it runs, and the constitutional guarantee
 * that an agent cannot act without the Guardian sits underneath the whole plan
 * engine rather than beside it.
 *
 * The distinction has teeth: a plan approved on Monday and resumed on Thursday
 * runs against Thursday's rules, Thursday's grants, and Thursday's expiries.
 * If it pre-authorised, an approval would be a standing grant nobody wrote
 * down and nobody could expire.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/19-approval-system.md
 */

/** Why a plan needs the owner's blessing before any step runs. */
export const PLAN_APPROVAL_REASONS = ['high_risk_step', 'over_cost_threshold'] as const

export type PlanApprovalReason = (typeof PLAN_APPROVAL_REASONS)[number]

export interface PlanApprovalCheck {
  /** The risk the Guardian assigned to each step, in plan order. */
  readonly riskClasses: readonly RiskClass[]

  /** What the plan is estimated to cost, in cents. */
  readonly estimateCents: number

  /**
   * Above this, the shape is approved before anything starts.
   *
   * ★ A **trigger**, not a ceiling, and the two live in different chapters:
   *
   *   - Chapter 35's `perPlanCents` ($0.50) is the ceiling. A plan that
   *     reaches it is suspended mid-flight. It is a safety limit, and it
   *     applies **whether or not the owner approved the plan** — approval is
   *     not a budget exemption.
   *   - This is Chapter 12's *"exceeds a cost threshold"*. A plan estimated
   *     above it is approved **before it starts**.
   *
   * It therefore has to sit below the ceiling to ever fire; `packages/config`
   * refuses a configuration where it does not. Owner decision of 2026-08-19:
   * 25 cents, half the ceiling.
   *
   * ★ FRIDAY's estimated cost of the actions in a plan — not an API spending
   * limit and not a per-model cap.
   */
  readonly thresholdCents: number
}

/** Risk classes that make a plan consequential enough to approve as a whole. */
const NEEDS_PLAN_APPROVAL: readonly RiskClass[] = ['high', 'critical', 'self_modification']

/**
 * Whether the owner must approve this plan's shape before it begins.
 *
 * ★ Chapter 12's reason, worth restating because it is not obvious: a sequence
 * of individually-low-risk steps can be collectively consequential. Reading
 * mail is low risk. Summarising it is low risk. Sending the summary somewhere
 * is where it matters — and by then five steps have already run. Reviewing the
 * shape up front is a different question from approving the last action.
 *
 * ★ The risk classes come from the **Guardian**, never from the planner. This
 * function is given them; it does not compute them.
 *
 * @param check - The Guardian's classifications and the plan's cost estimate.
 * @returns Why approval is needed, or `undefined` when it may simply run.
 */
export function planApprovalReason(check: PlanApprovalCheck): PlanApprovalReason | undefined {
  if (check.riskClasses.some((risk) => NEEDS_PLAN_APPROVAL.includes(risk))) {
    return 'high_risk_step'
  }

  if (check.estimateCents > check.thresholdCents) return 'over_cost_threshold'

  return undefined
}

/** What just happened to a plan or one of its steps. */
export type PlanEvent =
  | { readonly kind: 'validated'; readonly needsPlanApproval: boolean }
  | { readonly kind: 'plan_approved' }
  | { readonly kind: 'plan_declined' }
  | { readonly kind: 'step_started' }
  | { readonly kind: 'step_completed'; readonly remaining: number }
  | { readonly kind: 'step_needs_approval' }
  | { readonly kind: 'step_approved' }
  | { readonly kind: 'step_failed'; readonly onFailure: StepFailureAction }
  | { readonly kind: 'cancelled' }

/**
 * Where each status can go, given what happened.
 *
 * ★ A table rather than nested conditionals, so the whole machine can be read
 * at once. A transition that is not in the table is not real — the default is
 * refusal, which is what keeps an unexpected event from being interpreted
 * generously.
 */
const PLAN_TRANSITIONS: Readonly<Record<PlanStatus, (event: PlanEvent) => PlanStatus | undefined>> =
  {
    draft: (event) =>
      event.kind === 'validated'
        ? event.needsPlanApproval
          ? 'awaiting_plan_approval'
          : 'running'
        : undefined,

    // ★ Approving the SHAPE moves the plan to `running`. It does not authorise
    // a single action inside it — every step still asks.
    awaiting_plan_approval: (event) => {
      if (event.kind === 'plan_approved') return 'running'
      if (event.kind === 'plan_declined') return 'cancelled'

      return undefined
    },

    running: (event) => {
      if (event.kind === 'step_started') return 'running'
      if (event.kind === 'step_needs_approval') return 'awaiting_approval'
      if (event.kind === 'step_completed') return event.remaining === 0 ? 'completed' : 'running'
      if (event.kind === 'step_failed') return failureOutcome(event.onFailure)

      return undefined
    },

    awaiting_approval: (event) => {
      if (event.kind === 'step_approved') return 'running'
      if (event.kind === 'step_failed') return failureOutcome(event.onFailure)

      return undefined
    },

    // Terminal. Handled before the table is consulted, and present so that
    // adding a status without deciding its transitions fails to compile.
    completed: () => undefined,
    failed: () => undefined,
    cancelled: () => undefined,
  }

/**
 * The next plan status, given what just happened.
 *
 * ★ A total function over `(status, event)` with no hidden state, so a plan's
 * status is always a consequence of a recorded event. That is what makes the
 * dashboard's live view the same data as the audit trail rather than a
 * separate reporting system.
 *
 * @param status - Where the plan is now.
 * @param event - What happened.
 * @returns The next status, or a refusal when that transition is not real.
 */
export function nextStatus(status: PlanStatus, event: PlanEvent): Result<PlanStatus, FridayError> {
  if (isTerminalPlanStatus(status)) {
    // ★ A finished plan does not restart. Resuming a completed plan would let
    // work be replayed by re-delivering an old event.
    return refuse(`a plan that has ${status} cannot ${event.kind}`)
  }

  if (event.kind === 'cancelled') return ok('cancelled')

  const next = PLAN_TRANSITIONS[status](event)

  return next === undefined ? refuse(`a plan that is ${status} cannot ${event.kind}`) : ok(next)
}

/** Where a failed step leaves the plan, per its declared failure action. */
function failureOutcome(onFailure: StepFailureAction): PlanStatus {
  switch (onFailure) {
    // The plan carries on; the step is retried or passed over.
    case 'retry':
    case 'skip':
    case 'alternate':
      return 'running'

    // ★ The owner is asked what to do about the failure itself. That is a
    // fresh question, not the plan's original approval being reused.
    case 'ask_user':
      return 'awaiting_approval'

    case 'abort':
      return 'failed'
  }
}

/** The same table, for one step. */
const STEP_TRANSITIONS: Readonly<
  Record<PlanStepStatus, (event: PlanEvent) => PlanStepStatus | undefined>
> = {
  pending: (event) => {
    if (event.kind === 'step_started') return 'running'
    if (event.kind === 'cancelled') return 'skipped'

    return undefined
  },

  running: (event) => {
    if (event.kind === 'step_completed') return 'completed'
    if (event.kind === 'step_needs_approval') return 'awaiting_approval'
    if (event.kind === 'step_failed') return event.onFailure === 'skip' ? 'skipped' : 'failed'
    if (event.kind === 'cancelled') return 'failed'

    return undefined
  },

  // ★ Resuming a suspended step puts it back to `running`, which means it goes
  // through the Guardian again. The approval that unblocked it authorised THAT
  // action; it did not exempt the step from asking.
  awaiting_approval: (event) => {
    if (event.kind === 'step_approved') return 'running'
    if (event.kind === 'step_failed' || event.kind === 'cancelled') return 'failed'

    return undefined
  },

  completed: () => undefined,
  failed: () => undefined,
  skipped: () => undefined,
}

/**
 * The next status of one step.
 *
 * @param status - Where the step is now.
 * @param event - What happened.
 * @returns The next status, or a refusal when that transition is not real.
 */
export function nextStepStatus(
  status: PlanStepStatus,
  event: PlanEvent,
): Result<PlanStepStatus, FridayError> {
  const next = STEP_TRANSITIONS[status](event)

  return next === undefined ? refuse(`a step that is ${status} cannot ${event.kind}`) : ok(next)
}

function refuse(because: string): Result<never, FridayError> {
  return err(
    fridayError({
      code: 'VALIDATION_FAILED',
      message: `FRIDAY refused a plan transition that is not real: ${because}.`,
      detail: { because },
    }),
  )
}
