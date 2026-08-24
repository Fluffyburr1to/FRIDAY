import { composeExplanation } from '@friday/chief-of-staff'
import {
  ApprovalRequestSchema,
  EventSchema,
  type FridayError,
  isAwaitingOwner,
  isTerminalPlanStatus,
  PLAN_STATUSES,
  PlanSchema,
  PlanStepSchema,
  RuntimeVitalsSchema,
} from '@friday/contracts'
import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { CoreContext } from './context.js'

/**
 * The API the dashboard reads.
 *
 * Every procedure here is four steps and no more: validate the input, call a
 * package, map the result onto the wire, map a failure onto an error. A rule,
 * a calculation, or a branch on domain meaning appearing in this file means
 * logic has escaped `packages/` — see README, "The boundary".
 *
 * Reference: docs/01-bible/20-api-standards.md
 */

const t = initTRPC.context<CoreContext>().create()

/**
 * How many events one page of the live view holds.
 *
 * Capped rather than unbounded because the log grows forever and a client
 * asking for all of it would be asking core to hold four months of history in
 * memory to render one screen.
 */
const MAX_PAGE = 200
const DEFAULT_PAGE = 50

export const ListEventsInput = z.object({
  limit: z.int().positive().max(MAX_PAGE).default(DEFAULT_PAGE),
})

/**
 * The full recorded envelope, validated on the way out.
 *
 * Nothing is trimmed. Chapter 26 is explicit that the ceiling on what can be
 * inspected is the same as the ceiling on what was recorded, and a server that
 * decided which fields the owner may see would be making exactly the kind of
 * decision this app is forbidden to make.
 */
export const ListEventsOutput = z.object({
  events: z.array(EventSchema),
})

export const RespondInput = z.object({
  approvalId: z.uuid(),
  decision: z.enum(['approve', 'decline']),
  reason: z.string().max(2048).optional(),
})

export const PendingApprovalsOutput = z.object({
  approvals: z.array(ApprovalRequestSchema),
})

/**
 * How many plans one page of the overview holds.
 *
 * Chapter 26's home screen shows what is happening and what needs you, not a
 * history — and a screen that scrolls forever is one nobody reads to the end.
 */
const MAX_PLANS = 100
const DEFAULT_PLANS = 25

export const ListPlansInput = z.object({
  limit: z.int().positive().max(MAX_PLANS).default(DEFAULT_PLANS),

  /**
   * Which plans to return.
   *
   * ★ `live` and `needs_you` are named here rather than left to the client to
   * assemble from statuses. Chapter 26's overview asks two questions —
   * *what is happening* and *what needs you* — and if each caller derived its
   * own answer from a status list, a status added later would silently be
   * missing from one screen and present on another.
   *
   * The derivation itself is `isAwaitingOwner` and `isTerminalPlanStatus`, in
   * `@friday/contracts`, next to the statuses. This file selects; it does not
   * decide what the words mean.
   */
  showing: z.enum(['live', 'needs_you', 'recent', ...PLAN_STATUSES]).default('recent'),
})

/**
 * A plan, and how far it got.
 *
 * The steps travel with it because Chapter 26's plan view is the plan *and*
 * its steps, and a second round trip to render one screen is a screen that
 * renders in two stages.
 */
export const PlanWithStepsSchema = z.object({
  plan: PlanSchema,
  steps: z.array(PlanStepSchema),
})

export const ListPlansOutput = z.object({
  plans: z.array(PlanWithStepsSchema),
})

export const PlanIdInput = z.object({ planId: z.uuid() })

export const WhyInput = z.object({
  planId: z.uuid(),
  depth: z.enum(['summary', 'standard', 'full']).default('standard'),
})

/**
 * The account of one plan, every line carrying the event behind it.
 *
 * ★ `eventId` on every line is not decoration — it is what makes Chapter 26's
 * Layer 4 reachable from Layer 3, and what stops an explanation being a story.
 * `omitted` and `orphaned` travel too, so *"is this the whole story?"* has an
 * answer on the screen rather than only in the package.
 */
