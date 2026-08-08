import type { FridayConfig } from '@friday/config'
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import type { CoreContext } from './context.js'
import { appRouter } from './router.js'

/**
 * The HTTP surface.
 *
 * `node:http` through tRPC's standalone adapter rather than a web framework.
 * One route serving one router for one user on one machine is not what a
 * framework earns its place doing, and the rule is to prefer writing the lines
 * over adding the package.
 *
 * Reference: docs/01-bible/20-api-standards.md
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
}): Promise<RunningServer> {
  const { config, context } = input

  const server = createHTTPServer({
    router: appRouter,
    createContext: () => context,
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
