import pino from 'pino'
import { redact } from './redaction.js'

/**
 * The system log — verbose, cheap, disposable, for debugging.
 *
 * Distinct from the audit trail, which is permanent, authoritative, and lives
 * in `kernel`. Conflating them makes both worse: the audit trail becomes
 * unusable noise, or debug records get rotated away along with records the
 * Constitution requires be kept forever.
 *
 * Structured JSON rather than readable text, because a text log cannot answer
 * "show me every failure in plan 01J8XKQ across all components," which is
 * exactly the question you have when something goes wrong. A formatter renders
 * it readably at display time; the stored form stays queryable.
 *
 * Reference: docs/01-bible/22-logging-standards.md
 */

/**
 * Levels, with the criteria from Chapter 22 rather than by feel.
 *
 * The `error` test: would you want to be interrupted about this? If not, it is
 * `warn`. A log full of errors nobody acts on trains you to ignore errors,
 * which is how the real one gets missed.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * Context carried on every line, so a stack trace can be tied to an action.
 *
 * The named fields explicitly admit `undefined`, rather than being merely
 * optional, because `exactOptionalPropertyTypes` is on and callers routinely
 * pass a correlation ID that may not exist yet — an event published outside
 * any request has none. Forcing every call site to build the object
 * conditionally would produce exactly the omitted-context this field exists to
 * prevent.
 */
export interface LogContext {
  /** ★ Ties this line to the audit trail. A line without one, where one was
   * available, is a defect caught in review. */
  correlationId?: string | undefined
  traceId?: string | undefined
  principalId?: string | undefined
  actor?: string | undefined
  [key: string]: unknown
}

/**
 * The logging surface FRIDAY uses.
 *
 * Deliberately narrower than Pino's own: no `silent`, no level-changing at the
 * instance, no serializer overrides. A package that can reconfigure the logger
 * can reconfigure the redaction, and redaction is not negotiable per caller.
 */
export interface Logger {
  fatal(context: LogContext, message: string): void
  error(context: LogContext, message: string): void
  warn(context: LogContext, message: string): void
  info(context: LogContext, message: string): void
  debug(context: LogContext, message: string): void
  trace(context: LogContext, message: string): void

  /**
   * Derives a logger that adds fixed context to every line.
   *
   * @param bindings - Context merged into every line the child writes.
   * @returns A logger with the bindings attached.
   */
  child(bindings: LogContext): Logger

  /** The level below which lines are dropped. */
  readonly level: LogLevel
}

export interface LoggerOptions {
  /** Names the component, e.g. `kernel.event-bus`. Appears on every line. */
  module: string

  /** `info` in production, `debug` in development. */
  level?: LogLevel

  /**
   * Where lines go. A file path, or omitted for stdout.
   *
   * Rotation arrives in the next commit. Until then a file grows unbounded,
   * which Chapter 22 does not permit for long.
   */
  destination?: string

  /** Test seam. Production callers omit it. */
  stream?: NodeJS.WritableStream
}

const DEFAULT_LEVEL: LogLevel = 'info'

/**
 * Creates a logger.
 *
 * Every value passed to it — context objects, message strings, errors — goes
 * through all three redaction layers before it is written. There is no way to
 * bypass that from a call site, which is the entire design: a rule that
 * depends on the caller remembering is a rule that holds for about a month.
 *
 * @param options - The module name, level, and destination.
 * @returns A logger. Never throws; a logger that can fail is a logger that
 *   turns a debugging session into an outage.
 */
export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? DEFAULT_LEVEL

  const instance = pino(
    {
      level,
      base: { module: options.module },

      // Milliseconds since the epoch, matching every timestamp in the event
      // log. An ISO string here would mean two time formats in one system.
      timestamp: () => `,"time":${Date.now()}`,

      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    options.stream ?? openDestination(options),
  )

  return wrap(instance, level)
}

/**
 * Opens the log destination.
 *
 * Stdout goes through Pino's own destination, which is asynchronous and
 * therefore cheap enough to leave on. The trade is that lines in flight are
 * lost if the process dies abruptly — acceptable here precisely because this
 * is the system log and not the audit trail. The audit trail is committed to
 * SQLite before anything acts on it, and losing a debug line is not the same
 * kind of event as losing a record the Constitution requires.
 *
 */
function openDestination(options: LoggerOptions): pino.DestinationStream {
  if (options.destination === undefined) return pino.destination({ dest: 1, sync: false })

  return pino.destination({ dest: options.destination, sync: false, mkdir: true })
}

/**
 * Wraps a Pino instance in the narrow `Logger` surface, redacting on the way.
 *
 * Redaction happens here rather than in a Pino hook because hooks do not see
 * `child()` bindings, and bindings are exactly where a correlation object with
 * a token in it gets attached once and then written on every subsequent line.
 */
function wrap(instance: pino.Logger, level: LogLevel): Logger {
  const write =
    (method: LogLevel) =>
    (context: LogContext, message: string): void => {
      instance[method](redact(context) as object, redact(message) as string)
    }

  return {
    fatal: write('fatal'),
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
    trace: write('trace'),
    level,
    child(bindings) {
      return wrap(instance.child(redact(bindings) as pino.Bindings), level)
    },
  }
}

/**
 * A logger that writes nothing.
 *
 * For tests, and for the recovery paths in the CLI that must work when the log
 * destination is itself the problem.
 *
 * @returns A logger with every method a no-op.
 */
export function createSilentLogger(): Logger {
  const noop = (): void => undefined

  const silent: Logger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    level: 'fatal',
    child: () => silent,
  }

  return silent
}