export const WhyOutput = z.object({
  headline: z.string(),
  asked: z.string(),
  rationale: z.string(),
  lines: z.array(
    z.object({
      text: z.string(),
      eventId: z.string(),
      eventType: z.string(),
      seq: z.int(),
      occurredAt: z.int(),
      depth: z.int(),
    }),
  ),
  omitted: z.object({ belowDepth: z.int(), unphrased: z.array(z.string()) }),
  orphaned: z.array(z.string()),
})

/**
 * Failures that mean FRIDAY could not write, not that the caller was wrong.
 *
 * ★ Kept distinct because the difference is the whole point of ADR-0032: an
 * approval that could not be recorded is an infrastructure fault, and
 * reporting it as a bad request would tell the owner their answer was refused
 * when in fact nothing was decided at all.
 */
const UNWRITABLE: readonly FridayError['code'][] = [
  'EVENT_LOG_UNWRITABLE',
  'STORAGE_UNAVAILABLE',
  'STORAGE_WRITE_FAILED',
]

/**
 * Turns a typed failure from a package into a tRPC error.
 *
 * The code travels intact so the dashboard can tell `STEP_UP_REQUIRED` from a
 * genuine fault, and the plain-language message is the one the package wrote —
 * this app does not compose its own explanation of a refusal it did not make.
 */
function refuse(error: FridayError): TRPCError {
  if (UNWRITABLE.includes(error.code)) {
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message, cause: error })
  }

  return new TRPCError({
    code: error.code === 'STEP_UP_REQUIRED' ? 'FORBIDDEN' : 'BAD_REQUEST',
    message: error.message,
    cause: error,
  })
}

