import { z } from 'zod'

/**
 * The configuration schema.
 *
 * Validated at startup, in one place. Chapter 33's rule: invalid configuration
 * sends FRIDAY into Safe Mode with a clear message, rather than producing a
 * mysterious failure three hours later in a component that had no idea it was
 * misconfigured.
 *
 * ★ Nothing here is a secret. Configuration holds Keychain *references* —
 * `anthropic-api-key` is the NAME of a Keychain entry, not its contents. A
 * stolen config file yields nothing.
 *
 * Reference: docs/01-bible/33-deployment-strategy.md · Chapter 18
 */

export const EnvironmentSchema = z.enum(['development', 'staging', 'production'])
export type Environment = z.infer<typeof EnvironmentSchema>

const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])

const PathsSchema = z.object({
  /** Where the three database files live. */
  dataDir: z.string().min(1),

  /** Everything current: plans, approvals, memory, settings. */
  mainDb: z.string().min(1),

  /** ★ The immutable event log. Irreplaceable; backed up continuously. */
  eventsDb: z.string().min(1),

  /** Regenerable. Never backed up; deleting it costs nothing. */
  cacheDb: z.string().min(1),

  /**
   * ★ The authorization rules FRIDAY decides against.
   *
   * A directory of JSON rule files, read once at startup. Missing, empty, or
   * malformed is fatal — a Guardian whose rules failed to load refuses
   * everything, which is a broken system wearing a strict system's face.
   *
   * Deliberately **not** resolved from `packages/guardian/policies`: that
   * directory is the rules FRIDAY *ships with*, is not part of the published
   * package, and would be replaced by her own updates. This one is the owner's.
   *
   * See docs/adr/0033-authorization-rules-are-loaded-from-a-configured-directory.md
   */
  policiesDir: z.string().min(1),
})

const ServerSchema = z.object({
  /**
   * Loopback only, and validated as such below. Article IV: FRIDAY does not
   * listen on a network interface. Remote access, when it arrives at M7, is
   * Tailscale rather than an open port.
   */
  host: z.string().min(1),
  port: z.int().min(1024).max(65_535),
})

const LoggingSchema = z.object({
  level: LogLevelSchema,
  directory: z.string().min(1),
})

const KeychainSchema = z.object({
  /** The Keychain service every credential is stored under. */
  service: z.string().min(1),

  /** ★ References, not values. Each names a Keychain entry. */
  anthropicKeyRef: z.string().min(1),
  openaiKeyRef: z.string().min(1),
  backupKeyRef: z.string().min(1),

  /** The AES-256-GCM key that encrypts `private` fields in the database. */
  fieldKeyRef: z.string().min(1),
})

const ModelsSchema = z.object({
  /**
   * The local runtime, used for anything classified `private` or above. The
   * router FAILS CLOSED when it is unavailable: a sensitive request is refused
   * rather than quietly downgraded to a cloud provider.
   */
  ollamaUrl: z.url(),
})

/**
 * Budgets, in cents. Every level fails closed — exhausted means stop, never
 * "continue and bill it."
 *
 * A runaway overnight agent loop is the most plausible route to a surprise
 * bill an order of magnitude over budget, and it is the one failure here that
 * costs real money while everyone is asleep.
 */
const BudgetsSchema = z.object({
  perAgentCents: z.int().positive(),
  perPlanCents: z.int().positive(),
  perDayCents: z.int().positive(),
  perMonthCents: z.int().positive(),
})

const BackupSchema = z.object({
  enabled: z.boolean(),

  /** Empty until a bucket exists. Checked when `enabled` is true. */
  bucket: z.string(),
})

const TelemetrySchema = z.object({
  otelEnabled: z.boolean(),

  /** Localhost only. Nothing is exported off this machine, ever. */
  otelEndpoint: z.url(),
})

export const FridayConfigSchema = z
  .object({
    env: EnvironmentSchema,

    /**
     * Whose data this instance holds. Every query filters by it from the first
     * migration, so multi-user isolation is exercised years before a second
     * person exists.
     */
    principalId: z.string().min(1).max(128),

    paths: PathsSchema,
    server: ServerSchema,
    logging: LoggingSchema,
    keychain: KeychainSchema,
    models: ModelsSchema,
    budgets: BudgetsSchema,
    backup: BackupSchema,
    telemetry: TelemetrySchema,
  })
  .superRefine((config, ctx) => {
    // Article IV, checked rather than trusted. Binding to 0.0.0.0 would expose
    // every plan, memory, and approval to anything on the network, and it is a
    // one-character mistake away from the correct value.
    if (config.server.host !== '127.0.0.1' && config.server.host !== 'localhost') {
      ctx.addIssue({
        code: 'custom',
        path: ['server', 'host'],
        message:
          'FRIDAY listens on loopback only. Remote access is a VPN concern, not a bind address.',
      })
    }

    if (config.backup.enabled && config.backup.bucket.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['backup', 'bucket'],
        message: 'Backups are enabled but no bucket is configured, so nothing would be backed up.',
      })
    }

    if (config.budgets.perPlanCents < config.budgets.perAgentCents) {
      ctx.addIssue({
        code: 'custom',
        path: ['budgets', 'perPlanCents'],
        message: 'A plan budget below one agent’s budget would halt every plan on its first step.',
      })
    }

    if (config.budgets.perDayCents < config.budgets.perPlanCents) {
      ctx.addIssue({
        code: 'custom',
        path: ['budgets', 'perDayCents'],
        message: 'A daily budget below a single plan’s budget makes plans unrunnable.',
      })
    }
  })

/** FRIDAY's validated configuration. */
export type FridayConfig = z.infer<typeof FridayConfigSchema>
