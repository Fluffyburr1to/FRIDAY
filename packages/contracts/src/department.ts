import { z } from 'zod'
import { AgentCapabilitySchema } from './agent.js'
import { ActionSchema } from './authorization.js'
import { RiskClassSchema } from './plan.js'
import { SensitivitySchema } from './sensitivity.js'

/**
 * The department manifest — a department's contract with the kernel.
 *
 * Per [Chapter 13](../../../docs/01-bible/13-department-architecture.md), a
 * department declares its capabilities and the kernel validates them at load.
 * `capabilities` is the department's **public API**: it is what the Chief of
 * Staff searches when routing a step, and everything else in the department is
 * private. That is what allows a department to be rewritten entirely as long
 * as its capabilities keep their contracts.
 *
 * ★ **`action` is added here, and it is the one field Chapter 13's example
 * does not show.** Without it there is no deterministic mapping from a step to
 * a capability, and [ADR-0040](../../../docs/adr/0040-a-capability-is-a-department-inside-the-guardian-boundary.md)
 * §3 requires exactly that: *"deterministic code maps that plan onto
 * capabilities"*, so that the audit answer to "why did FRIDAY do that?" is
 * never "the model chose to". The alternative — deriving the action from the
 * capability id by convention — would make routing depend on a naming rule
 * nothing enforces.
 *
 * Reference: docs/01-bible/13-department-architecture.md · ADR-0010 · ADR-0040
 */

export const DepartmentCapabilitySchema = z.object({
  /** Stable, kebab-case, and quoted whenever FRIDAY explains what she did. */
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'capability ids are kebab-case'),

  /**
   * ★ The action this capability performs.
   *
   * The routing key, and the same string the Guardian classifies. One action,
   * one capability — see `createCapabilityRegistry`, which refuses a
   * department set where two capabilities claim the same action, because a
   * router that had to choose would not be deterministic.
   */
  action: ActionSchema,

  /** The routing surface. What this does, in the owner's language. */
  description: z.string().min(1).max(512),

  /** Zod schema names in `packages/contracts`. Validated at both boundaries. */
  input: z.string().min(1).max(128),
  output: z.string().min(1).max(128),

  /**
   * What the department expects this to be classified as.
   *
   * ★ **Declaratory, never authoritative.** Risk is assigned by the Guardian
   * from the owner's policy table, at the moment the step runs. This is here
   * because Chapter 13 puts it here and because it is useful to a reader — it
   * must never be consulted to decide whether something is permitted, and
   * nothing in `chief-of-staff` reads it for that purpose. If it and the
   * Guardian ever disagree, **the Guardian is right** and this is a
   * documentation bug in the department.
   */
  riskClass: RiskClassSchema,

  /**
   * Whether the effect cannot be undone.
   *
   * A user-safety flag rather than metadata: it flows into the approval screen
   * as the "cannot be undone" line, which is the single most decision-relevant
   * fact when approving something on a phone in ten seconds.
   */
  irreversible: z.boolean().default(false),

  /** The ceiling on what this capability may handle. Drives model routing. */
  sensitivity: SensitivitySchema,

  /** Capability tokens it needs. Anything not declared is refused. */
  requires: z.array(AgentCapabilitySchema).max(16),
})

/** One thing a department can be asked to do. */
export type DepartmentCapability = z.infer<typeof DepartmentCapabilitySchema>

export const DepartmentManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'department ids are kebab-case'),

  name: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  description: z.string().min(1).max(512),

  /** The public API. Everything else in the department is private. */
  capabilities: z.array(DepartmentCapabilitySchema).min(1).max(32),

  /** Declared, not discovered. Undeclared use is rejected at runtime. */
  subscribes: z.array(z.string().min(1).max(128)).max(64),
  publishes: z.array(z.string().min(1).max(128)).max(64),

  /**
   * Required. Chapter 13: *"What can this department still do when its
   * dependencies are down?"* — Article VII answered at design time rather than
   * during an incident.
   */
  degradedMode: z.object({
    whenConnectorUnavailable: z.string().min(1).max(128),
    description: z.string().min(1).max(512),
  }),
})

/** What a department promises the kernel. */
export type DepartmentManifest = z.infer<typeof DepartmentManifestSchema>
