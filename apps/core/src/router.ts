import { ApprovalRequestSchema, EventSchema, type FridayError } from '@friday/contracts'
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
})

/**
 * The router's type, and the only thing `apps/web` imports from this app.
 *
 * This is what Chapter 20 buys with tRPC: the dashboard calling a procedure
 * that does not exist, or passing the wrong argument shape, is a compile error
 * rather than a runtime surprise the owner would have to diagnose from a
 * symptom.
 */
export type AppRouter = typeof appRouter
