import { z } from 'zod'

/**
 * What an authorization question is *about*: one action, on one resource.
 *
 * Every capability, every policy rule, and every standing grant is written in
 * these two vocabularies, so they are defined once here rather than as regexes
 * copied into three packages that will drift apart.
 *
 * The distinction that matters throughout: an **action** and a **resource** are
 * concrete — `calendar.event.create`, `memory:contacts/sarah-chen`. A
 * **pattern** may contain wildcards and appears only in rules and grants, never
 * in a request. A capability names a concrete pair, deliberately: Chapter 17's
 * whole argument for capabilities is that a captured agent cannot exceed what
 * its step required, and a wildcard capability would hand back exactly the
 * ambient authority the design exists to remove.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · Chapter 19
 */

/** One dotted segment of an action name: lowercase, digits, inner hyphens. */
const ACTION_SEGMENT = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*'

/**
 * `<domain>.<subject>[.<subject>].<verb>` — two to four segments.
 *
 * The Bible's examples span the range: `memory.read` has two,
 * `calendar.event.create` has three, and connector actions such as
 * `connector.gmail.message.send` have four. Bounding it at four keeps a typo
 * from being accepted as a novel action name — under ADR-0025 that would be
 * denied rather than mis-permitted, but a denial nobody can explain is still a
 * bad afternoon.
 */
export const ACTION_REGEX = new RegExp(`^${ACTION_SEGMENT}(?:\\.${ACTION_SEGMENT}){1,3}$`)

const ACTION_PATTERN_SEGMENT = `(?:\\*|${ACTION_SEGMENT})`

/**
 * An action name with `*` permitted in place of any whole segment, or `*`
 * alone.
 *
 * `connector.*.write` is Chapter 17's own example, so the wildcard is not
 * restricted to the final segment the way event subscription patterns are.
 */
export const ACTION_PATTERN_REGEX = new RegExp(
  `^(?:\\*|${ACTION_PATTERN_SEGMENT}(?:\\.${ACTION_PATTERN_SEGMENT}){1,3})$`,
)

const RESOURCE_SCHEME = '[a-z][a-z0-9]*'

/**
 * One path segment of a resource.
 *
 * Deliberately permissive about content — a resource segment is frequently an
 * identifier FRIDAY did not choose, such as a message ID or an address — and
 * deliberately strict about three characters. `/` is the separator, whitespace
 * would make a resource unquotable in an explanation, and `*` is excluded so
 * that no concrete resource can ever smuggle a wildcard past a matcher.
 */
const RESOURCE_SEGMENT = '[^/\\s*]+'

/** `<scheme>:<path>` — `memory:contacts/sarah-chen`, `calendar:personal`. */
export const RESOURCE_REGEX = new RegExp(
  `^${RESOURCE_SCHEME}:${RESOURCE_SEGMENT}(?:/${RESOURCE_SEGMENT})*$`,
)

const RESOURCE_PATTERN_SEGMENT = `(?:\\*|${RESOURCE_SEGMENT})`

/**
 * A resource with wildcards: `*` for exactly one segment, `**` as the final
 * segment for one or more, or `*` alone for any resource at all.
 *
 * Two levels rather than one because `memory:contacts/*` and
 * `memory:contacts/**` mean genuinely different things to someone granting
 * permission — one flat namespace versus an entire subtree — and a system that
 * cannot express the narrower of the two will get the broader one written by
 * default.
 */
export const RESOURCE_PATTERN_REGEX = new RegExp(
  `^(?:\\*|${RESOURCE_SCHEME}:(?:\\*\\*|${RESOURCE_PATTERN_SEGMENT}(?:/${RESOURCE_PATTERN_SEGMENT})*(?:/\\*\\*)?))$`,
)

export const ActionSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(ACTION_REGEX, 'actions are two to four lowercase dot-separated segments')

/** A concrete thing FRIDAY might do, e.g. `calendar.event.create`. */
export type Action = z.infer<typeof ActionSchema>

export const ActionPatternSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(ACTION_PATTERN_REGEX, 'action patterns are an action, or one with * for whole segments')

/** An action name that a rule or grant matches against. */
export type ActionPattern = z.infer<typeof ActionPatternSchema>

export const ResourceSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(RESOURCE_REGEX, 'resources are <scheme>:<path>, e.g. memory:contacts/sarah-chen')

/** A concrete thing an action happens to. */
export type Resource = z.infer<typeof ResourceSchema>

export const ResourcePatternSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(RESOURCE_PATTERN_REGEX, 'resource patterns allow * for one segment and ** for a subtree')

/** A resource that a rule or grant matches against. */
export type ResourcePattern = z.infer<typeof ResourcePatternSchema>

/**
 * Tests a concrete action against an action pattern.
 *
 * Matching is per segment and never partial: `connector.*` does not match
 * `connector.gmail.write`, because a wildcard stands for one segment rather
 * than "the rest". Someone who means the rest writes `connector.*.*`, and
 * having to write it is the point — the broader grant should be the one that
 * takes more deliberate typing.
 *
 * @param pattern - An action pattern, such as `connector.*.write` or `*`.
 * @param action - The concrete action being requested.
 * @returns True when the pattern covers the action.
 */
export function matchesAction(pattern: string, action: string): boolean {
  if (pattern === '*') return true
  if (pattern === action) return true

  const patternSegments = pattern.split('.')
  const actionSegments = action.split('.')
  if (patternSegments.length !== actionSegments.length) return false

  return patternSegments.every(
    (segment, index) => segment === '*' || segment === actionSegments[index],
  )
}

/**
 * Tests a concrete resource against a resource pattern.
 *
 * Schemes must match exactly — `memory:*` never covers `calendar:personal`.
 * A resource is only ever as wide as its own namespace, so a grant written for
 * one connector cannot silently reach another.
 *
 * @param pattern - A resource pattern, such as `memory:contacts/**` or `*`.
 * @param resource - The concrete resource being acted on.
 * @returns True when the pattern covers the resource.
 */
export function matchesResource(pattern: string, resource: string): boolean {
  if (pattern === '*') return true
  if (pattern === resource) return true

  const patternColon = pattern.indexOf(':')
  const resourceColon = resource.indexOf(':')
  if (patternColon === -1 || resourceColon === -1) return false
  if (pattern.slice(0, patternColon) !== resource.slice(0, resourceColon)) return false

  const patternSegments = pattern.slice(patternColon + 1).split('/')
  const resourceSegments = resource.slice(resourceColon + 1).split('/')

  for (const [index, segment] of patternSegments.entries()) {
    // `**` covers one or more remaining segments, never zero. `contacts/**` is
    // a statement about what is inside `contacts`, and reading it as also
    // covering `contacts` itself would widen every subtree grant by one node.
    if (segment === '**') return resourceSegments.length > index
    if (index >= resourceSegments.length) return false
    if (segment !== '*' && segment !== resourceSegments[index]) return false
  }

  return patternSegments.length === resourceSegments.length
}

/**
 * Whether a pattern pair is wide enough to be an abdication rather than a
 * grant.
 *
 * Chapter 19's second rule for standing grants: `*` on both the action and the
 * resource is rejected, because "FRIDAY can do anything" is not a permission
 * the owner can meaningfully have decided to give.
 *
 * @param actionPattern - The action side of the pair.
 * @param resourcePattern - The resource side of the pair.
 * @returns True when both sides are unrestricted.
 */
export function isUnboundedScope(actionPattern: string, resourcePattern: string): boolean {
  return actionPattern === '*' && resourcePattern === '*'
}
