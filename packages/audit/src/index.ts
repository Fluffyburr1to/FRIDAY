import type { FridayError, FridayEvent, Result } from '@friday/contracts'
import { buildCausalChain, type CausalChain } from './chain.js'
import { type CausalExplanation, type ExplanationDepth, explain } from './explain.js'

/**
 * @friday/audit — the public surface.
 *
 * Answers "why did you do that?" from recorded fact, and from nothing else.
 * Every claim it makes carries the id of the event behind it.
 *
 * This package reads. It never writes an event, and it never infers anything
 * a recorded event does not say.
 *
 * See: README.md · docs/01-bible/10-event-bus.md
 */
export { buildCausalChain, type CausalChain, type CausalNode, flattenChain } from './chain.js'
export {
  type CausalExplanation,
  EXPLANATION_DEPTHS,
  type ExplanationDepth,
  type ExplanationLine,
  explain,
  unsupportedClaims,
} from './explain.js'
export {
  PHRASED_TYPES,
  type Phrasing,
  phrasingFor,
  SIGNIFICANCE,
  type Significance,
  significanceOf,
} from './phrasing.js'

/**
 * Where the events come from.
 *
 * A port rather than the storage package, for the reason every port in this
 * repository exists: `packages/storage` owns the database, and this package
 * owns none of it. `EventStore` satisfies this shape as it stands.
 */
export interface EventSource {
  readByCorrelation(input: {
    correlationId: string
    principalId?: string | undefined
  }): Result<FridayEvent[], FridayError>
}

/** Reads the log and explains what it finds. */
export interface Auditor {
  /**
   * Rebuilds one operation from the log.
   *
   * @param input - The root request, and whose data it concerns.
   * @returns The causal tree, or why the log could not be read.
   */
  reconstruct(input: {
    correlationId: string
    principalId?: string | undefined
  }): Result<CausalChain, FridayError>

  /**
   * Answers "why did you do that?" for one operation.
   *
   * @param input - The root request, the depth, and whose data it concerns.
   * @returns The explanation, or why the log could not be read.
   */
  why(input: {
    correlationId: string
    depth?: ExplanationDepth | undefined
    principalId?: string | undefined
  }): Result<CausalExplanation, FridayError>
}

/**
 * Builds an auditor.
 *
 * @param options - The event source, and the registry used to describe event
 *   types nobody has phrased specifically.
 * @returns The auditor.
 */
export function createAuditor(options: {
  events: EventSource
  registry?: Parameters<typeof explain>[1]['registry']
}): Auditor {
  const reconstruct: Auditor['reconstruct'] = ({ correlationId, principalId }) => {
    const read = options.events.readByCorrelation({ correlationId, principalId })
    if (!read.ok) return read

    return { ok: true, value: buildCausalChain(correlationId, read.value) }
  }

  return {
    reconstruct,

    why({ correlationId, depth, principalId }) {
      const chain = reconstruct({ correlationId, principalId })
      if (!chain.ok) return chain

      return {
        ok: true,
        value: explain(chain.value, {
          depth: depth ?? 'standard',
          registry: options.registry,
        }),
      }
    },
  }
}
