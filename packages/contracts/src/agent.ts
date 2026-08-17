import { z } from 'zod'
import { ModelCapabilitySchema } from './model.js'
import { RiskClassSchema } from './plan.js'
import { SensitivitySchema } from './sensitivity.js'

/**
 * The agent manifest — **the security boundary, expressed as data.**
 *
 * ★ Chapter 11's central claim is that an agent *cannot do anything; it can
 * only ask*. This shape is what makes that enforceable rather than hoped for:
 * an agent's powers are exactly what its manifest declares, the runtime
 * refuses anything outside it before the Guardian is even consulted, and
 * adding a power is an edit to a reviewed file that shows up in a diff.
 *
 * The alternative — agents that decide their own limits — makes every safety
 * property in FRIDAY depend on every agent behaving correctly, including
 * agents written next year by an assistant and eventually by strangers. That
 * is not a guarantee, it is a wish.
 *
 * Reference: docs/01-bible/11-agent-framework.md · docs/adr/0007-no-agent-framework.md
 */

/**
 * ★ An exhaustive allowlist, never a starting point.
 *
 * An agent that did not declare a capability cannot use it, and the request is
 * refused by the runtime *before* the Guardian sees it. That ordering matters:
 * the Guardian answers "may this actor do this?" and the manifest answers "is
 * this agent even the kind of thing that does this?" — two different questions,
 * and the cheaper, more absolute one is asked first.
 */
export const AGENT_CAPABILITIES = [
  'memory.read',
  'memory.write',
  'model.invoke',
  'diagnostics.run',
  'events.read',
] as const

export const AgentCapabilitySchema = z.enum(AGENT_CAPABILITIES)
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>

/**
 * What one invocation may consume before it is stopped.
 *
 * ★ Exceeded means **terminated, not warned.** Chapter 11 is explicit, and the
 * reason is arithmetic rather than principle: a loop that is warned and
 * continues is a loop.
 */
export const AgentBudgetSchema = z.object({
  maxTokens: z.int().positive().max(1_000_000),
  maxCents: z.int().nonnegative().max(10_000),
  maxDurationMs: z.int().positive().max(600_000),

  /**
   * How many mediated tool calls one invocation may make.
   *
   * The bound on the leaf loop ADR-0011 permits. A bounded tool loop inside a
   * single step is borrowed from ReAct deliberately; this is what keeps it at
   * the leaf, where it is cheap and contained, rather than at the top where it
   * would be unobservable.
   */
  maxToolCalls: z.int().positive().max(100),
})

/** The ceilings for one agent invocation. */
export type AgentBudget = z.infer<typeof AgentBudgetSchema>

export const AgentModelSchema = z.object({
  /** What kind of thinking. Never a vendor, never a model name. */
  capability: ModelCapabilitySchema,

  /**
   * The ceiling on what this agent may hand to a model.
   *
   * Drives sensitivity routing: `private` forces a local provider, and the
   * router refuses rather than downgrading when none exists.
   */
  sensitivity: SensitivitySchema,
})

/** How an agent thinks, described without naming anyone. */
export type AgentModel = z.infer<typeof AgentModelSchema>

export const AgentManifestSchema = z.object({
  /** Stable, kebab-case, and recorded on every invocation. */
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'agent ids are kebab-case'),

  /** Which department employs it. An agent belongs to exactly one. */
  department: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'department ids are kebab-case'),

  /** One line, in the owner's language. Shown wherever this agent appears. */
  description: z.string().min(1).max(512),

  /** ★ Exhaustive. Anything absent is refused, not requested. */
  capabilities: z.array(AgentCapabilitySchema).max(16),

  /**
   * Which connectors it may reach. Empty means none, and none is the default.
   *
   * No connector exists until M6, so every manifest today declares `[]`. The
   * field is here now because the enforcement is easier to write against an
   * empty list than to retrofit around a populated one.
   */
  connectors: z.array(z.string().min(1).max(128)).max(16),

  /** Zod schema names in `packages/contracts`, validated at both boundaries. */
  input: z.string().min(1).max(128),
  output: z.string().min(1).max(128),

  budget: AgentBudgetSchema,
  model: AgentModelSchema,

  /**
   * ★ The ceiling on what this agent may even attempt.
   *
   * An agent that requests an action above its declared ceiling is
   * **terminated**, not merely denied. Requesting something outside its own
   * envelope means it is malfunctioning or has been manipulated, and the
   * correct response to either is to stop it and raise a diagnostic — not to
   * say no and let it try something else.
   */
  riskClasses: z.array(RiskClassSchema).min(1).max(5),
})

/** What an agent is allowed to be. */
export type AgentManifest = z.infer<typeof AgentManifestSchema>

/**
 * Whether a manifest permits a capability.
 *
 * @param manifest - The agent's declared powers.
 * @param capability - What it is trying to use.
 * @returns True only when the capability was declared.
 */
export function manifestAllows(manifest: AgentManifest, capability: string): boolean {
  return (manifest.capabilities as readonly string[]).includes(capability)
}

/**
 * Whether a manifest permits a connector.
 *
 * @param manifest - The agent's declared powers.
 * @param connector - The connector it is trying to reach.
 * @returns True only when the connector was declared.
 */
export function manifestAllowsConnector(manifest: AgentManifest, connector: string): boolean {
  return manifest.connectors.includes(connector)
}
