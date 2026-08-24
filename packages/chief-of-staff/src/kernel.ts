import type { FridayError, PlanStatus, PlanStepStatus, RiskClass } from '@friday/contracts'
import { advance, type ExecutableStep, type Executor } from './executor.js'
import { type PlanApprovalReason, planApprovalReason } from './machine.js'

/**
 * The orchestration layer.
 *
 * ★ **The kernel is not an authority.** It decides *what to try next*; the
 * Guardian decides *whether it may happen*, per step, at the moment it runs.
 * Everything here is arranged so that the orchestrator cannot become a second
 * authority even by accident.
 *
 * ★ **No durable state can hold an `Authorised`.** `PlanProgress` — the value
 * that survives a suspension, a restart, and a resume — has no field of that
 * type and cannot be given one without changing this file. So a resumed plan
 * **cannot** reuse an old decision: there is nowhere to have kept it. That is
 * the structural version of *"resumption uses current rules, grants, and
 * expiries"*, and it holds without anyone remembering to invalidate anything.
 *
 * ★ **Every attempt calls `executor.authorise` afresh**, including retries.
 * A retry is a new attempt at the same work, and the rules may have changed
 * between them — treating the first answer as still good is the bypass most
 * likely to be written while making retries "efficient".
 *
 * Reference: docs/01-bible/12-chief-of-staff.md
 */

/**
 * What survives between runs.
 *
 * ★ Deliberately only ids and statuses. Nothing here is a permission, and
 * nothing here can be executed with.
 */
export interface PlanProgress {
  readonly planStatus: PlanStatus
  readonly stepStatuses: Readonly<Record<string, PlanStepStatus>>

  /** Ids that finished, for dependency resolution. */
  readonly completed: readonly string[]

  /** Attempts per step, so a retry policy has something to count. */
  readonly attempts: Readonly<Record<string, number>>
}

/** Where a run stopped, and why. */
export type RunOutcome =
  | { readonly kind: 'completed'; readonly progress: PlanProgress }
  | {
      readonly kind: 'awaiting_plan_approval'
      readonly because: PlanApprovalReason
      readonly progress: PlanProgress
    }
  | {
      readonly kind: 'awaiting_approval'
      readonly stepId: string
      readonly progress: PlanProgress
    }
  | {
      readonly kind: 'failed'
      readonly because: string
      readonly error?: FridayError | undefined
      readonly progress: PlanProgress
    }

export interface RunPlanOptions {
  readonly steps: readonly ExecutableStep[]
  readonly executor: Executor
  readonly progress: PlanProgress

  /** The Guardian's classification per step, for the plan-approval trigger. */
  readonly riskClasses: readonly RiskClass[]

  /** What the plan is estimated to cost, in cents. */
  readonly estimateCents: number

  /**
   * ★ Chapter 12's approval TRIGGER, not Chapter 35's budget CEILING.
   *
   * The two are different authorities and both apply. This value decides
   * whether the owner sees the plan before it starts. The `$0.50` per-plan
   * ceiling that stops a plan mid-flight is enforced by the model router and
   * the agent runtime, **not here** — see the note on `RunPlanOptions` in the
   * README. The kernel deliberately does not duplicate it: a second copy of a
   * budget is a second thing that can disagree.
   */
  readonly approvalThresholdCents: number

  /** How many times a `retry` step may be attempted before it is a failure. */
  readonly maxAttempts?: number
}

/** A fresh run of a plan nothing has started. */
export function beginning(steps: readonly ExecutableStep[]): PlanProgress {
  return {
    planStatus: 'draft',
    stepStatuses: Object.fromEntries(steps.map((step) => [step.id, 'pending' as PlanStepStatus])),
    completed: [],
    attempts: {},
  }
}

/**
 * Drives a plan to its next stopping point.
 *
 * Returns when the plan completes, needs the owner, or fails. Called again to
 * resume — and a resumed call re-authorises everything, because it has nothing
 * else it could do.
 *
 * @param options - The steps, the executor, and where the plan got to.
 * @returns Where it stopped and the progress to persist.
 */
export async function runPlan(options: RunPlanOptions): Promise<RunOutcome> {
  const opened = openPlan(options)
  if (opened.stopped !== undefined) return opened.stopped

  let progress = opened.progress

  for (;;) {
    const ready = options.executor
      .ready(options.steps, new Set(progress.completed))
      .filter((step) => canRun(progress, step))

    if (ready.length === 0) break

    const attempt = await attemptStep(ready[0] as ExecutableStep, progress, options)
    progress = attempt.progress

    if (attempt.stopped !== undefined) return attempt.stopped
  }

  return finish(progress, options.steps)
}

