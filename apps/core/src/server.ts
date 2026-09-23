import { createServer } from 'node:http'
import type { FridayConfig } from '@friday/config'
import { createHTTPHandler } from '@trpc/server/adapters/standalone'
import type { CoreContext } from './context.js'
import { createDashboardFiles } from './dashboard.js'
import { appRouter } from './router.js'

/**
 * The HTTP surface.
 *
 * `node:http` through tRPC's standalone adapter rather than a web framework.
 * One route serving one router for one user on one machine is not what a
 * framework earns its place doing, and the rule is to prefer writing the lines
 * over adding the package.
 *
 * ★ It serves the dashboard's files too, when a build is configured. Chapter
 * 06 always said the browser surface is served directly by core; until now it
 * was not, and the dashboard asked for its API at a same-origin path nothing
 * served. Keeping both on one origin is also what lets the desktop shell be a
 * window rather than a second copy of the UI — see ADR-0052 §10 and
 * ./dashboard.ts.
 *
 * The dashboard is checked first and claims only paths that are real files, so
 * the API's procedure routes are unaffected. With no build configured, this is
 * exactly the API-only server it has always been.
 *
 * Reference: docs/01-bible/20-api-standards.md · docs/01-bible/06-frontend-architecture.md
 */

/** A running server, and the way to stop it. */
export interface RunningServer {
  readonly port: number
  close(): Promise<void>
}

/**
 * Starts the API.
 *
 * Binds to the configured host, which defaults to `127.0.0.1`. FRIDAY's data
 * does not leave the machine because there is no interface on which it could
 * — Article IV as a bind address rather than as a policy document.
 *
 * @param input - The configuration and the opened context.
 * @returns The running server, once it is accepting connections.
 */
export function startServer(input: {
  config: FridayConfig
  context: CoreContext

  /**
   * Where `apps/web`'s build output lives. Omitted means no dashboard is
   * served and core is API-only, which is what every existing caller gets.
   */
  dashboardDir?: string | undefined
}): Promise<RunningServer> {
  const { config, context } = input

  const api = createHTTPHandler({ router: appRouter, createContext: () => context })
  const dashboard =
    input.dashboardDir === undefined ? null : createDashboardFiles(input.dashboardDir)

  const server = createServer((request, response) => {
    // A real file wins; everything else is a procedure call. The two cannot
    // collide because procedure paths are not files in the build output.
    if (dashboard?.serve(request, response) === true) return

    void api(request, response)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)

    server.listen(config.server.port, config.server.host)

    server.once('listening', () => {
      const address = server.address()

      // A string address means a Unix socket, which this app does not use.
      // Guarding rather than asserting, because the alternative is a confident
      // `as number` that would be wrong exactly once and silently.
      if (address === null || typeof address === 'string') {
        reject(new Error('the API server started without a usable TCP address'))
        return
      }

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((error?: Error) => (error ? failed(error) : closed()))
          }),
      })
    })
  })
}
