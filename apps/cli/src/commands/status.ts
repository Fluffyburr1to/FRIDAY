import { existsSync, statSync } from 'node:fs'
import { type EventStore, openEventsReadOnly } from '@friday/storage'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode, formatBytes, formatTime } from '../output.js'

/**
 * `friday status` — is she healthy?
 *
 * Written for someone who does not read code. Every line answers a question
 * the owner might actually ask: where is my data, how much of it is there, is
 * the record intact, and when did she last do anything.
 *
 * Reference: apps/cli/README.md
 */

interface EventLogReport {
  path: string
  exists: boolean
  sizeBytes: number
  events: number
  latestSeq: number
  lastEventAt: number | null
  lastEventType: string | null

  /** Null when the check could not run, which is not the same as failing. */
  chainIntact: boolean | null
}

interface StatusReport {
  environment: string
  principal: string
  dataDirectory: string
  eventLog: EventLogReport
}

/** How many recent events `status` checks. `verify` checks all of them. */
const RECENT_WINDOW = 100

/**
 * Runs the status command.
 *
 * @param context - Configuration, key provider, and output.
 * @returns The process exit code.
 */
export function runStatus(context: CommandContext): ExitCode {
  const { config, out } = context

  const exists = existsSync(config.paths.eventsDb)

  const report: StatusReport = {
    environment: config.env,
    principal: config.principalId,
    dataDirectory: config.paths.dataDir,
    eventLog: {
      path: config.paths.eventsDb,
      exists,
      sizeBytes: exists ? statSync(config.paths.eventsDb).size : 0,
      events: 0,
      latestSeq: 0,
      lastEventAt: null,
      lastEventType: null,
      chainIntact: null,
    },
  }

  if (!exists) {
    out.line('FRIDAY has not run yet — there is no event log.')
    out.line(`  It will be created at ${config.paths.eventsDb}`)
    out.json(report)
    return EXIT.ok
  }

  const reader = openEventsReadOnly({
    eventsDbPath: config.paths.eventsDb,
    keys: context.keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!reader.ok) {
    out.problem(reader.error.message)
    out.json({ ...report, problem: reader.error })
    return EXIT.problem
  }

  try {
    fill(report.eventLog, reader.value.events)
    write(context, report)

    return report.eventLog.chainIntact === false ? EXIT.problem : EXIT.ok
  } finally {
    reader.value.close()
  }
}

function fill(log: EventLogReport, events: EventStore): void {
  log.events = events.count()
  log.latestSeq = events.latestSeq()

  const latest = events.readLatest({ limit: 1 })
  const newest = latest.ok ? latest.value[0] : undefined

  if (newest !== undefined) {
    log.lastEventAt = newest.occurredAt
    log.lastEventType = newest.type
  }

  // A cheap check on the tail rather than the whole chain. `friday verify` is
  // the thorough one; `status` should not read a year of history to say
  // whether FRIDAY is well.
  const verified = events.verifyChain({ fromSeq: Math.max(1, log.latestSeq - RECENT_WINDOW) })
  log.chainIntact = verified.ok ? verified.value.intact : null
}

function write(context: CommandContext, report: StatusReport): void {
  const { out } = context
  const log = report.eventLog

  out.line(`FRIDAY — ${report.environment}`)
  out.line('')
  out.line(`  Data          ${report.dataDirectory}`)
  out.line(`  Event log     ${formatBytes(log.sizeBytes)}, ${log.events} events`)

  out.line(
    log.lastEventAt === null
      ? '  Last event    none yet'
      : `  Last event    ${log.lastEventType} at ${formatTime(log.lastEventAt)}`,
  )

  out.line(`  Record        ${describeChain(log)}`)
  out.json(report)
}

function describeChain(log: EventLogReport): string {
  if (log.chainIntact === true) {
    return `intact (last ${Math.min(log.events, RECENT_WINDOW)} events checked)`
  }

  return log.chainIntact === false
    ? '★ BROKEN — run `friday verify` for detail'
    : 'could not be checked'
}
