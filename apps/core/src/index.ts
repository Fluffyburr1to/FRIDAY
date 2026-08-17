import { loadConfig } from '@friday/config'
import { createKeychainKeyProvider } from '@friday/storage'
import { openContext } from './context.js'
import { fatalProblem, runStartupSelfCheck } from './self-check.js'
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
export type { SelfCheckOutcome } from './self-check.js'
export { fatalProblem, runStartupSelfCheck } from './self-check.js'
export type { RunningServer } from './server.js'
export { startServer } from './server.js'

/**
 * The exit code for a stated problem, matching the CLI's convention.
 *
 * ★ The CLI reserves `1` for *a problem it found* and `2` for *being invoked
 * wrongly* ([`apps/cli/src/output.ts`](../../cli/src/output.ts)). This constant
 * said `2` while claiming to match that, so every fatal startup fault reported
 * itself with the code meaning "you typed the command wrong" — a claim core
 * cannot make, since it takes no arguments to get wrong.
 *
 * It matters now because launchd is the first thing that reads it. `KeepAlive`
 * is unconditional (Chapter 33), so restarts do not turn on the code, but
 * `launchctl list` reports the last exit status and that is what the owner and
 * the diagnostics will be reading when FRIDAY will not start. A fault that
 * reports itself as a usage error sends whoever is looking at it to the wrong
 * question.
 *
 * There is no `usage` counterpart here deliberately: core has no arguments, so
 * the state that code names cannot arise.
 */
const EXIT_PROBLEM = 1

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

  // ★ She records that she started before she does anything else, including
  // checking herself. Chapter 10: "She will not act if she cannot record" — so
  // this is a write-liveness gate, not a formality, and a gate that ran after
  // the work it guards would not be one. It also puts the log in the order the
  // events happened: she started, then she asked to verify herself.
  //
  // See docs/adr/0044-apps-core-records-that-friday-started-before-she-checks-herself.md
  const started = await opened.value.announceStarted()

  if (!started.ok) {
    process.stderr.write(`${started.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  // A request that ran out of time while FRIDAY was not running must be
  // settled before anything reads it as still pending. Chapter 19 is explicit
  // that an approval is never auto-granted by timing out, and a lapsed request
  // shown as awaiting an answer is the same lie in the other direction.
  const swept = await opened.value.context.approvals.sweepExpired()

  if (!swept.ok) {
    process.stderr.write(`${swept.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  // README rule 1: startup validates database integrity. FRIDAY asks the
  // Guardian before checking her own log, and the answer is recorded before
  // the check runs — decide, record, then act.
  const checked = await runStartupSelfCheck({
    authorizing: opened.value.authorizing,
    events: opened.value.context.events,
    principalId: config.value.principalId,
  })

  if (!checked.ok) {
    process.stderr.write(`${checked.error.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  const fatal = fatalProblem(checked.value)

  if (fatal !== null) {
    process.stderr.write(`${fatal.message}\n`)
    process.exit(EXIT_PROBLEM)
  }

  // A refusal is the owner's rules working, not a fault — so it is reported
  // and startup continues. Silence here would leave FRIDAY running with an
  // unverified log and nothing saying so.
  if (checked.value.decision.decision !== 'allow') {
    process.stderr.write(`Startup integrity check skipped: ${checked.value.decision.summary}\n`)
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

/**
 * The entry point.
 *
 * `import.meta.main` is Node 24's replacement for the `require.main === module`
 * dance, and it is what keeps this file importable by a test without starting a
 * server. `apps/cli` already guards itself this way; this file now matches it.
 *
 * ★ The comparison it replaces — `fileURLToPath(import.meta.url) === process.argv[1]`
 * — was correct in the workspace and wrong everywhere FRIDAY is actually
 * installed. A published copy is reached through a symlink
 * (`node_modules/@friday/core` points into pnpm's virtual store), Node resolves
 * `import.meta.url` to the real path, and `process.argv[1]` stays the path that
 * was invoked. The two never match, so `main()` was never called.
 *
 * The failure had no symptom. The process exited 0, immediately, having written
 * nothing to any stream — so under the supervision that starts FRIDAY at login
 * (`RunAtLoad`, unconditional `KeepAlive`, `ThrottleInterval 10`) she would have
 * relaunched silently every ten seconds forever, reporting success each time,
 * with nothing in any log to say otherwise. The code that opens the log is
 * below this line.
 */
if (import.meta.main) {
  await main()
}
