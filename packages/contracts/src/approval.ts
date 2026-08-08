import { z } from 'zod'
import { ActorSchema } from './actor.js'
import { ActionSchema, ResourceSchema } from './authorization.js'
import {
  CorrelationIdSchema,
  PlanIdSchema,
  PlanStepIdSchema,
  PrincipalIdSchema,
  UuidSchema,
} from './ids.js'
import { RiskClassSchema } from './plan.js'

/**
 * Asking the owner.
 *
 * Chapter 19 states the requirement that shapes this whole file: *"A request
 * missing any required field is rejected — you cannot be asked to approve
 * something FRIDAY cannot explain."* Every `min(1)` below is that rule in
 * force. An agent that cannot say what it is about to do, why, what could go
 * wrong, and what else it considered **cannot raise a request at all**, and it
 * fails at validation rather than producing a request the owner would have to
 * evaluate on vibes.
 *
 * The failure mode this is defending against is not bypass. It is volume and
 * emptiness: forty thin requests a day trains the owner to tap approve without
 * reading, and at that point the audit trail records perfect oversight that is
 * not happening.
 *
 * Reference: docs/01-bible/19-approval-system.md
 */

const TimestampSchema = z.int().nonnegative()

export const ExplanationSchema = z.object({
  /** The concrete action, from a connector's dry run — not a paraphrase. */
  what: z.string().min(1).max(2048),

  /** Traced from the plan and the originating intent, not reconstructed. */
  why: z.string().min(1).max(2048),

  /**
   * How sure FRIDAY is that this is the right action, 0 to 1.
   *
   * Recorded, shown, and **never** used to decide anything. Chapter 19 rejects
   * confidence-based auto-approval outright: an injected or confused model is
   * frequently highly confident, so tying authority to self-reported certainty
   * would bypass the human in exactly the cases that most need one.
   */
  confidence: z.number().min(0).max(1),

  /**
   * What could go wrong, including irreversibility. At least one entry.
   *
   * An empty list is not "no risks" — it is an agent that did not look, and
   * Chapter 19 requires the field precisely so that not looking is visible.
   */
  risks: z.array(z.string().min(1).max(512)).min(1).max(16),

  /** What else was considered and why not. At least one entry. */
  alternatives: z.array(z.string().min(1).max(512)).min(1).max(16),
})

/** Principle 7 rendered as a data structure. */
export type Explanation = z.infer<typeof ExplanationSchema>

export const PREVIEW_KINDS = ['text', 'diff', 'json', 'amount', 'none'] as const

export const PreviewKindSchema = z.enum(PREVIEW_KINDS)
export type PreviewKind = z.infer<typeof PreviewKindSchema>

export const PreviewSchema = z.object({
  kind: PreviewKindSchema,

  /**
   * ★ The actual artifact: the email text, the diff, the amount.
   *
   * Chapter 19 is explicit that this comes from the connector's dry run and
   * never from a model's description of what it intends to send. The gap
   * between "send a follow-up to Sarah" and the actual message is exactly
   * where a mistake hides, and a summary would hide it again.
   *
   * `none` exists for actions with no artifact to show, and is the only kind
   * for which this may be empty.
   */
  content: z.string().max(65536),
})

/** What the owner is actually approving, byte for byte. */
export type Preview = z.infer<typeof PreviewSchema>

export const ImpactSchema = z.object({
  reversible: z.boolean(),

  dataLeavesDevice: z.boolean(),

  /** Which categories leave, when any do. Article IV made legible. */
  dataCategories: z.array(z.string().min(1).max(64)).max(16),

  /** Null when the action costs nothing, rather than zero, so the two differ. */
  estimatedCostCents: z.int().nonnegative().nullable(),
})

/** The consequences, stated before rather than discovered after. */
export type Impact = z.infer<typeof ImpactSchema>

/**
 * How hard the owner must prove it is them, right now.
 *
 * Chapter 17's step-up table: `high` and `critical` need a live biometric or
 * passkey within 60 seconds. An unlocked laptop left unattended for five
 * minutes is the realistic threat, and a session established this morning does
 * not answer it.
 */
