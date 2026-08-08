import type { EventRegistry, FridayEvent } from '@friday/contracts'
import { type CausalChain, flattenChain } from './chain.js'
import { phrasingFor, type Significance, significanceOf } from './phrasing.js'

/**
 * Composing an explanation.
 *
 * ★ **Every line carries the id of the event it came from.** That is the
 * invariant, and it is checkable: there is no way to add a sentence to an
 * explanation without naming the recorded fact behind it. An explanation that
 * cannot be traced back is a story, and Principle 7 asks for the other thing.
 *
 * Reference: packages/audit/README.md
 */

export const EXPLANATION_DEPTHS = ['summary', 'standard', 'full'] as const

export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number]

/** Which events each depth includes. */
const INCLUDED: Readonly<Record<ExplanationDepth, readonly Significance[]>> = {
  summary: ['headline'],
  standard: ['headline', 'spine'],
  full: ['headline', 'spine', 'detail'],
}

/** One claim, and the recorded fact behind it. */
export interface ExplanationLine {
  readonly text: string

  /** ★ The event this claim came from. Never absent. */
  readonly eventId: string

  readonly eventType: string
  readonly seq: number
  readonly occurredAt: number

  /** Depth in the causal tree, for indentation. */
  readonly depth: number
}

/** What happened, and why, at one level of detail. */
export interface CausalExplanation {
  readonly correlationId: string
  readonly depth: ExplanationDepth

  /** The first headline, or a plain statement that there is nothing to say. */
  readonly headline: string

  readonly lines: readonly ExplanationLine[]

  /**
   * ★ Events that are part of this operation but do not appear above.
   *
   * Either they sit below the requested depth, or nothing knows how to
   * describe them. Reported as counts rather than omitted silently, so
   * "is this the whole story?" has an answer.
   */
  readonly omitted: { readonly belowDepth: number; readonly unphrased: readonly string[] }

  /** Events that could not be placed in the causal tree at all. */
  readonly orphaned: readonly string[]
}

/**
 * Composes an explanation of one operation.
 *
 * @param chain - The reconstructed operation.
 * @param options - The depth, and the registry used to describe types nobody
 *   has phrased specifically.
 * @returns The explanation, every line traceable to an event.
 */
export function explain(
  chain: CausalChain,
  options: { depth: ExplanationDepth; registry?: EventRegistry | undefined },
): CausalExplanation {
  const included = INCLUDED[options.depth]
  const nodes = flattenChain(chain)

  const lines: ExplanationLine[] = []
  const unphrased = new Set<string>()
  let belowDepth = 0

  for (const node of nodes) {
    if (!included.includes(significanceOf(node.event.type))) {
      belowDepth += 1
      continue
    }

    const text = describe(node.event, options.registry)
    if (text === undefined) {
      // No phrasing and no registered description. Counted, never rendered as
      // a raw type name — the owner does not read code, and `plan.step.retried`
      // in a sentence is worse than an honest gap.
      unphrased.add(node.event.type)
      continue
    }

    lines.push({
      text,
      eventId: node.event.id,
      eventType: node.event.type,
      seq: node.event.seq,
      occurredAt: node.event.occurredAt,
      depth: node.depth,
    })
  }

  return {
    correlationId: chain.correlationId,
    depth: options.depth,
    headline: headlineOf(lines, chain),
    lines,
    omitted: { belowDepth, unphrased: [...unphrased].sort() },
    orphaned: chain.orphaned.map((event) => event.id),
  }
}

/**
 * The one sentence to show when there is only room for one.
 *
 * The last headline rather than the first: what an operation *ended up doing*
 * is what someone glancing at it needs, and the first line is usually only
 * that it began.
 */
function headlineOf(lines: readonly ExplanationLine[], chain: CausalChain): string {
  const headline = [...lines]
    .reverse()
    .find((line) => significanceOf(line.eventType) === 'headline')
  if (headline !== undefined) return headline.text

  const first = lines[0]
  if (first !== undefined) return first.text

  return chain.events.length === 0
    ? 'There is no record of this.'
    : 'FRIDAY recorded this, but nothing in it can be described yet.'
}

/**
 * One event as a sentence, from its phrasing or its registered description.
 *
 * The registry fallback is what makes a newly added event type readable the
 * day it is added: Chapter 10 already requires every type to carry a
 * plain-language description, so there is no reason to render a type name.
 */
function describe(event: FridayEvent, registry: EventRegistry | undefined): string | undefined {
  const phrased = phrasingFor(event.type)?.phrase(event)
  if (phrased !== undefined) return phrased

  const definition = registry?.list().find((entry) => entry.type === event.type)
  return definition?.description
}

/**
 * Checks that an explanation says nothing the record does not support.
 *
 * Exists to be run in tests and by anything that composes explanations from
 * more than one source later — including, eventually, a model asked to phrase
 * them more naturally. **The check is the thing that keeps that safe.**
 *
 * @param explanation - The composed explanation.
 * @param chain - The operation it claims to describe.
 * @returns Line texts with no supporting event. Empty means every claim holds.
 */
export function unsupportedClaims(
  explanation: CausalExplanation,
  chain: CausalChain,
): readonly string[] {
  const recorded = new Set(chain.events.map((event) => event.id))

  return explanation.lines.filter((line) => !recorded.has(line.eventId)).map((line) => line.text)
}
