#!/usr/bin/env node
export { numberFlag, parseArgs, stringFlag } from './args.js'
export { EXIT, formatBytes, formatTime } from './output.js'

import { numberFlag, type ParsedArgs, parseArgs, stringFlag } from './args.js'
import { runEmit, runTail } from './commands/events.js'
import { runInit } from './commands/init.js'
import { runStatus } from './commands/status.js'
import { runVerify } from './commands/verify.js'
import { type CommandContext, createContext } from './context.js'
import { createOutput, EXIT, type ExitCode } from './output.js'

/**
 * friday — the command-line client.
 *
 * The constraint that shapes this app, and the reason it is an app rather than
 * a package: the recovery commands must work when everything else is broken.
 * `friday panic --revoke-all`, `friday rollback`, and `friday restore` are
 * reached for precisely when the dashboard, the departments, and possibly the
 * kernel are unavailable. That rules out depending on any of them, and it is
 * why the dependency list here stays short on purpose.
 *
 * At Milestone 1 four commands exist. They are the ones that prove the
 * milestone: record an event, watch it arrive, and verify the record.
 *
 * See: README.md · docs/01-bible/34-disaster-recovery.md
 */

const USAGE = `friday — FRIDAY's command line

  friday init                      set her up for the first time
  friday status                    is she healthy?
  friday events tail               watch the event log live
  friday events emit [--note "…"]  record a test event
  friday verify [--from <seq>]     check the audit hash chain

Options
  --json                           machine-readable output
  --config <path>                  a configuration file to load
  -n <count>                       how many recent events to show first (tail)
  --since <seq>                    start the tail after this event
  --once                           print what is there and exit (tail)

Everything else arrives with the milestone that needs it — see
docs/01-bible/39-roadmap.md.`

/**
 * Runs the CLI.
 *
 * Exported and taking its arguments explicitly so the commands can be tested
 * without spawning a process. The entry point below is four lines.
 *
 * @param input - The arguments after the program name, and optional streams.
 * @returns The process exit code.
 */
export function run(input: {
  argv: readonly string[]
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  signal?: AbortSignal | undefined
}): Promise<ExitCode> {
  const args = parseArgs(input.argv)

  const out = createOutput({
    json: args.flags.json === true,
    ...(input.stdout === undefined ? {} : { stdout: input.stdout }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  })

  if (args.command.length === 0 || args.flags.help === true || args.flags.h === true) {
    out.problem(USAGE)
    return Promise.resolve(args.command.length === 0 ? EXIT.usage : EXIT.ok)
  }

  const context = createContext({ out, configFile: stringFlag(args.flags, 'config') })
  if (!context.ok) {
    // Chapter 33: invalid configuration produces a clear message, not a
    // mysterious failure three hours later.
    out.problem(context.error.message)
    out.json({ problem: context.error })
    return Promise.resolve(EXIT.problem)
  }

  return dispatch({ args, context: context.value, out, signal: input.signal })
}

interface Dispatch {
  args: ParsedArgs
  context: CommandContext
  out: ReturnType<typeof createOutput>
  signal?: AbortSignal | undefined
}

function dispatch(input: Dispatch): Promise<ExitCode> {
  const { args, context, out } = input
  const [command] = args.command

  if (command === 'init') return Promise.resolve(runInit({ context }))
  if (command === 'status') return Promise.resolve(runStatus(context))
  if (command === 'verify') return Promise.resolve(dispatchVerify(input))
  if (command === 'events') return dispatchEvents(input)

  return Promise.resolve(unknown(out, `friday ${command ?? ''}`))
}

function dispatchVerify({ args, context, out }: Dispatch): ExitCode {
  const from = numberFlag(args.flags, 'from', 1)

  if (from === undefined) {
    out.problem('--from needs a sequence number, for example `friday verify --from 400`.')
    return EXIT.usage
  }

  return runVerify({ context, fromSeq: Math.max(1, from) })
}

function dispatchEvents({ args, context, out, signal }: Dispatch): Promise<ExitCode> {
  const subcommand = args.command[1]

  if (subcommand === 'emit') {
    return runEmit({ context, note: stringFlag(args.flags, 'note') ?? 'a test event' })
  }

  if (subcommand !== 'tail') {
    return Promise.resolve(unknown(out, `friday events ${subcommand ?? ''}`))
  }

  const count = numberFlag(args.flags, 'n', 20)
  const since = numberFlag(args.flags, 'since', Number.NaN)

  if (count === undefined || since === undefined) {
    out.problem('-n and --since both need a number.')
    return Promise.resolve(EXIT.usage)
  }

  // `--once` drops the abort signal, which is what makes the tail return after
  // one pass. Following is the default because that is what "tail" means; a
  // script or a test needs the other behaviour and should not have to send
  // itself a signal to get it.
  return runTail({
    context,
    sinceSeq: Number.isNaN(since) ? undefined : since,
    count,
    signal: args.flags.once === true ? undefined : signal,
  })
}

function unknown(out: ReturnType<typeof createOutput>, attempted: string): ExitCode {
  out.problem(`Unknown command: ${attempted}`.trim())
  out.problem('')
  out.problem(USAGE)
  return EXIT.usage
}

/**
 * The entry point.
 *
 * `import.meta.main` is Node 24's replacement for the `require.main === module`
 * dance, and it is what keeps this file importable by a test without running
 * the CLI as a side effect.
 */
if (import.meta.main) {
  const controller = new AbortController()

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => controller.abort())
  }

  process.exitCode = await run({ argv: process.argv.slice(2), signal: controller.signal })
}
