import { EventSchema } from '@friday/contracts'
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

export const appRouter = t.router({
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
