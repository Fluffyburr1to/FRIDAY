import { z } from 'zod'
import type { EventRegistry, EventTypeDefinition } from './event-registry.js'

/**
 * The event types Milestone 6 adds: everything a connector does.
 *
 * Connectors are the only components that talk to the outside world, which
 * makes them the ones Article II is hardest and most important to hold for. A
 * call that is not an event is a call the owner cannot see, and *"what left my
 * machine this week?"* becomes an estimate rather than an answer.
 *
 * ★ **No payload here carries a credential, and none carries the content of a
 * request or a response.** What is recorded is that a call happened, to whom,
 * for which operation, and how it ended. Chapter 22 puts a redaction layer in
 * the logger; this is designed so that layer has nothing to catch.
 *
 * Sensitivity follows the rule the Guardian's types already use: the *fact* of
 * a call is metadata, but the *host* and the *data categories* say something
 * about the owner's life. `security.egress.blocked` names a host the owner
 * never authorised, which is exactly the kind of thing they need to see, so it
 * is `internal` rather than `private` — a refusal must never be too sensitive
 * to show on the screen that exists to show it.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 10 · Chapter 22
 */

const ConnectorIdSchema = z.string().min(1).max(128)
const OperationIdSchema = z.string().min(1).max(128)

export const CredentialIssuedPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,

  /** ★ Why it was issued, not merely that it was. */
  operationId: OperationIdSchema,

  /** What the token may do. Never the token. */
  scopes: z.array(z.string().min(1).max(256)).max(32),

  /** Short by design. Recorded so a long-lived token is visible as a fault. */
  expiresAt: z.int().nonnegative(),
})

export const CredentialRevokedPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,

  /** Whether the owner did this, or FRIDAY did it on their behalf. */
  requestedBy: z.enum(['owner', 'system']),
  reason: z.string().min(1).max(512),
})

export const ConnectorCalledPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,
  operationId: OperationIdSchema,

  /**
   * How it ended, in the connector's own vocabulary.
   *
   * `refused` is separate from `failed` on purpose: FRIDAY declining to make a
   * call is not the same event as a call that went out and did not work, and a
   * dashboard that merged them would report our own safety controls as
   * provider outages.
   */
  outcome: z.enum(['succeeded', 'failed', 'refused']),

  /** Present only when the call actually reached a provider. */
  status: z.int().nonnegative().nullable(),

  durationMs: z.int().nonnegative(),

  /** How many tries it took. `1` means it worked first time. */
  attempts: z.int().positive(),

  /** The error code when it did not succeed. Never a message from a provider. */
  errorCode: z.string().min(1).max(64).nullable(),
})

export const EgressBlockedPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,
  operationId: OperationIdSchema,

  /** Null when the connector supplied something that was not a URL at all. */
  host: z.string().max(253).nullable(),

  reason: z.enum(['undeclared_host', 'insecure_transport', 'unparseable_url']),
})

export const ConnectorDegradedPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,

  /** Plain language, for the dashboard. Article II. */
  reason: z.string().min(1).max(512),
  consecutiveFailures: z.int().nonnegative(),

  /** When the circuit will let one call through again. */
  retryAt: z.int().nonnegative(),
})

export const ConnectorRecoveredPayloadSchema = z.object({
  connectorId: ConnectorIdSchema,

  /** How long it was unusable. The number the reliability review needs. */
  degradedForMs: z.int().nonnegative(),
})

/**
 * The connector event types.
 *
 * ★ `security.egress.blocked` is the one that must never be dropped. Chapter 14
 * requires it to raise a diagnostic, and it is the only signal that a
 * connector — or something that has taken one over — tried to reach somewhere
 * it never declared. A refusal nobody is told about is a refusal that teaches
 * the owner nothing.
 */
export const CONNECTOR_EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: 'credential.issued',
    payloadVersion: 1,
    schema: CredentialIssuedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A short-lived key was issued to a connector for one job.',
  },
  {
    type: 'credential.revoked',
    payloadVersion: 1,
    schema: CredentialRevokedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A connector lost its access.',
  },
  {
    type: 'connector.called',
    payloadVersion: 1,
    schema: ConnectorCalledPayloadSchema,
    maxSensitivity: 'internal',
    description: 'FRIDAY made a request to an outside service.',
  },
  {
    type: 'security.egress.blocked',
    payloadVersion: 1,
    schema: EgressBlockedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A connector tried to reach somewhere it had not declared, and was stopped.',
  },
  {
    type: 'connector.degraded',
    payloadVersion: 1,
    schema: ConnectorDegradedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A service stopped answering, so FRIDAY stopped calling it for a while.',
  },
  {
    type: 'connector.recovered',
    payloadVersion: 1,
    schema: ConnectorRecoveredPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A service started answering again.',
  },
]

/**
 * Registers the connector event types.
 *
 * @param registry - The registry to add them to.
 * @returns The same registry, for chaining.
 */
export function registerConnectorEventTypes(registry: EventRegistry): EventRegistry {
  for (const definition of CONNECTOR_EVENT_TYPES) registry.register(definition)
  return registry
}
