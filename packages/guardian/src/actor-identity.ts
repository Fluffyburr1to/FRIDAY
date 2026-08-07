import type { Actor } from '@friday/contracts'

/**
 * Layer 1 of Chapter 17's evaluation: who is asking?
 *
 * **This is a structural check, not a registry.** It verifies that an actor's
 * identifier follows the naming rule Chapter 17 lays down for its kind, which
 * catches the realistic M2 failure — an agent, a schedule, or a caller
 * inventing an identity string that nothing would recognise later in the audit
 * trail. It does not verify that the named agent exists, because at M2 nothing
 * registers agents; that arrives with the agent runtime at M3, and this
 * function is where it plugs in.
 *
 * Recorded here so the gap is visible rather than discovered: today,
 * `agent:communications/nonexistent` passes this check. What it cannot do is
 * pass with no department, or as a bare name, or wearing another kind's
 * prefix.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md
 */

/** `usr_tyler` — the owner, or another principal once family is added. */
const USER = /^usr_[a-z0-9][a-z0-9_-]*$/

/** `agent:<department>/<agent-id>` — never bare, always inside a department. */
const AGENT = /^agent:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

/** `system:<component>` — the kernel and its machinery. */
const SYSTEM = /^system:[a-z][a-z0-9-]*$/

/** `schedule:<id>` — a job running under the identity that created it. */
const SCHEDULE = /^schedule:[a-z][a-z0-9-]*$/

const SHAPES: Readonly<Record<Actor['type'], RegExp>> = {
  user: USER,
  agent: AGENT,
  system: SYSTEM,
  schedule: SCHEDULE,
}

/**
 * Whether an actor names itself in a form the audit trail can rely on.
 *
 * @param actor - The actor making the request.
 * @returns True when the identifier matches the shape for its kind.
 */
export function isRecognisableActor(actor: Actor): boolean {
  return SHAPES[actor.type].test(actor.id)
}

/**
 * Whether this kind of actor must present a capability to act.
 *
 * Agents must, always. An agent acts because a plan step required it, and the
 * capability is the evidence of which step — without one there is nothing
 * tying the action to work the owner asked for, which is exactly the state a
 * manipulated agent would be in.
 *
 * The owner, the kernel, and schedules act on their own standing and hold no
 * per-step ticket. For the owner that is the whole point: Article III governs
 * what FRIDAY does unattended.
 *
 * @param actor - The actor making the request.
 * @returns True when a capability is required.
 */
export function requiresCapability(actor: Actor): boolean {
  return actor.type === 'agent'
}
