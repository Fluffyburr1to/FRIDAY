import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Built-in defaults — the lowest layer of the precedence chain.
 *
 * They are the macOS locations from Chapter 33, so a fresh install with no
 * configuration at all still starts and puts its files where a Mac user would
 * expect to find them. Being able to run with zero configuration is what makes
 * the recovery commands usable when the config file is itself the problem.
 */

/** A partial shape, since every layer above may override any part of it. */
export interface DeepPartialConfig {
  env?: string
  principalId?: string
  paths?: { dataDir?: string; mainDb?: string; eventsDb?: string; cacheDb?: string }
  server?: { host?: string; port?: number }
  logging?: { level?: string; directory?: string }
  keychain?: {
    service?: string
    anthropicKeyRef?: string
    openaiKeyRef?: string
    backupKeyRef?: string
    fieldKeyRef?: string
  }
  models?: { ollamaUrl?: string }
  budgets?: {
    perAgentCents?: number
    perPlanCents?: number
    perDayCents?: number
    perMonthCents?: number
  }
  backup?: { enabled?: boolean; bucket?: string }
  telemetry?: { otelEnabled?: boolean; otelEndpoint?: string }
}

/**
 * Expands a leading `~` and resolves the path against the process directory.
 *
 * `~` is not expanded by anything in Node — it is a shell convention — so a
 * path copied out of `.env.example` would otherwise be created as a literal
 * directory called `~` next to wherever FRIDAY happened to be started.
 *
 * @param path - A path that may begin with `~`.
 * @returns An absolute path.
 */
export function expandPath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(path)
}

const DEFAULT_DATA_DIR = join(homedir(), 'Library', 'Application Support', 'FRIDAY')
const DEFAULT_LOG_DIR = join(homedir(), 'Library', 'Logs', 'FRIDAY')

/**
 * Builds the default configuration.
 *
 * A function rather than a constant because it reads the home directory, and a
 * constant would freeze whatever `HOME` was when the module first loaded —
 * which in a test run is not what any caller means.
 *
 * @returns The lowest layer of the precedence chain.
 */
export function defaultConfig(): DeepPartialConfig {
  return {
    env: 'development',
    principalId: 'usr_owner',
    paths: { dataDir: DEFAULT_DATA_DIR },
    server: { host: '127.0.0.1', port: 7420 },
    logging: { level: 'info', directory: DEFAULT_LOG_DIR },
    keychain: {
      service: 'com.friday.credentials',
      anthropicKeyRef: 'anthropic-api-key',
      openaiKeyRef: 'openai-api-key',
      backupKeyRef: 'backup-encryption-key',
      fieldKeyRef: 'field-encryption-key',
    },
    models: { ollamaUrl: 'http://127.0.0.1:11434' },
    budgets: {
      perAgentCents: 15,
      perPlanCents: 50,
      perDayCents: 800,
      perMonthCents: 15_000,
    },
    backup: { enabled: false, bucket: '' },
    telemetry: { otelEnabled: false, otelEndpoint: 'http://127.0.0.1:4318' },
  }
}

/**
 * Fills in the database paths that were not set explicitly.
 *
 * Applied after every other layer, so setting `dataDir` alone moves all three
 * files — which is what someone means when they set it — while naming an
 * individual file still wins.
 *
 * @param config - The merged configuration, before validation.
 * @returns The same configuration with `paths` complete and absolute.
 */
export function deriveDatabasePaths(config: DeepPartialConfig): DeepPartialConfig {
  const dataDir = expandPath(config.paths?.dataDir ?? DEFAULT_DATA_DIR)

  return {
    ...config,
    paths: {
      dataDir,
      mainDb: expandPath(config.paths?.mainDb ?? join(dataDir, 'friday.db')),
      eventsDb: expandPath(config.paths?.eventsDb ?? join(dataDir, 'events.db')),
      cacheDb: expandPath(config.paths?.cacheDb ?? join(dataDir, 'cache.db')),
    },
    logging: {
      ...config.logging,
      directory: expandPath(config.logging?.directory ?? DEFAULT_LOG_DIR),
    },
  }
}
