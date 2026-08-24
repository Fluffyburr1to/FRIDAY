import type { FridayError, PlanStatus, PlanStepStatus, RiskClass } from '@friday/contracts'
import { advance, type ExecutableStep, type Executor } from './executor.js'
import { type PlanApprovalReason, type PlanEvent, planApprovalReason } from './machine.js'
import type { PlanTransition, RecordTransition, TransitionDetail } from './transitions.js'

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
 * ★ **No status changes except through `apply`.** Chapter 12 says the plan's
 * state is a projection of its events, and that is only true if there is no
 * other way to move. `apply` asks the machine, and records the move it
 * accepted; a status assigned anywhere else would be a state change the log
 * never heard about, and the projection would silently drift from the truth.
 * An earlier version of this file assigned statuses directly on the failure,
 * completion, and abort paths — which is to say, on every path where anything
 * interesting happened.
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

  /** Which plan this is. Stamped on every transition it makes. */
  readonly planId: string

  /**
   * Where transitions go.
   *
   * ★ Required. A plan cannot be run without saying where the record of it
   * goes, and a failure to record stops the plan — see `RecordTransition`.
   */
  readonly record: RecordTransition

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

/** Everything `apply` needs that is not the progress itself. */
interface ApplyInput {
  readonly planId: string
  readonly record: RecordTransition
  readonly event: PlanEvent
  readonly step?: ExecutableStep | undefined
  readonly detail?: TransitionDetail | undefined
}

/** A move that was accepted and recorded, or the reason it was neither. */
type Applied =
  | { readonly ok: true; readonly progress: PlanProgress }
  | { readonly ok: false; readonly because: string; readonly error?: FridayError | undefined }

/**
 * The only way a plan changes.
 *
 * ★ Asks the machine, records what it accepted, and only then returns the new
 * progress. Three properties fall out of that order and all three are the
 * point:
 *
 *   - A refused transition changes nothing and records nothing. There is no
 *     path where an event says a plan moved and the plan did not.
 *   - A transition that could not be **written down** changes nothing either.
 *     Chapter 10's rule is that writing the event is how the thing happens, so
 *     an unrecordable move is a move that did not happen, and the caller gets
 *     the progress it had before.
 *   - The event is derived from the machine's own output rather than from what
 *     the caller expected, so a success event cannot be emitted for a move the
 *     machine turned into a failure.
 */
async function apply(progress: PlanProgress, input: ApplyInput): Promise<Applied> {
  const step = input.step
  const stepStatus = step === undefined ? undefined : (progress.stepStatuses[step.id] ?? 'pending')

  const moved = advance({
    planStatus: progress.planStatus,
    stepStatus,
    event: input.event,
  })

  if (!moved.ok) {
    return { ok: false, because: 'FRIDAY could not move the plan on', error: moved.error }
  }

  const transition: PlanTransition = {
    planId: input.planId,
    event: input.event,
    plan: { from: progress.planStatus, to: moved.value.plan },
    step:
      step === undefined || stepStatus === undefined || moved.value.step === undefined
        ? undefined
        : {
            id: step.id,
            description: step.description,
            actionType: step.actionType,
            attempt: (progress.attempts[step.id] ?? 0) + 1,
            move: { from: stepStatus, to: moved.value.step },
          },
    detail: input.detail ?? {},
  }

  const recorded = await input.record(transition)

  if (!recorded.ok) {
    // ★ The plan is left exactly where it was. Carrying on would mean the log
    // and the plan describe different runs, and the log is the one the owner
    // is later shown.
    return {
      ok: false,
      because: 'FRIDAY could not write down what she was doing, so she stopped',
      error: recorded.error,
    }
  }

  return { ok: true, progress: applyStatuses(progress, moved.value.plan, step, moved.value.step) }
}

/** Writes the accepted statuses into the progress, and nothing else. */
function applyStatuses(
  progress: PlanProgress,
  planStatus: PlanStatus,
  step: ExecutableStep | undefined,
  stepStatus: PlanStepStatus | undefined,
): PlanProgress {
  if (step === undefined || stepStatus === undefined) {
    return { ...progress, planStatus }
  }

  const finished = stepStatus === 'completed' || stepStatus === 'skipped'

  return {
    ...progress,
    planStatus,
    stepStatuses: { ...progress.stepStatuses, [step.id]: stepStatus },

    // ★ Appended once. A step that reached an end twice would be counted twice
    // for dependency resolution, and `filter` is cheaper than the bug.
    completed: finished
      ? [...progress.completed.filter((id) => id !== step.id), step.id]
      : progress.completed,
  }
}

/**
 * Drives a plan to its next stopping point.
 *
 * Returns when the plan completes, needs the owner, or fails. Called again to
 * resume — and a resumed call re-authorises everything, because it has nothing
 * else it could do.
 *
 * @param options - The steps, the executor, where the plan got to, and where
 *   its transitions are recorded.
 * @returns Where it stopped and the progress to persist.
 */
