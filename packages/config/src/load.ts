import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { defaultConfigFile, readConfigFile } from './config-file.js'
import { type DeepPartialConfig, defaultConfig, deriveDatabasePaths } from './defaults.js'
import { type EnvSource, malformedBooleans, readEnvironment } from './env.js'
import { type FridayConfig, FridayConfigSchema } from './schema.js'

/**
 * Configuration loading, with precedence.
 *
 * Lowest to highest: built-in defaults → `config.toml` → environment variables
 * → runtime overrides. Each layer names only what it changes; nothing has to
 * restate the whole configuration to adjust one value.
 *
 * The file is found in the data directory, which means the data directory
 * itself can only be set by the environment or a flag — a setting cannot say
 * where to look for the file that contains it. That is the one ordering
 * constraint in the chain and it is worth stating, because the alternative
 * looks like it should work and cannot.
 *
 * Reference: docs/01-bible/33-deployment-strategy.md · docs/adr/0022
 */

export interface LoadOptions {
  /**
   * A configuration file to read instead of the default `config.toml` in the
   * data directory. Missing is fine; unreadable or malformed is not.
   */
  configFile?: string

  /** The environment to read. Defaults to `process.env`. */
  env?: EnvSource

  /** The highest layer, for tests and for the CLI's flags. */
  overrides?: DeepPartialConfig
}

/**
 * Loads and validates FRIDAY's configuration.
 *
 * Returns a `Result` rather than throwing, because invalid configuration is an
 * expected outcome with a required response: Chapter 33 says FRIDAY enters
 * Safe Mode with a clear message. A thrown error at import time would produce
 * a stack trace instead, which tells the owner nothing.
 *
 * @param options - The file, the environment, and any overrides.
 * @returns The validated configuration, or a typed error naming every field
 *   that is wrong — all of them, not just the first.
 */
export function loadConfig(options: LoadOptions = {}): Result<FridayConfig, FridayError> {
  const env = options.env ?? process.env

  const malformed = malformedBooleans(env)
  if (malformed.length > 0) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          `${malformed.join(', ')} must be exactly "true" or "false". ` +
          'Anything else is refused rather than guessed at.',
        detail: { variables: [...malformed] },
      }),
    )
  }

  const file = readConfigFile(options.configFile ?? defaultConfigFile(dataDirFor(env)))
  if (!file.ok) return file

  const merged = deriveDatabasePaths(
    mergeDeep(mergeDeep(mergeDeep(defaultConfig(), file.value), readEnvironment(env)), {
      ...options.overrides,
    }),
  )

  const parsed = FridayConfigSchema.safeParse(merged)
  if (!parsed.success) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message: describeIssues(parsed.error.issues),
        detail: { issues: parsed.error.issues },
      }),
    )
  }

  return ok(parsed.data)
}

/**
 * Where to look for `config.toml`, before the file itself has been read.
 *
 * Only the defaults and the environment are consulted, because the file layer
 * has not loaded yet — a config file cannot say where to find itself. Anything
 * set in the file that affects the data directory takes effect for the
 * databases and the logs, but not for locating the file.
 */
function dataDirFor(env: EnvSource): string {
  const fromEnvironment = readEnvironment(env).paths?.dataDir
  if (fromEnvironment !== undefined) return fromEnvironment

  const fallback = defaultConfig().paths?.dataDir
  return fallback ?? '.'
}

/**
 * Merges one layer over another, one level into the nested groups.
 *
 * Deliberately not a general deep merge. The schema is exactly two levels
 * deep, a recursive merge would silently do something surprising to arrays,
 * and a hundred-line generic merge is harder to be sure about than the shape
 * it is merging.
 */
function mergeDeep(base: DeepPartialConfig, layer: DeepPartialConfig): DeepPartialConfig {
  const output: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue

    const existing = output[key]
    output[key] =
      isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value
  }

  return output as DeepPartialConfig
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Renders validation issues for someone who does not read code.
 *
 * `budgets.perDayCents: expected number, received NaN` is not much, but it
 * names the setting, and that is the difference between a five-second fix and
 * an afternoon.
 */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const described = issues.map((issue) => {
    const where = issue.path.map(String).join('.')
    return where.length === 0 ? issue.message : `${where}: ${issue.message}`
  })

  return `FRIDAY's configuration is not valid — ${described.join('; ')}`
}
