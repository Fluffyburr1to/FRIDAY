import { z } from 'zod'
import { RiskClassSchema } from './plan.js'

/**
 * The connector manifest — Chapter 14's privacy contract, given teeth.
 *
 * A connector is the only kind of component permitted to reach the network,
 * and this is what it must declare before it may. Three of these fields are
 * load-bearing rather than documentary: `egress.hosts` is enforced by the HTTP
 * agent, `dataCategories` is what makes the privacy dashboard's answer to
 * *"what left my machine this week?"* truthful, and `scopeJustification` is
 * what stops a connector asking for broad permission because it was easier.
 *
 * ★ **The schema is where the rules live, not the SDK.** Chapter 14 states
 * four rules — undeclared egress is blocked, non-idempotent operations are
 * never retried, every call is bounded, dry run is mandatory for writes. A
 * rule enforced only inside `connector-sdk` is a rule a connector can be
 * written to sidestep before the SDK ever sees it. Enforced here, a manifest
 * that violates one cannot be constructed at all.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 18 · Article IV
 */

/**
 * A bare hostname, lowercase, with no scheme, port, path, or wildcard.
 *
 * ★ **Wildcards are refused deliberately.** `*.example.com` would let a
 * compromised dependency reach any host the provider controls, which is the
 * exact attack the allowlist exists to stop — and it would make the privacy
 * dashboard's itemisation a guess. Chapter 14 accepts the operational friction
 * as the price: a provider adding a CDN domain produces a blocked-egress
 * diagnostic naming the host, and the fix is a one-line manifest change with a
 * visible audit record. That is a better failure than a quiet one.
 */
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SNAKE_CASE_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

/** Risk classes at or above which an irreversible operation must be placed. */
const IRREVERSIBLE_MINIMUM: readonly string[] = ['high', 'critical', 'self_modification']

export const AUTH_TYPES = ['none', 'api_key', 'oauth2'] as const
export const AuthTypeSchema = z.enum(AUTH_TYPES)
export type AuthType = z.infer<typeof AuthTypeSchema>

export const ConnectorAuthSchema = z
  .object({
    type: AuthTypeSchema,

    /** Requested verbatim. The broker never issues more than is declared. */
    scopes: z.array(z.string().min(1).max(256)).max(32),

    /**
     * One sentence per scope, explaining why FRIDAY needs it.
     *
     * Checked against `scopes` in both directions below. A missing entry is
     * the failure Chapter 14 names — asking for breadth because it is
     * convenient — and a leftover entry is the tell of a copied manifest.
     */
    scopeJustification: z.record(z.string().min(1).max(256), z.string().min(1).max(512)),
  })
  .superRefine((auth, ctx) => {
    const justified = new Set(Object.keys(auth.scopeJustification))

    for (const scope of auth.scopes) {
      if (!justified.has(scope)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeJustification', scope],
          message: `scope "${scope}" is requested but not justified`,
        })
      }
    }

    for (const scope of justified) {
      if (!auth.scopes.includes(scope)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeJustification', scope],
          message: `scope "${scope}" is justified but not requested`,
        })
      }
    }

    // An unauthenticated connector holding scopes is either mislabelled or
    // about to acquire credentials it never declared.
    if (auth.type === 'none' && auth.scopes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'a connector that does not authenticate cannot request scopes',
      })
    }
  })

/** How a connector proves who it is, and what it asked to be allowed to do. */
export type ConnectorAuth = z.infer<typeof ConnectorAuthSchema>

export const ConnectorEgressSchema = z.object({
  /** The enforced allowlist. Empty means the connector has no reason to exist. */
  hosts: z
    .array(z.string().regex(HOSTNAME_REGEX, 'egress hosts are bare lowercase hostnames'))
    .min(1)
    .max(32),

  /**
   * What actually leaves, in categories the owner can read.
   *
   * Free-form snake_case rather than an enum on purpose. An enum would have to
   * be guessed now, before there are enough connectors to know the real
   * categories, and a wrong enum is harder to correct than a convention.
   * Narrowing this is a decision for the milestone that has connectors to
   * generalise from.
   */
  dataCategories: z
    .array(z.string().regex(SNAKE_CASE_REGEX, 'data categories are snake_case tokens').max(64))
    .max(32),

  transmitsPersonalData: z.boolean(),
  dataRetentionByProvider: z.string().min(1).max(512),
})

/** What this connector sends, and where. */
export type ConnectorEgress = z.infer<typeof ConnectorEgressSchema>