export async function runPlan(options: RunPlanOptions): Promise<RunOutcome> {
  const opened = await openPlan(options)
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
async function openPlan(
  options: RunPlanOptions,
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  const progress = options.progress

  if (progress.planStatus === 'awaiting_plan_approval') {
    return {
      progress,
      stopped: stopped(progress, 'this plan is waiting for you to approve its shape'),
    }
  }

  if (progress.planStatus !== 'draft') return { progress, stopped: undefined }

  const because = planApprovalReason({
    riskClasses: options.riskClasses,
    estimateCents: options.estimateCents,
    thresholdCents: options.approvalThresholdCents,
  })

  const opened = await apply(progress, {
    planId: options.planId,
    record: options.record,
    event: { kind: 'validated', needsPlanApproval: because !== undefined },
    detail: {
      stepCount: options.steps.length,
      estimateCents: options.estimateCents,
      needsPlanApproval: because !== undefined,
      approvalReason: because,
    },
  })

  if (!opened.ok) return { progress, stopped: stopped(progress, opened.because, opened.error) }

  return {
    progress: opened.progress,
    stopped:
      because === undefined
        ? undefined
        : { kind: 'awaiting_plan_approval', because, progress: opened.progress },
  }
}

/** One attempt at one step: authorise, then run, then record. */
async function attemptStep(
  step: ExecutableStep,
  before: PlanProgress,
  options: RunPlanOptions,
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  // ★ The step is `running` from the moment it is ATTEMPTED, before the
  // Guardian is asked. Chapter 12's machine has no transition from `pending`
  // straight to `awaiting_approval` — a step waiting for the owner is one that
  // was already being tried.
  const started = await apply(before, {
    planId: options.planId,
    record: options.record,
    event: { kind: 'step_started' },
    step,
  })

  if (!started.ok)
    return { progress: before, stopped: stopped(before, started.because, started.error) }

  const progress = started.progress

  // ★ Asked EVERY time — first attempt, retry, and resume alike. Nothing above
  // this line is a permission and nothing below it proceeds without one.
  const outcome = options.executor.authorise(step)

  if (outcome.kind === 'needs_approval') {
    const suspended = await apply(progress, {
      planId: options.planId,
      record: options.record,
      event: { kind: 'step_needs_approval' },
      step,
    })

    if (!suspended.ok) {
      return { progress, stopped: stopped(progress, suspended.because, suspended.error) }
    }

    return {
      progress: suspended.progress,
      stopped: { kind: 'awaiting_approval', stepId: step.id, progress: suspended.progress },
    }
  }

  if (outcome.kind === 'refused' || outcome.kind === 'unavailable') {
    // ★ Both reach the same place: no capability runs. A refusal and an
    // unanswerable Guardian are different incidents and neither is permission.
    return afterFailure(progress, step, options, {
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
    return afterFailure(progress, step, options, {
      because: `a step failed: ${step.description}`,
      error: performed.error,
    })
  }

  return completeStep(progress, step, options)
}

/** Records that a step finished, and lets the machine decide if the plan did. */
async function completeStep(
  progress: PlanProgress,
  step: ExecutableStep,
  options: RunPlanOptions,
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  const done = await apply(progress, {
    planId: options.planId,
    record: options.record,
    event: { kind: 'step_completed', remaining: unfinished(progress, options.steps, step.id) },
    step,
    detail: counts(progress, options.steps, step.id, 'completed'),
  })

  return done.ok
    ? { progress: done.progress, stopped: undefined }
    : { progress, stopped: stopped(progress, done.because, done.error) }
}

/**
 * Applies the step's declared failure action and decides whether to stop.
 *
 * ★ Two transitions, not one, when a step is retried: it failed, and then it
 * was tried again. Collapsing them into a single "back to pending" would erase
 * the failure from the record, and a step that failed twice and then worked
 * would read as a step that simply worked.
 */
async function afterFailure(
  progress: PlanProgress,
  step: ExecutableStep,
  options: RunPlanOptions,
  why: { because: string; error: FridayError | undefined },
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  const maxAttempts = options.maxAttempts ?? 3
  const attempts = (progress.attempts[step.id] ?? 0) + 1
  const willRetry = step.onFailure === 'retry' && attempts < maxAttempts

  const failed = await apply(progress, {
    planId: options.planId,
    record: options.record,
    event: {
      kind: 'step_failed',
      onFailure: step.onFailure,
      remaining: unfinished(progress, options.steps, step.id),
      willRetry,
    },
    step,
    detail: {
      ...counts(progress, options.steps, step.id, 'skipped'),
      because: why.because,
      onFailure: step.onFailure,
      willRetry,
    },
  })

  if (!failed.ok) return { progress, stopped: stopped(progress, failed.because, failed.error) }

  // ★ Counted after the failure is recorded, so a run that could not write the
  // failure down has not also silently spent an attempt.
  const counted = {
    ...failed.progress,
    attempts: { ...failed.progress.attempts, [step.id]: attempts },
  }

  if (willRetry) return retry(counted, step, options)

  return {
    progress: counted,
    stopped: counted.planStatus === 'failed' ? stopped(counted, why.because, why.error) : undefined,
  }
}

/** Returns a failed step to `pending`, which is what sends it back to the Guardian. */
async function retry(
  progress: PlanProgress,
  step: ExecutableStep,
  options: RunPlanOptions,
): Promise<{ progress: PlanProgress; stopped: RunOutcome | undefined }> {
  const again = await apply(progress, {
    planId: options.planId,
    record: options.record,
    event: { kind: 'step_retried' },
    step,
  })

  return again.ok
    ? { progress: again.progress, stopped: undefined }
    : { progress, stopped: stopped(progress, again.because, again.error) }
}

/** How many steps would still be unfinished once `exceptId` reaches an end. */
function unfinished(
  progress: PlanProgress,
  steps: readonly ExecutableStep[],
  exceptId: string,
): number {
  return steps.filter((step) => step.id !== exceptId && !isFinished(progress, step.id)).length
}

/** The tallies a terminal plan event carries, counting the step now ending. */
function counts(
  progress: PlanProgress,
  steps: readonly ExecutableStep[],
  endingId: string,
  ending: 'completed' | 'skipped',
): TransitionDetail {
  const tally = (status: PlanStepStatus) =>
    steps.filter((step) => step.id !== endingId && progress.stepStatuses[step.id] === status).length

  return {
    stepsCompleted: tally('completed') + (ending === 'completed' ? 1 : 0),
    stepsSkipped: tally('skipped') + (ending === 'skipped' ? 1 : 0),
  }
}

function isFinished(progress: PlanProgress, stepId: string): boolean {
  const status = progress.stepStatuses[stepId]
  return status === 'completed' || status === 'skipped'
}

/**
 * Whether the plan is done.
 *
 * ★ Read off the plan's status, which the machine set. An earlier version
 * recomputed it here from the step statuses, which meant two places decided
 * whether a plan had finished — and the one that was wrong would have been the
 * one nobody was looking at.
 */
function finish(progress: PlanProgress, steps: readonly ExecutableStep[]): RunOutcome {
  if (progress.planStatus === 'completed') return { kind: 'completed', progress }

  const left = steps.filter((step) => !isFinished(progress, step.id)).length

  return stopped(
    progress,
    left > 0
      ? 'the plan stopped with work left that nothing could start'
      : 'the plan ran out of steps without finishing',
  )
}

/** Whether a step is in a state this run may act on. */
function canRun(progress: PlanProgress, step: ExecutableStep): boolean {
  const status = progress.stepStatuses[step.id]

  // ★ `awaiting_approval` is NOT runnable. A suspended step becomes runnable
  // only when something records the owner's answer — see `approveStep`.
  return status === 'pending'
}

/**
 * A run that stopped without finishing.
 *
 * ★ Reports the progress **as it is**, and does not stamp `failed` on it. The
 * plan's status is the machine's to set; a run that could not proceed is not
 * the same fact as a plan that failed, and overwriting the status here would
 * make a plan waiting on the owner indistinguishable from one that broke.
 */
function stopped(progress: PlanProgress, because: string, error?: FridayError): RunOutcome {
  return { kind: 'failed', because, error, progress }
}

/**
 * Records that the owner approved the plan's shape.
 *
 * ★ Moves the PLAN to `running` and **touches no step**. Every step is still
 * `pending`, and every one of them will call `authorise` when it is reached.
 * Approving a plan is not approving anything inside it.
 *
 * @param input - Where the plan got to, which plan it is, and where the
 *   transition is recorded.
 * @returns The progress to persist, or undefined if it was not waiting.
 */
export async function approvePlan(input: {
  progress: PlanProgress
  planId: string
  record: RecordTransition
}): Promise<PlanProgress | undefined> {
  const moved = await apply(input.progress, {
    planId: input.planId,
    record: input.record,
    event: { kind: 'plan_approved' },
  })

  return moved.ok ? moved.progress : undefined
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
 * @param input - Where the plan got to, the step the owner answered, and where
 *   the transition is recorded.
 * @returns The progress to persist, or undefined if it was not waiting.
 */
export async function approveStep(input: {
  progress: PlanProgress
  step: ExecutableStep
  planId: string
  record: RecordTransition
}): Promise<PlanProgress | undefined> {
  if (input.progress.stepStatuses[input.step.id] !== 'awaiting_approval') return undefined

  const moved = await apply(input.progress, {
    planId: input.planId,
    record: input.record,
    event: { kind: 'step_approved' },
    step: input.step,
  })

  // ★ The machine returns the step to `pending`, so the loop re-authorises it.
  // Nothing is adjusted here afterwards: a status the kernel wrote over the
  // machine's answer would be a status the recorded event disagrees with, and
  // the event is what the owner is later shown.
  return moved.ok ? moved.progress : undefined
}