export const REQUIRED_AUTHS = ['none', 'biometric', 'passkey'] as const

export const RequiredAuthSchema = z.enum(REQUIRED_AUTHS)
export type RequiredAuth = z.infer<typeof RequiredAuthSchema>

/**
 * Where an answer came from.
 *
 * Recorded because one rule depends on it: Chapter 19 forbids approving a
 * `self_modification` from `mobile`, on the grounds that approving a code
 * change on a phone is not review. That is enforced in code rather than in
 * policy, which is why the surface has to be part of the response rather than
 * ambient session state.
 */
export const RESPONSE_SURFACES = ['desktop', 'web', 'mobile', 'cli'] as const

export const ResponseSurfaceSchema = z.enum(RESPONSE_SURFACES)
export type ResponseSurface = z.infer<typeof ResponseSurfaceSchema>

/**
 * Statuses.
 *
 * `expired` is a terminal *denial*, not a neutral lapse. Chapter 19's seventh
 * absolute rule: an approval is never auto-granted because a request timed out.
 * Failure defaults to inaction — if the notification system was broken and the
 * owner never saw the request, the action does not happen.
 */
export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'declined',
  'expired',
  'cancelled',
] as const

export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES)
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

/** Statuses from which no further response is possible. */
export const TERMINAL_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'approved',
  'declined',
  'expired',
  'cancelled',
]

export const ApprovalRequestSchema = z
  .object({
    id: UuidSchema,
    principalId: PrincipalIdSchema,

    /** One plain-language line. The whole request, if the owner reads nothing else. */
    title: z.string().min(1).max(256),

    riskClass: RiskClassSchema,

    explanation: ExplanationSchema,
    preview: PreviewSchema,
    impact: ImpactSchema,

    /** What is being asked about. */
    actor: ActorSchema,
    action: ActionSchema,
    resource: ResourceSchema,

    planId: PlanIdSchema.nullable(),
    planStepId: PlanStepIdSchema.nullable(),
    correlationId: CorrelationIdSchema.nullable(),

    /** The Guardian decision that raised this. Every request has a cause. */
    decisionId: UuidSchema,

    requiredAuth: RequiredAuthSchema,

    createdAt: TimestampSchema,

    /**
     * ★ Requests expire rather than accumulating into a backlog nobody faces.
     * Reaching this without an answer means `expired`, which means denied.
     */
    expiresAt: TimestampSchema,

    status: ApprovalStatusSchema,

    respondedAt: TimestampSchema.nullable(),
    respondedVia: ResponseSurfaceSchema.nullable(),

    /**
     * Why the owner declined, when they said. Fed into memory as a preference
     * signal — Chapter 19 treats a reasoned denial as information, not noise.
     */
    responseReason: z.string().max(2048).nullable(),
  })
  .superRefine((request, ctx) => {
    if (request.expiresAt <= request.createdAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'an approval request must expire after it was created',
      })
    }

    if (request.preview.kind !== 'none' && request.preview.content.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['preview', 'content'],
        message: 'a preview that claims to show an artifact must contain one',
      })
    }

    // A resolved request without a recorded time would leave "when did you
    // decide this" unanswerable, and time-to-decision is one of the two health
    // metrics Chapter 19 uses to detect rubber-stamping.
    const resolved = TERMINAL_APPROVAL_STATUSES.includes(request.status)
    if (resolved && request.respondedAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['respondedAt'],
        message: 'a resolved approval must record when it was resolved',
      })
    }

    if (!resolved && request.respondedAt !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'a pending approval cannot have been responded to',
      })
    }
  })

/** A question the owner has been asked, and may take days to answer. */
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

/**
 * Whether an approval has been settled, however it was settled.
 *
 * @param status - The request's current status.
 * @returns True when no further response will be accepted.
 */
export function isTerminalApprovalStatus(status: ApprovalStatus): boolean {
  return TERMINAL_APPROVAL_STATUSES.includes(status)
}
