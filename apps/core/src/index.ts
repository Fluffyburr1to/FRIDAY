import { fileURLToPath } from 'node:url'
import { loadConfig } from '@friday/config'
import { createKeychainKeyProvider } from '@friday/storage'
import { openContext } from './context.js'
import { startServer } from './server.js'

/**
 * `@friday/core` — the public surface.
 *
 * `apps/web` imports exactly one thing from here, and imports it as a type:
 * `AppRouter`. That is the whole coupling between the interface and the
 * service, and keeping it to a type means the dashboard bundle contains no
 * server code.
 *
 * See: README.md · docs/01-bible/05-backend-architecture.md
 */

export type { CoreContext, EventReader, OpenedContext } from './context.js'
export { openContext } from './context.js'
export type { AppRouter } from './router.js'
export {
  appRouter,
  ListEventsInput,
  ListEventsOutput,
  PendingApprovalsOutput,
  RespondInput,
} from './router.js'
export type { RunningServer } from './server.js'
export { startServer } from './server.js'

/** Process exit codes. `2` is a stated problem, matching the CLI's convention. */
const EXIT_PROBLEM = 2

/**
 * Starts friday-core.
 *
 * Every failure here is fatal and explained. README rule 1 says startup
 * validates its inputs and refuses to start rather than starting partially —
 * a service that came up without a readable event log would serve an empty
 * dashboard that looks exactly like a quiet day.
 *
 * @returns Nothing. Exits the process on failure.
 */
export async function main(): Promise<void> {
  const config = loadConfig({})

  if (!config.ok) {
    process.stderr.write(`${config.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  const opened = openContext({
    config: config.value,
    keys: createKeychainKeyProvider({ service: config.value.keychain.service }),
  })

  if (!opened.ok) {
    process.stderr.write(`${opened.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  // A request that ran out of time while FRIDAY was not running must be
  // settled before anything reads it as still pending. Chapter 19 is explicit
  // that an approval is never auto-granted by timing out, and a lapsed request
  // shown as awaiting an answer is the same lie in the other direction.
  const swept = opened.value.context.approvals.sweepExpired()

  if (!swept.ok) {
    process.stderr.write(`${swept.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  const server = await startServer({
    config: config.value,
    context: opened.value.context,
  })

  process.stdout.write(
    `friday-core listening on http://${config.value.server.host}:${server.port}\n`,
  )

  const stop = (): void => {
    void server.close().then(opened.value.close)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

// Runs only when this file is the process entry point, so importing the router
// for a test never starts a server.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
