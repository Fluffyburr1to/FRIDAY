import { z } from 'zod'

/**
 * Who did a thing, and whose data it concerns.
 *
 * Every event names both, and they are not the same question. The *actor* is
 * the thing that acted — you, an agent, the scheduler. The *principal* is the
 * person whose data is involved. Today they collapse into one person, but
 * separating them now is what lets "an agent acting on the owner's behalf" and
 * "the owner acting" be told apart in an audit trail years from now.
 *
 * Reference: docs/01-bible/09-database-design.md
 */
export const ACTOR_TYPES = ['user', 'agent', 'system', 'schedule'] as const

export const ActorTypeSchema = z.enum(ACTOR_TYPES)

/** The kind of thing that performed an action. */
export type ActorType = z.infer<typeof ActorTypeSchema>

export const ActorSchema = z.object({
  type: ActorTypeSchema,

  /**
   * Which one. `usr_tyler`, `agent:operations/backup`, `system:kernel`,
   * `schedule:nightly-verify`. Free-form by design — the set of agents and
   * schedules is open and grows without a migration.
   */
  id: z.string().min(1).max(256),
})

/** The thing that performed an action. */
export type Actor = z.infer<typeof ActorSchema>

export const SubjectSchema = z.object({
  /** What the action happened to: `plan`, `approval`, `memory`, `connector`. */
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
})

/** What an action happened to. */
export type Subject = z.infer<typeof SubjectSchema>

/** The system actor, used for events FRIDAY's own machinery emits. */
export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system:kernel' }