export const appRouter = t.router({
  approvals: t.router({
    /** Everything still waiting on the owner, closest to expiring first. */
    pending: t.procedure.output(PendingApprovalsOutput).query(({ ctx }) => {
      const result = ctx.approvals.pending(ctx.principalId)

      if (!result.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
          cause: result.error,
        })
      }

      return { approvals: [...result.value] }
    }),

    /**
     * The owner's answer.
     *
     * ★ This app decides nothing here. It names the surface the answer arrived
     * on and hands the rest to the Guardian, which applies Chapter 19's rules —
     * including whether this surface may answer this request at all.
     *
     * `authenticatedAt` is deliberately never set. A browser on this machine
     * cannot prove the owner is present, only that the request came from the
     * owner's machine, so anything above `medium` is refused with
     * STEP_UP_REQUIRED. Supplying a timestamp here would not implement the
     * check — it would defeat it while leaving the code that looks like it.
     *
     * See docs/adr/0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md
     */
    respond: t.procedure
      .input(RespondInput)
      .output(ApprovalRequestSchema)
      .mutation(async ({ input, ctx }) => {
        const result = await ctx.approvals.respond({
          approvalId: input.approvalId,
          decision: input.decision,
          via: 'web',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        })

        if (!result.ok) throw refuse(result.error)

        // The answer and the event recording it were one write. Returning the
        // request without its event, or an event without the request, is not a
        // state this procedure can observe.
        return result.value.request
      }),
  }),

  plans: t.router({
    /**
     * What FRIDAY has undertaken.
     *
     * ★ Reads and returns. There is no procedure on this router that advances
     * a plan, approves one, or writes a step — moving a plan goes through the
     * Chief of Staff, where the state machine decides and the transition is
     * recorded, or it does not happen at all.
     */
    list: t.procedure
      .input(ListPlansInput)
      .output(ListPlansOutput)
      .query(({ input, ctx }) => {
        const found = ctx.plans.listPlans({ principalId: ctx.principalId })
        if (!found.ok) throw refuse(found.error)

        const wanted = found.value.filter((plan) => matches(plan.status, input.showing))

        return {
          plans: wanted.slice(0, input.limit).map((plan) => ({
            plan,
            steps: stepsOf(ctx, plan.id),
          })),
        }
      }),

    /** One plan, with its steps. */
    get: t.procedure
      .input(PlanIdInput)
      .output(PlanWithStepsSchema)
      .query(({ input, ctx }) => {
        const found = ctx.plans.getPlan({ id: input.planId, principalId: ctx.principalId })
        if (!found.ok) throw refuse(found.error)

        if (found.value === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'FRIDAY has no plan with that id.' })
        }

        return { plan: found.value, steps: stepsOf(ctx, found.value.id) }
      }),

    /**
     * Why FRIDAY did what she did.
     *
     * ★ Composed from the recorded events every time, never read from the
     * plan's stored `explanation` column. Chapter 12 §2 is explicit that if
     * the stored text and the events ever disagree, **the events are right** —
     * so the screen that answers "why?" reads the thing that is right.
     */
    why: t.procedure
      .input(WhyInput)
      .output(WhyOutput)
      .query(({ input, ctx }) => {
        const found = ctx.plans.getPlan({ id: input.planId, principalId: ctx.principalId })
        if (!found.ok) throw refuse(found.error)

        if (found.value === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'FRIDAY has no plan with that id.' })
        }

        const events = ctx.auditor.reconstruct({
          correlationId: found.value.correlationId,
          principalId: ctx.principalId,
        })

        if (!events.ok) throw refuse(events.error)

        const composed = composeExplanation({
          plan: found.value,
          events: events.value.events,
          depth: input.depth,
        })

        if (!composed.ok) throw refuse(composed.error)

        return {
          headline: composed.value.headline,
          asked: composed.value.asked,
          rationale: composed.value.rationale,
          lines: [...composed.value.detail.lines],
          omitted: {
            belowDepth: composed.value.detail.omitted.belowDepth,
            unphrased: [...composed.value.detail.omitted.unphrased],
          },
          orphaned: [...composed.value.detail.orphaned],
        }
      }),
  }),

  events: t.router({
    /** The most recent events, newest first. */
    list: t.procedure
      .input(ListEventsInput)
      .output(ListEventsOutput)
      .query(({ input, ctx }) => {
        const result = ctx.events.readLatest({ limit: input.limit })

        if (!result.ok) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: result.error.message,
            cause: result.error,
          })
        }

        return { events: result.value }
      }),
  }),

  vitals: t.router({
    /**
     * What the FRIDAY runtime is doing, right now.
     *
     * ★ No error branch, and that is the contract rather than an omission. A
     * vital that cannot be read comes back as an `absent` reading carrying its
     * own reason, so one unavailable metric degrades one row instead of
     * blanking a panel the owner is using to watch four others.
     *
     * See docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
     */
    current: t.procedure.output(RuntimeVitalsSchema).query(({ ctx }) => ctx.vitals.read()),
  }),
})

/**
 * Whether a plan belongs on the screen that was asked for.
 *
 * ★ Selection, not definition. What *awaiting the owner* and *finished* mean
 * lives in `@friday/contracts` beside the statuses themselves, so a status
 * added later is answered in one place rather than in every caller that
 * happened to enumerate the old ones.
 */
function matches(status: (typeof PLAN_STATUSES)[number], showing: string): boolean {
  if (showing === 'live') return !isTerminalPlanStatus(status)
  if (showing === 'needs_you') return isAwaitingOwner(status)
  if (showing === 'recent') return true

  return status === showing
}

/**
 * A plan's steps, or none.
 *
 * ★ A plan whose steps cannot be read is reported as a plan with no steps
 * rather than failing the whole page, and that is a deliberate trade the other
 * way from `refuse`: the overview is the screen the owner opens when something
 * is wrong, and one unreadable plan must not blank the list of the others. The
 * plan itself still appears, so the gap is visible rather than silent.
 */
function stepsOf(ctx: CoreContext, planId: string) {
  const steps = ctx.plans.listSteps({ planId, principalId: ctx.principalId })

  return steps.ok ? steps.value : []
}

/**
 * The router's type, and the only thing `apps/web` imports from this app.
 *
 * This is what Chapter 20 buys with tRPC: the dashboard calling a procedure
 * that does not exist, or passing the wrong argument shape, is a compile error
 * rather than a runtime surprise the owner would have to diagnose from a
 * symptom.
 */
export type AppRouter = typeof appRouter