export const ConnectorOperationSchema = z.object({
  id: z.string().min(1).max(128).regex(KEBAB_CASE_REGEX, 'operation ids are kebab-case'),

  /** What this does, in the owner's language. Reaches the approval screen. */
  description: z.string().min(1).max(512),

  /**
   * What the connector expects this to be classified as.
   *
   * ★ **Declaratory, never authoritative** — the same rule as a department
   * capability. Risk is assigned by the Guardian from the owner's policy at
   * the moment the operation runs. If the two disagree, the Guardian is right
   * and this is a documentation bug in the connector.
   */
  riskClass: RiskClassSchema,

  /**
   * Whether repeating the call is harmless.
   *
   * ★ The retry rule depends on this and nothing else. Retrying a
   * non-idempotent operation is how you send an email three times.
   */
  idempotent: z.boolean(),

  /** Whether the effect cannot be undone. Constrained to `high` and above. */
  irreversible: z.boolean(),

  reads: z.array(z.string().regex(SNAKE_CASE_REGEX).max(64)).max(32),
  writes: z.array(z.string().regex(SNAKE_CASE_REGEX).max(64)).max(32),

  /** Chapter 14: every call is bounded. There is no unbounded wait. */
  timeoutMs: z.int().positive().max(300_000),
})

/** One thing a connector knows how to do. It decides nothing. */
export type ConnectorOperation = z.infer<typeof ConnectorOperationSchema>

export const ConnectorManifestSchema = z
  .object({
    id: z.string().min(1).max(128).regex(KEBAB_CASE_REGEX, 'connector ids are kebab-case'),
    service: z.string().min(1).max(128),
    version: z.string().min(1).max(32),

    auth: ConnectorAuthSchema,
    egress: ConnectorEgressSchema,

    operations: z.array(ConnectorOperationSchema).min(1).max(64),

    /** Enforced before the request. FRIDAY does not discover limits by being throttled. */
    rateLimits: z.object({
      requestsPerMinute: z.int().positive().max(100_000),
      burstSize: z.int().positive().max(10_000),
    }),

    healthCheck: z.object({
      /** Must name a declared operation — checked below. */
      operation: z.string().min(1).max(128),

      /**
       * Floored at 30s. A probe running more often than that stops measuring
       * the service and starts being part of its load.
       */
      intervalSeconds: z.int().min(30).max(86_400),
    }),

    supportsDryRun: z.boolean(),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>()

    for (const [index, operation] of manifest.operations.entries()) {
      if (seen.has(operation.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['operations', index, 'id'],
          message: `two operations claim the id "${operation.id}"`,
        })
      }
      seen.add(operation.id)

      // Chapter 14's third tier. An operation that cannot be undone is not a
      // medium-risk operation no matter how routine it feels to write.
      if (operation.irreversible && !IRREVERSIBLE_MINIMUM.includes(operation.riskClass)) {
        ctx.addIssue({
          code: 'custom',
          path: ['operations', index, 'riskClass'],
          message: 'an irreversible operation is at least high risk',
        })
      }
    }

    // Rule 4. Approving a description of a write is much weaker consent than
    // approving the artifact, so a connector that writes must be able to show
    // one before it is asked for permission.
    if (!manifest.supportsDryRun) {
      const writer = manifest.operations.findIndex((operation) => operation.writes.length > 0)

      if (writer >= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['supportsDryRun'],
          message: 'a connector with write operations must support dry run',
        })
      }
    }

    if (!seen.has(manifest.healthCheck.operation)) {
      ctx.addIssue({
        code: 'custom',
        path: ['healthCheck', 'operation'],
        message: `health check names "${manifest.healthCheck.operation}", which is not an operation`,
      })
    }
  })

/** Everything a connector must declare before it may reach the network. */
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>

/**
 * Whether the manifest permits reaching this host.
 *
 * ★ The single definition of the allowlist, so the SDK's HTTP agent, the
 * contract tests, and the privacy dashboard cannot drift into three subtly
 * different answers. Matching is exact after case folding: a declared host
 * never implies its subdomains, because `api.example.com` permitting
 * `evil.api.example.com` would hand the allowlist to whoever controls the
 * provider's DNS.
 *
 * @param manifest - The connector's manifest.
 * @param host - The hostname of the outbound request, without port or scheme.
 * @returns True only when the host was declared.
 */
export function egressPermits(manifest: ConnectorManifest, host: string): boolean {
  const normalised = host.toLowerCase()
  return manifest.egress.hosts.some((declared) => declared === normalised)
}

/**
 * Whether this operation may be retried.
 *
 * Chapter 14's rule stated once: transient failures are retried, but never for
 * an operation that is not idempotent. A connector supporting idempotency keys
 * supplies one and marks the operation idempotent.
 *
 * @param operation - The operation being considered for a retry.
 * @returns True only when repeating the call is harmless.
 */
export function mayRetry(operation: ConnectorOperation): boolean {
  return operation.idempotent
}

/**
 * Whether this operation must be previewed before it is approved.
 *
 * @param operation - The operation about to be requested.
 * @returns True when the operation writes anything.
 */
export function requiresDryRun(operation: ConnectorOperation): boolean {
  return operation.writes.length > 0
}
