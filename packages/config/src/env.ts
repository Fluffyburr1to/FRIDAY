import type { DeepPartialConfig } from './defaults.js'

/**
 * ★ The only place in FRIDAY that reads the environment.
 *
 * Enforced by lint, and worth the enforcement: `process.env.SOMETHING` read
 * directly in a department is a value nobody validated, documented, or can
 * find. One validated place means one place to look when a setting is not
 * doing what someone expected.
 *
 * Reference: docs/01-bible/30-coding-standards.md
 */

/**
 * The mapping between environment variables and configuration.
 *
 * Every entry here must also appear in `.env.example` — Chapter 33's rule that
 * the example file documents every variable. A test asserts the two agree, so
 * adding a variable in one place and forgetting the other fails CI rather than
 * producing an undocumented setting nobody knows exists.
 */
export const ENV_VARIABLES = [
  'FRIDAY_ENV',
  'FRIDAY_PRINCIPAL_ID',
  'FRIDAY_DATA_DIR',
  'FRIDAY_DB_PATH',
  'FRIDAY_EVENTS_DB_PATH',
  'FRIDAY_CACHE_DB_PATH',
  'FRIDAY_HOST',
  'FRIDAY_PORT',
  'FRIDAY_LOG_LEVEL',
  'FRIDAY_LOG_DIR',
  'FRIDAY_KEYCHAIN_SERVICE',
  'FRIDAY_ANTHROPIC_KEY_REF',
  'FRIDAY_OPENAI_KEY_REF',
  'FRIDAY_BACKUP_KEY_REF',
  'FRIDAY_FIELD_KEY_REF',
  'FRIDAY_OLLAMA_URL',
  'FRIDAY_BUDGET_PER_AGENT_CENTS',
  'FRIDAY_BUDGET_PER_PLAN_CENTS',
  'FRIDAY_BUDGET_PER_DAY_CENTS',
  'FRIDAY_BUDGET_PER_MONTH_CENTS',
  'FRIDAY_BACKUP_ENABLED',
  'FRIDAY_BACKUP_BUCKET',
  'FRIDAY_OTEL_ENABLED',
  'FRIDAY_OTEL_ENDPOINT',
] as const

export type EnvVariable = (typeof ENV_VARIABLES)[number]

/** The environment as a plain record. Injectable so tests never mutate the real one. */
export type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * Reads a string, treating an empty value as absent.
 *
 * `FRIDAY_BACKUP_BUCKET=` in a shell sets the variable to an empty string,
 * which is a different thing from not setting it — but nobody writing that
 * line means "override the default with nothing".
 */
function str(env: EnvSource, name: EnvVariable): string | undefined {
  const value = env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Reads an integer.
 *
 * Returns the raw string as `Number.NaN` when it is not a number, so Zod
 * reports it as an invalid value with the field name attached rather than this
 * function silently falling back to a default the operator did not choose.
 */
function int(env: EnvSource, name: EnvVariable): number | undefined {
  const value = str(env, name)
  return value === undefined ? undefined : Number(value)
}

/** Reads a boolean. Only `true` and `false` are accepted; see `boolIssues`. */
function bool(env: EnvSource, name: EnvVariable): boolean | undefined {
  const value = str(env, name)?.toLowerCase()
  if (value === undefined) return undefined
  return value === 'true' ? true : value === 'false' ? false : undefined
}

/**
 * Names the boolean variables that were set to something unrecognised.
 *
 * Reported rather than coerced. `FRIDAY_BACKUP_ENABLED=yes` silently meaning
 * "false" is how someone discovers months later that nothing was ever backed
 * up — the worst kind of configuration bug, because it looks like it worked.
 *
 * @param env - The environment to inspect.
 * @returns The names of malformed boolean variables, if any.
 */
export function malformedBooleans(env: EnvSource): readonly string[] {
  const booleans: EnvVariable[] = ['FRIDAY_BACKUP_ENABLED', 'FRIDAY_OTEL_ENABLED']

  return booleans.filter((name) => {
    const raw = str(env, name)
    return raw !== undefined && bool(env, name) === undefined
  })
}

/**
 * Reads configuration from the environment.
 *
 * Only variables that are actually set appear in the result, so an unset
 * variable leaves the layer below it — the config file, then the defaults —
 * in charge.
 *
 * @param env - The environment to read. Defaults to `process.env`.
 * @returns A partial configuration containing only what was set.
 */
export function readEnvironment(env: EnvSource = process.env): DeepPartialConfig {
  const layer = prune({
    env: str(env, 'FRIDAY_ENV'),
    principalId: str(env, 'FRIDAY_PRINCIPAL_ID'),
    paths: prune({
      dataDir: str(env, 'FRIDAY_DATA_DIR'),
      mainDb: str(env, 'FRIDAY_DB_PATH'),
      eventsDb: str(env, 'FRIDAY_EVENTS_DB_PATH'),
      cacheDb: str(env, 'FRIDAY_CACHE_DB_PATH'),
    }),
    server: prune({ host: str(env, 'FRIDAY_HOST'), port: int(env, 'FRIDAY_PORT') }),
    logging: prune({
      level: str(env, 'FRIDAY_LOG_LEVEL'),
      directory: str(env, 'FRIDAY_LOG_DIR'),
    }),
    keychain: prune({
      service: str(env, 'FRIDAY_KEYCHAIN_SERVICE'),
      anthropicKeyRef: str(env, 'FRIDAY_ANTHROPIC_KEY_REF'),
      openaiKeyRef: str(env, 'FRIDAY_OPENAI_KEY_REF'),
      backupKeyRef: str(env, 'FRIDAY_BACKUP_KEY_REF'),
      fieldKeyRef: str(env, 'FRIDAY_FIELD_KEY_REF'),
    }),
    models: prune({ ollamaUrl: str(env, 'FRIDAY_OLLAMA_URL') }),
    budgets: prune({
      perAgentCents: int(env, 'FRIDAY_BUDGET_PER_AGENT_CENTS'),
      perPlanCents: int(env, 'FRIDAY_BUDGET_PER_PLAN_CENTS'),
      perDayCents: int(env, 'FRIDAY_BUDGET_PER_DAY_CENTS'),
      perMonthCents: int(env, 'FRIDAY_BUDGET_PER_MONTH_CENTS'),
    }),
    backup: prune({
      enabled: bool(env, 'FRIDAY_BACKUP_ENABLED'),
      bucket: str(env, 'FRIDAY_BACKUP_BUCKET'),
    }),
    telemetry: prune({
      otelEnabled: bool(env, 'FRIDAY_OTEL_ENABLED'),
      otelEndpoint: str(env, 'FRIDAY_OTEL_ENDPOINT'),
    }),
  })

  // `prune` returns undefined for a wholly empty layer, which is the right
  // answer for a nested group and the wrong one here — a caller merging layers
  // needs an object to iterate over, not an absent one. The cast is safe
  // because `prune` only ever removes keys; it never changes a value's type.
  return (layer ?? {}) as DeepPartialConfig
}

/**
 * Drops undefined entries, and drops a group that ended up empty.
 *
 * Without this, an unset `FRIDAY_HOST` would merge `{ host: undefined }` over
 * the default and erase it — the classic bug in a layered configuration
 * loader, and one that only shows up when a variable is *not* set.
 */
function prune<T extends Record<string, unknown>>(value: T): Partial<T> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Partial<T>)
}
