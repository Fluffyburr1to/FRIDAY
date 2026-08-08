import type { AppRouter } from '@friday/core'
import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'

/**
 * The connection to FRIDAY.
 *
 * `AppRouter` is imported as a type and nothing else crosses from the server,
 * so none of `apps/core` reaches the browser bundle. What it buys is Chapter
 * 20's central claim: calling a procedure that does not exist, or passing the
 * wrong argument shape, fails at compile time rather than becoming a runtime
 * surprise the owner would have to diagnose from a symptom.
 *
 * Reference: docs/01-bible/20-api-standards.md
 */

/**
 * Same-origin. Vite proxies this to core in development, and core serves the
 * bundle itself in production — see vite.config.ts.
 */
const API_PATH = '/trpc'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * No retries, deliberately.
       *
       * These queries poll a socket on this machine, so the next poll already
       * is the retry — and retrying underneath one keeps the query in a
       * "trying again" state that never settles, which means the screen goes
       * on looking healthy while nothing is reaching FRIDAY. Failing straight
       * away is what lets rule 4's staleness marker appear when it is true.
       *
       * The last good data is retained across the failure either way; that is
       * the query cache's behavior, not the retry policy's.
       */
      retry: false,
    },
  },
})

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: API_PATH })],
})

export const trpc = createTRPCOptionsProxy<AppRouter>({ client, queryClient })
