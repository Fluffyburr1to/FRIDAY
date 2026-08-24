import type { PlanStatus, PlanStepStatus } from '@friday/contracts'
import type { PlanProgress } from './kernel.js'

/**
 * Turning a run into rows, and rows back into a run.
 *
 * ★ **The guarantee here is what is absent.** A `PlanProgress` carries a plan
 * status, each step's status, and attempt counts. It carries no permission,
 * no decision, and no token — so there is nothing for a restart to smuggle
 * across. A resumed plan does not *choose* to re-ask the Guardian; it has no
 * alternative, because nothing that could stand in for an answer was ever
 * written down.
 *
 * ★ That is why this file is a translation and not a cache. The moment it
 * gained a `lastDecision` field "to avoid re-authorising", the guarantee would
 * be gone — and it would look like an optimisation in the diff.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · ADR-0045
 */

/** The shape the store round-trips. Ids, statuses, counts. Nothing else. */
export interface StoredProgress {
  readonly planStatus: PlanStatus
  readonly steps: readonly { id: string; status: PlanStepStatus; attempt: number }[]
}

/**
 * What to write down.
 *
 * @param progress - Where the run got to.
 * @returns Rows the plan store can save.
 */
export function toStored(progress: PlanProgress): StoredProgress {
  return {
    planStatus: progress.planStatus,
    steps: Object.entries(progress.stepStatuses).map(([id, status]) => ({
      id,
      status,
      attempt: progress.attempts[id] ?? 0,
    })),
  }
}

/**
 * What was written down, as a run again.
 *
 * ★ `completed` is **derived** from the step statuses rather than stored
 * separately. Two records of the same fact are two records that can disagree,
 * and the one that disagrees silently decides whether finished work is
 * repeated.
 *
 * ★ A step that was `running` when the process died comes back as `pending`.
 * It was interrupted, not finished — and `pending` is the state that sends it
 * through the Guardian again. Restoring it as `running` would resume execution
 * of a step whose permission was never re-established.
 *
 * @param stored - What the plan store returned.
 * @returns The run to hand back to `runPlan`.
 */
export function fromStored(stored: StoredProgress): PlanProgress {
  const stepStatuses: Record<string, PlanStepStatus> = {}
  const attempts: Record<string, number> = {}
  const completed: string[] = []

  for (const step of stored.steps) {
    // ★ Interrupted work is not in-flight work.
    const status = step.status === 'running' ? 'pending' : step.status

    stepStatuses[step.id] = status
    if (step.attempt > 0) attempts[step.id] = step.attempt
    if (status === 'completed' || status === 'skipped') completed.push(step.id)
  }

  return {
    planStatus: stored.planStatus === 'running' ? 'running' : stored.planStatus,
    stepStatuses,
    attempts,
    completed,
  }
}
