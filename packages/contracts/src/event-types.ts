import { z } from 'zod'
import type { EventRegistry, EventTypeDefinition } from './event-registry.js'

/**
 * The event types that exist at Milestone 1.
 *
 * Deliberately few. Every type here is one FRIDAY's own machinery emits about
 * itself — she can record, and she cannot act. Departments, the Guardian, and
 * the plan engine register their own types as they arrive.
 *
 * Each definition names its sensitivity ceiling. None of these carry personal
 * content, which is why they are all `internal`: useful to a debugger, of no
 * consequence if seen.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

export const SystemStartedPayloadSchema = z.object({
  version: z.string().min(1),
  nodeVersion: z.string().min(1),
  pid: z.int().positive(),
})

export const SystemStoppedPayloadSchema = z.object({
  reason: z.enum(['requested', 'signal', 'fatal']),
  uptimeMs: z.int().nonnegative(),
})

export const SystemDegradedPayloadSchema = z.object({
  component: z.string().min(1).max(128),

  /** Plain language, for the dashboard. Article II — the owner must see it. */
  reason: z.string().min(1).max(1024),
  recoverable: z.boolean(),
})

export const ChainVerifiedPayloadSchema = z.object({
  fromSeq: z.int().nonnegative(),
  toSeq: z.int().nonnegative(),
  eventsChecked: z.int().nonnegative(),
  intact: z.boolean(),

  /** The first sequence number where the chain broke, if it did. */
  brokenAtSeq: z.int().positive().nullable(),
})

export const TestEventPayloadSchema = z.object({
  note: z.string().max(1024),
})

/**
 * The M1 event types, in registration order.
 *
 * `test.event.emitted` is not scaffolding to be removed later. It is how the
 * milestone is demonstrated — `friday events emit` in one terminal, and
 * `friday events tail` showing it in another — and it stays as the cheapest
 * possible end-to-end check that the bus is alive.
 */
export const CORE_EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: 'system.started',
    payloadVersion: 1,
    schema: SystemStartedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'FRIDAY started up.',
  },
  {
    type: 'system.stopped',
    payloadVersion: 1,
    schema: SystemStoppedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'FRIDAY shut down.',
  },
  {
    type: 'system.degraded',
    payloadVersion: 1,
    schema: SystemDegradedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'Part of FRIDAY stopped working; the rest continued.',
  },
  {
    type: 'diagnostics.chain.verified',
    payloadVersion: 1,
    schema: ChainVerifiedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'The audit log’s integrity chain was checked end to end.',
  },
  {
    type: 'test.event.emitted',
    payloadVersion: 1,
    schema: TestEventPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A test event, emitted by hand to prove the bus is alive.',
  },
]

/**
 * Registers every core event type.
 *
 * @param registry - The registry to populate, usually the kernel's.
 * @returns The same registry, so the call can be chained.
 */
export function registerCoreEventTypes(registry: EventRegistry): EventRegistry {
  for (const definition of CORE_EVENT_TYPES) {
    registry.register(definition)
  }
  return registry
}
