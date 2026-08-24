import { z } from 'zod'
import type { EventRegistry, EventTypeDefinition } from './event-registry.js'
import { PlanIdSchema, PlanStepIdSchema } from './ids.js'
import {
  PlanApprovalReasonSchema,
  PlanStatusSchema,
  PlanStepStatusSchema,
  StepFailureActionSchema,
} from './plan.js'

/**
 * The event types Milestone 5 adds: every transition a plan can make.
 *
 * ★ **These are transitions, not log lines**, and the difference is in the
 * payload. Every type here carries `from` and `to` — the statuses either side
 * of the move — because Chapter 12 says the plan's current status *is a
 * projection of these events*. A reader that replays them arrives at the same
 * status the kernel holds, and if it does not, one of the two is wrong and it
 * is now visible. An event that recorded only "step completed" would leave the
 * projection guessing where the step had been, which is how a live view and an
 * audit trail become two systems that disagree.
 *
 * ★ **Plan-level and step-level are separate types on purpose.** Conflating
 * them is the exact erosion the plan engine is arranged to prevent: approving
 * a plan approves its *shape*, and `plan.resumed` therefore says nothing about
 * any step. There is no type here that means "the plan and its steps were
 * approved", because there is no such event.
 *
 * Sensitivity follows the rule the Guardian's types set: a *status* is
 * metadata, but the *thing being done* frequently is not. Step events name
 * what FRIDAY was about to do, in the owner's terms, so they are `private`.
 * Plan-level events carry counts and statuses, so they are `internal`.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/10-event-bus.md
 */

/** On every plan-level event: where the plan was, and where it went. */
const PlanMove = {
  planId: PlanIdSchema,
  from: PlanStatusSchema,
  to: PlanStatusSchema,
}

/**
 * On every step-level event: the step's move, and only the step's move.
 *
 * ★ The plan's move deliberately is not here. A step suspending the plan
 * publishes a step event AND a plan event, and if both carried the plan's move
 * a reader chaining `from` to `to` would count it twice — which is a
 * projection that drifts from the plan on the first suspension.
 */
const StepMove = {
  planId: PlanIdSchema,
  stepId: PlanStepIdSchema,

  /** Which attempt this is, from 1. A retry is a second event, not a rerun. */
  attempt: z.int().positive(),

  stepFrom: PlanStepStatusSchema,
  stepTo: PlanStepStatusSchema,
}

export const PlanCreatedPayloadSchema = z.object({
  ...PlanMove,
  stepCount: z.int().nonnegative(),
  estimateCents: z.int().nonnegative(),

  /**
   * Whether the owner will be asked before anything runs. Recorded on the
   * creation event so that "why was I asked?" is answerable from the same
   * event that decided it, rather than inferred from what happened next.
   */
  needsPlanApproval: z.boolean(),

  /**
   * Why the owner is being asked, when they are.
   *
   * ★ On the creation event rather than on a suspension event of its own.
   * There is only one transition here — the plan was worked out and landed
   * either in `running` or in `awaiting_plan_approval` — and a second event
   * for the same move would give a reader two events both claiming to start
   * from `draft`, which is a projection that no longer joins up.
   */
  approvalReason: PlanApprovalReasonSchema.nullable(),
})

export const PlanSuspendedPayloadSchema = z.object({
  ...PlanMove,

  /** The step the owner is being asked about. */
  stepId: PlanStepIdSchema.nullable(),
})

export const PlanResumedPayloadSchema = z.object({ ...PlanMove })

export const PlanCompletedPayloadSchema = z.object({
  ...PlanMove,
  stepsCompleted: z.int().nonnegative(),
  stepsSkipped: z.int().nonnegative(),
})

export const PlanFailedPayloadSchema = z.object({
  ...PlanMove,

  /** Plain language, for the owner. Article II. */
  because: z.string().min(1).max(1024),

  /** The step that ended it, when one did. */
  stepId: PlanStepIdSchema.nullable(),
})

export const PlanCancelledPayloadSchema = z.object({
  ...PlanMove,
  because: z.string().min(1).max(1024),
})

/** What FRIDAY was about to do, in the owner's terms. */
const StepWork = {
  description: z.string().min(1).max(512),
  actionType: z.string().min(1).max(128),
}

export const PlanStepStartedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepCompletedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepSuspendedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepResumedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepRetriedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepSkippedPayloadSchema = z.object({ ...StepMove, ...StepWork })

