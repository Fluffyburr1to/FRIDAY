/**
 * @friday/telemetry — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * The distinction this package exists to preserve: telemetry is the *system
 * log* — verbose, cheap, disposable, for debugging. The *audit trail* is
 * permanent and authoritative and lives in `kernel`. Conflating them makes
 * both worse.
 *
 * See: README.md · docs/01-bible/22-logging-standards.md
 */

export {
  createLogger,
  createSilentLogger,
  LOG_LEVELS,
  type LogContext,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from './logger.js'
export {
  type ClassifiedValue,
  classified,
  isDeniedKey,
  REDACTED,
  redact,
  scrubString,
} from './redaction.js'
