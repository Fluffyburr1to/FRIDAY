import type { z } from 'zod'
import { type ErrorCode, type FridayError, fridayError } from './errors.js'
import { EventTypeSchema } from './event.js'
import { err, ok, type Result } from './result.js'
import type { Sensitivity } from './sensitivity.js'

/**
 * The event type registry.
 *
 * Chapter 10, rule 4: every event type has a versioned Zod schema, and
 * publishing an unregistered or invalid event fails loudly at the source. The
 * reason is specific to how FRIDAY is built — AI assistants will add event
 * types, and a malformed event that is accepted quietly corrupts the log for
 * every future reader, including the one trying to explain what happened.
 *
 * A registry rather than a static map because departments, connectors, and
 * plugins register their own types as they load. It is deliberately the only
 * piece of behaviour in this package: the alternative is each of `kernel`,
 * `storage`, and `audit` keeping its own idea of what a valid event is.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

/** One registered version of one event type. */
export interface EventTypeDefinition {
  readonly type: string
  readonly payloadVersion: number

  /** Validates the payload. Zod's own type is used loosely — see `validate`. */
  readonly schema: z.ZodType

  /**
   * The highest sensitivity a payload of this type may carry. Publishing an
   * event that claims to be less sensitive than its type allows is accepted;
   * claiming *more* than the ceiling is not, because the ceiling is what the
   * dashboard and the model router were designed against.
   */
  readonly maxSensitivity: Sensitivity

  /** One line, plain language, for the audit explorer and the dashboard. */
  readonly description: string
}

/** A registry of event types. One per process; the kernel owns it. */
export interface EventRegistry {
  /**
   * Registers one version of one event type.
   *
   * @param definition - The type, its version, its payload schema, and its
   *   sensitivity ceiling.
   * @returns The registry, so registrations can be chained.
   * @throws If the same type and version is registered twice — a genuine bug,
   *   and one that would otherwise mean two components disagree about a shape.
   */
  register(definition: EventTypeDefinition): EventRegistry

  /** Whether any version of this type is registered. */
  has(type: string): boolean

  /** Every registered definition, for diagnostics and the CLI. */
  list(): readonly EventTypeDefinition[]

  /**
   * Validates a payload against the registered schema.
   *
   * @param input - The event type, the payload version (1 when omitted by the
   *   publisher), and the payload itself.
   * @returns The parsed payload, or a typed error naming what was wrong.
   */
  validate(input: {
    type: string
    payloadVersion: number
    payload: unknown
  }): Result<Record<string, unknown>, FridayError>
}

/**
 * Creates an empty event registry.
 *
 * @returns A registry with no types registered.
 */
export function createEventRegistry(): EventRegistry {
  const definitions = new Map<string, EventTypeDefinition>()

  const key = (type: string, version: number): string => `${type}@${version}`

  const registry: EventRegistry = {
    register(definition) {
      const parsedType = EventTypeSchema.safeParse(definition.type)
      if (!parsedType.success) {
        throw new TypeError(
          `event type "${definition.type}" is malformed: ` +
            'types are two or three lowercase dot-separated segments',
        )
      }

      const id = key(definition.type, definition.payloadVersion)
      if (definitions.has(id)) {
        throw new TypeError(`event type ${id} is already registered`)
      }

      definitions.set(id, definition)
      return registry
    },

    has(type) {
      for (const definition of definitions.values()) {
        if (definition.type === type) return true
      }
      return false
    },

    list() {
      return [...definitions.values()]
    },

    validate({ type, payloadVersion, payload }) {
      const definition = definitions.get(key(type, payloadVersion))
      if (definition === undefined) {
        return err(unregistered(type, payloadVersion, registry.has(type)))
      }

      const parsed = definition.schema.safeParse(payload)
      if (!parsed.success) {
        return err(
          fridayError({
            code: 'EVENT_PAYLOAD_INVALID',
            message: `The payload for ${type} did not match its registered shape.`,
            detail: { type, payloadVersion, issues: parsed.error.issues },
          }),
        )
      }

      return ok(parsed.data as Record<string, unknown>)
    },
  }

  return registry
}

/**
 * Builds the error for a type or version that is not registered.
 *
 * Split out so the two cases read distinctly: an unknown type is usually a
 * typo, and an unknown *version* of a known type is usually a missing
 * upcaster — a different problem with a different fix.
 */
function unregistered(type: string, payloadVersion: number, typeIsKnown: boolean): FridayError {
  const code: ErrorCode = 'EVENT_TYPE_UNREGISTERED'

  return typeIsKnown
    ? fridayError({
        code,
        message: `Version ${payloadVersion} of the event ${type} is not registered.`,
        detail: { type, payloadVersion, hint: 'an upcaster or a new version may be missing' },
      })
    : fridayError({
        code,
        message: `The event type ${type} is not registered.`,
        detail: { type, payloadVersion },
      })
}