/**
 * The plan's own gate, before any step is considered.
 *
 * ★ Returns WITHOUT touching a single step when approval is needed. Plan
 * approval is about the shape of the work; every step is still pending and
 * still owes the Guardian a question.
 */
function openPlan(options: RunPlanOptions): {
  progress: PlanProgress
  stopped: RunOutcome | undefined
} {
  const progress = options.progress

  if (progress.planStatus === 'awaiting_plan_approval') {
    return {
      progress,
      stopped: failed(progress, 'this plan is waiting for you to approve its shape'),
    }
  }

  if (progress.planStatus !== 'draft') return { progress, stopped: undefined }

  const because = planApprovalReason({
    riskClasses: options.riskClasses,
    estimateCents: options.estimateCents,
    thresholdCents: options.approvalThresholdCents,
  })

  const moved = advance({
    planStatus: progress.planStatus,
    event: { kind: 'validated', needsPlanApproval: because !== undefined },
  })

  if (!moved.ok) {
    return { progress, stopped: failed(progress, 'this plan could not be started', moved.error) }
  }

  const opened = { ...progress, planStatus: moved.value.plan }

  return {
    progress: opened,
    stopped:
      because === undefined
        ? undefined
        : { kind: 'awaiting_plan_approval', because, progress: opened },
  }
}

/** One attempt at one step: authorise, then run, then record. */
async function attemptStep(
  step: ExecutableStep,
  before: PlanProgress,
  options: RunPlanOptions,
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  const maxAttempts = options.maxAttempts ?? 3

  // ★ The step is `running` from the moment it is ATTEMPTED, before the
  // Guardian is asked. Chapter 12's machine has no transition from `pending`
  // straight to `awaiting_approval` — a step waiting for the owner is one that
  // was already being tried.
  let progress = withStep(before, step.id, 'running', 'step_started')

  // ★ Asked EVERY time — first attempt, retry, and resume alike. Nothing above
  // this line is a permission and nothing below it proceeds without one.
  const outcome = options.executor.authorise(step)

  if (outcome.kind === 'needs_approval') {
    progress = withStep(progress, step.id, 'awaiting_approval', 'step_needs_approval')
    return { progress, stopped: { kind: 'awaiting_approval', stepId: step.id, progress } }
  }

  if (outcome.kind === 'refused' || outcome.kind === 'unavailable') {
    // ★ Both reach the same place: no capability runs. A refusal and an
    // unanswerable Guardian are different incidents and neither is permission.
    return afterFailure(progress, step, maxAttempts, {
      because:
        outcome.kind === 'refused'
          ? `FRIDAY was not allowed to ${step.description.toLowerCase()}`
          : 'FRIDAY could not get a permission decision, so she stopped',
      error: outcome.kind === 'unavailable' ? outcome.error : undefined,
    })
  }

  // ★ The only way past this point, and only with the value `authorise`
  // produced for THIS step, on THIS attempt.
  const performed = await options.executor.runStep(outcome.authorised, step)

  if (!performed.ok) {
    return afterFailure(progress, step, maxAttempts, {
      because: `a step failed: ${step.description}`,
      error: performed.error,
    })
  }

  const remaining = options.steps.length - (progress.completed.length + 1)

  return { progress: complete(progress, step, remaining), stopped: undefined }
}

/** Applies the step's declared failure action and decides whether to stop. */
function afterFailure(
  progress: PlanProgress,
  step: ExecutableStep,
  maxAttempts: number,
  why: { because: string; error: FridayError | undefined },
): { progress: PlanProgress; stopped: RunOutcome | undefined } {
  const next = onFailure(progress, step, maxAttempts)

  return {
    progress: next.progress,
    stopped: next.stop ? failed(next.progress, why.because, why.error) : undefined,
  }
}

/**
 * Whether the plan is done.
 *
 * ★ Decided by every step having reached a terminal state, not by a running
 * count. A skipped final step still completes the plan, and an earlier version
 * got that wrong by counting only completions.
 */
function finish(progress: PlanProgress, steps: readonly ExecutableStep[]): RunOutcome {
  const unfinished = steps.filter((step) => {
    const status = progress.stepStatuses[step.id]
    return status !== 'completed' && status !== 'skipped'
  })

  return unfinished.length > 0
    ? failed(progress, 'the plan stopped with work left that nothing could start')
    : { kind: 'completed', progress: { ...progress, planStatus: 'completed' } }
}