export const PlanStepFailedPayloadSchema = z.object({
  ...StepMove,
  ...StepWork,
  because: z.string().min(1).max(1024),
  onFailure: StepFailureActionSchema,

  /**
   * Whether this failure will be tried again.
   *
   * ★ Recorded rather than derived by a reader counting `plan.step.failed`
   * events. A reader that counted would have to know the retry policy that was
   * in force at the time, and it does not — so it would guess, and the guess
   * would be wrong on the day the policy changed.
   */
  willRetry: z.boolean(),
})

/**
 * Every transition a plan can make, as an event type.
 *
 * ★ **There is no `plan.step.authorised`.** Whether an action was permitted is
 * the Guardian's account of itself, and it already publishes `guardian.decided`
 * for every decision. A second record of the same fact, written by the
 * component that *asked* rather than the one that *answered*, would be a
 * second answer to "was this allowed?" — and the two would eventually differ.
 * `plan.step.started` says FRIDAY tried; the Guardian's own event says what it
 * was told.
 */
export const PLAN_EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: 'plan.created',
    payloadVersion: 1,
    schema: PlanCreatedPayloadSchema,
    maxSensitivity: 'internal',
    description:
      'FRIDAY worked out how to do something — and, when its shape needed you, ' +
      'stopped to show you before starting.',
  },
  {
    type: 'plan.suspended',
    payloadVersion: 1,
    schema: PlanSuspendedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'The plan stopped partway, waiting on you.',
  },
  {
    type: 'plan.resumed',
    payloadVersion: 1,
    schema: PlanResumedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'The plan is going again, because you answered.',
  },
  {
    type: 'plan.completed',
    payloadVersion: 1,
    schema: PlanCompletedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'Every step of the plan reached an end.',
  },
  {
    type: 'plan.failed',
    payloadVersion: 1,
    schema: PlanFailedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'The plan stopped without finishing.',
  },
  {
    type: 'plan.cancelled',
    payloadVersion: 1,
    schema: PlanCancelledPayloadSchema,
    maxSensitivity: 'internal',
    description: 'The plan was called off before it finished.',
  },
  {
    type: 'plan.step.started',
    payloadVersion: 1,
    schema: PlanStepStartedPayloadSchema,
    maxSensitivity: 'private',
    description: 'FRIDAY began one step of a plan.',
  },
  {
    type: 'plan.step.completed',
    payloadVersion: 1,
    schema: PlanStepCompletedPayloadSchema,
    maxSensitivity: 'private',
    description: 'One step of a plan was done.',
  },
  {
    type: 'plan.step.suspended',
    payloadVersion: 1,
    schema: PlanStepSuspendedPayloadSchema,
    maxSensitivity: 'private',
    description: 'FRIDAY stopped partway through a plan to ask you about one step.',
  },
  {
    type: 'plan.step.resumed',
    payloadVersion: 1,
    schema: PlanStepResumedPayloadSchema,
    maxSensitivity: 'private',
    description: 'You answered, so the step may be tried again — and asked about again.',
  },
  {
    type: 'plan.step.failed',
    payloadVersion: 1,
    schema: PlanStepFailedPayloadSchema,
    maxSensitivity: 'private',
    description: 'One step of a plan did not work.',
  },
  {
    type: 'plan.step.retried',
    payloadVersion: 1,
    schema: PlanStepRetriedPayloadSchema,
    maxSensitivity: 'private',
    description: 'A step that did not work is being tried again — and asked about again.',
  },
  {
    type: 'plan.step.skipped',
    payloadVersion: 1,
    schema: PlanStepSkippedPayloadSchema,
    maxSensitivity: 'private',
    description: 'One step was passed over, and the plan carried on.',
  },
]

/**
 * Teaches a registry the plan engine's event types.
 *
 * ★ Registered here rather than in the kernel, for the reason the Guardian's
 * are: `publish` refuses a type the registry does not know, so a process that
 * never called this **cannot record a plan transition**, even holding the
 * exact type string. That is what keeps "the plan advanced" from being
 * something any holder of a bus can assert.
 *
 * @param registry - The registry to populate.
 * @returns The same registry, so composition can be chained.
 */
export function registerPlanEventTypes(registry: EventRegistry): EventRegistry {
  for (const definition of PLAN_EVENT_TYPES) {
    registry.register(definition)
  }
  return registry
}
