import type { FridayEvent } from '@friday/contracts'

/**
 * Reconstructing what caused what.
 *
 * Every event names the event that directly caused it (`causationId`) and the
 * root request it belongs to (`correlationId`). Together they form a tree, and
 * the tree is the only truthful answer to "why did you do that?" — Chapter 10's
 * argument, and the reason this package exists: models confabulate about their
 * own past behaviour fluently and falsely, so the record made at the time is
 * the only source worth reading.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

/** One event, and everything it caused. */
export interface CausalNode {
  readonly event: FridayEvent
  readonly children: readonly CausalNode[]

  /** How deep in the tree, from 0. Used for indentation, nothing else. */
  readonly depth: number
}

/** A whole operation, reconstructed. */
export interface CausalChain {
  readonly correlationId: string

  /** Events that caused everything else — usually one. */
  readonly roots: readonly CausalNode[]

  /** Every event, in the order it was recorded. */
  readonly events: readonly FridayEvent[]

  /**
   * ★ Events that could not be placed in the tree.
   *
   * An event naming a cause that is not in this set — because the cause
   * belongs to another operation, or was compacted away, or the log is
   * damaged — is reported rather than silently dropped or silently promoted to
   * a root. An explanation that quietly omitted part of what happened would be
   * the specific failure this package exists to prevent, and it would be
   * invisible.
   */
  readonly orphaned: readonly FridayEvent[]
}

/**
 * Builds the causal tree for one operation.
 *
 * @param correlationId - The root request these events belong to.
 * @param events - Every event carrying that correlation, in any order.
 * @returns The tree, plus anything that would not fit in it.
 */
export function buildCausalChain(
  correlationId: string,
  events: readonly FridayEvent[],
): CausalChain {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const byId = new Map(ordered.map((event) => [event.id, event]))

  const childrenOf = new Map<string, FridayEvent[]>()
  const rootEvents: FridayEvent[] = []
  const orphaned: FridayEvent[] = []

  for (const event of ordered) {
    // No stated cause means this event started something.
    if (event.causationId === undefined) {
      rootEvents.push(event)
      continue
    }

    // A stated cause that is not here. Reported, never guessed at.
    if (!byId.has(event.causationId)) {
      orphaned.push(event)
      continue
    }

    const siblings = childrenOf.get(event.causationId)
    if (siblings === undefined) childrenOf.set(event.causationId, [event])
    else siblings.push(event)
  }

  // Built by walking down from the roots rather than by recursing over the
  // parent map, so a damaged log containing a cycle cannot spin: an event in a
  // cycle is never reached from a root, and is reported as orphaned below.
  const placed = new Set<string>()

  const build = (event: FridayEvent, depth: number): CausalNode => {
    placed.add(event.id)

    const children = (childrenOf.get(event.id) ?? [])
      .filter((child) => !placed.has(child.id))
      .map((child) => build(child, depth + 1))

    return { event, children, depth }
  }

  const roots = rootEvents.map((event) => build(event, 0))

  for (const event of ordered) {
    if (!placed.has(event.id) && !orphaned.includes(event)) orphaned.push(event)
  }

  return { correlationId, roots, events: ordered, orphaned }
}

/**
 * Flattens a tree back into the order an explanation reads in.
 *
 * Depth-first, because that is how causation reads: a thing, then what it led
 * to, then the next thing. Sequence order would interleave concurrent branches
 * and make the account harder to follow than the events themselves.
 *
 * @param chain - The reconstructed operation.
 * @returns Every placed node, parents before children.
 */
export function flattenChain(chain: CausalChain): readonly CausalNode[] {
  const flat: CausalNode[] = []

  const walk = (node: CausalNode): void => {
    flat.push(node)
    for (const child of node.children) walk(child)
  }

  for (const root of chain.roots) walk(root)

  return flat
}