/** Whether a step is in a state this run may act on. */
function canRun(progress: PlanProgress, step: ExecutableStep): boolean {
  const status = progress.stepStatuses[step.id]

  // ★ `awaiting_approval` is NOT runnable. A suspended step becomes runnable
  // only when something records the owner's answer — see `approveStep`.
  return status === 'pending'
}

/** Records a step transition and the plan transition it caused. */
function withStep(
  progress: PlanProgress,
  stepId: string,
  status: PlanStepStatus,
  event: 'step_started' | 'step_needs_approval',
): PlanProgress {
  const moved = advance({
    planStatus: progress.planStatus,
    stepStatus: progress.stepStatuses[stepId] ?? 'pending',
    event: { kind: event },
  })

  return {
    ...progress,
    planStatus: moved.ok ? moved.value.plan : progress.planStatus,
    stepStatuses: { ...progress.stepStatuses, [stepId]: status },
  }
}

/** Marks a step done and moves the plan on. */
function complete(progress: PlanProgress, step: ExecutableStep, remaining: number): PlanProgress {
  const moved = advance({
    planStatus: progress.planStatus,
    stepStatus: 'running',
    event: { kind: 'step_completed', remaining },
  })

  return {
    ...progress,
    planStatus: moved.ok ? moved.value.plan : progress.planStatus,
    stepStatuses: { ...progress.stepStatuses, [step.id]: 'completed' },
    completed: [...progress.completed, step.id],
  }
}

/** Applies a step's declared failure action. */
function onFailure(
  progress: PlanProgress,
  step: ExecutableStep,
  maxAttempts: number,
): { progress: PlanProgress; stop: boolean } {
  const attempts = (progress.attempts[step.id] ?? 0) + 1
  const withAttempt = { ...progress, attempts: { ...progress.attempts, [step.id]: attempts } }

  // ★ A retry re-enters the loop as `pending`, which means it goes through
  // `authorise` again. There is no path that retries the EXECUTION without
  // repeating the DECISION.
  if (step.onFailure === 'retry' && attempts < maxAttempts) {
    return {
      progress: {
        ...withAttempt,
        stepStatuses: { ...withAttempt.stepStatuses, [step.id]: 'pending' },
      },
      stop: false,
    }
  }

  if (step.onFailure === 'skip') {
    return {
      progress: {
        ...withAttempt,
        stepStatuses: { ...withAttempt.stepStatuses, [step.id]: 'skipped' },
        completed: [...withAttempt.completed, step.id],
      },
      stop: false,
    }
  }

  return {
    progress: {
      ...withAttempt,
      planStatus: 'failed',
      stepStatuses: { ...withAttempt.stepStatuses, [step.id]: 'failed' },
    },
    stop: true,
  }
}

function failed(progress: PlanProgress, because: string, error?: FridayError): RunOutcome {
  return {
    kind: 'failed',
    because,
    error,
    progress: { ...progress, planStatus: 'failed' },
  }
}

/**
 * Records that the owner approved the plan's shape.
 *
 * ★ Moves the PLAN to `running` and **touches no step**. Every step is still
 * `pending`, and every one of them will call `authorise` when it is reached.
 * Approving a plan is not approving anything inside it.
 *
 * @param progress - Where the plan got to.
 * @returns The progress to persist, or a refusal if it was not waiting.
 */
export function approvePlan(progress: PlanProgress): PlanProgress | undefined {
  const moved = advance({ planStatus: progress.planStatus, event: { kind: 'plan_approved' } })
  if (!moved.ok) return undefined

  return { ...progress, planStatus: moved.value.plan }
}

/**
 * Records that the owner answered one suspended step.
 *
 * ★ Returns the step to `pending`, **not to authorised**. The next run calls
 * `authorise` for it like any other step, so the owner's answer is what
 * unblocks the question — it is not itself the permission. That is what stops
 * one answer from satisfying a different step, and what makes a plan approved
 * on Monday and resumed on Thursday run under Thursday's rules.
 *
 * @param progress - Where the plan got to.
 * @param stepId - The step the owner answered.
 * @returns The progress to persist, or a refusal if it was not waiting.
 */
export function approveStep(progress: PlanProgress, stepId: string): PlanProgress | undefined {
  if (progress.stepStatuses[stepId] !== 'awaiting_approval') return undefined

  const moved = advance({
    planStatus: progress.planStatus,
    stepStatus: 'awaiting_approval',
    event: { kind: 'step_approved' },
  })

  if (!moved.ok) return undefined

  return {
    ...progress,
    planStatus: moved.value.plan,
    // ★ `pending`, so the loop re-authorises it. Never `running`.
    stepStatuses: { ...progress.stepStatuses, [stepId]: 'pending' },
  }
}
