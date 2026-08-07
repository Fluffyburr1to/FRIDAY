import { z } from 'zod'
import { ActorSchema } from './actor.js'
import { ResponseSurfaceSchema } from './approval.js'
import { ActionSchema, ResourceSchema } from './authorization.js'
import { DecisionReasonSchema, DecisionSchema } from './decision.js'
import type { EventRegistry, EventTypeDefinition } from './event-registry.js'
import { UuidSchema } from './ids.js'
import { RiskClassSchema } from './plan.js'

/**
 * The event types Milestone 2 adds: everything the Guardian does.
 *
 * These exist so that Article II holds for authorization specifically. A
 * decision that is not an event is a decision the owner cannot see, cannot
 * search, and cannot have explained back to them — and authorization is the
 * one subsystem where "trust me, it was checked" is worth nothing.
 *
 * Sensitivity is `internal` for decisions and `private` for anything naming a
 * resource the owner cares about. The rule applied throughout: a *decision* is
 * metadata, but the *thing decided about* frequently is not. `memory:contacts/
 * sarah-chen` in a payload is a fact about the owner's life, so any type that
 * carries a concrete resource is classified `private` and therefore encrypted
 * at rest and ineligible to leave the machine.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · Chapter 19
 */

const TimestampSchema = z.int().nonnegative()

export const GuardianDecidedPayloadSchema = z.object({
  decisionId: UuidSchema,
  decision: DecisionSchema,
  reason: DecisionReasonSchema,
  riskClass: RiskClassSchema,
  action: ActionSchema,
  resource: ResourceSchema,
  actor: ActorSchema,
  matchedPolicies: z.array(z.string().min(1).max(128)).max(64),
  approvalId: UuidSchema.nullable(),
  standingGrantId: UuidSchema.nullable(),
  summary: z.string().min(1).max(1024),
})

export const CapabilityIssuedPayloadSchema = z.object({
  capabilityId: UuidSchema,
  issuedTo: ActorSchema,
  action: ActionSchema,
  resource: ResourceSchema,
  expiresAt: TimestampSchema,
  maxCalls: z.int().positive().nullable(),
})

export const CapabilityUsedPayloadSchema = z.object({
  capabilityId: UuidSchema,
  action: ActionSchema,
  resource: ResourceSchema,

  /** How many uses are left after this one. Zero means it is now spent. */
  usesRemaining: z.int().nonnegative().nullable(),
})

export const CapabilityRevokedPayloadSchema = z.object({
  capabilityId: UuidSchema,
  reason: z.string().min(1).max(512),

  /** True when the revocation came from a sweep rather than a decision. */
  automatic: z.boolean(),
})

export const ApprovalRequestedPayloadSchema = z.object({
  approvalId: UuidSchema,
  decisionId: UuidSchema,
  title: z.string().min(1).max(256),
  riskClass: RiskClassSchema,
  action: ActionSchema,
  resource: ResourceSchema,
  expiresAt: TimestampSchema,
  requiredAuth: z.enum(['none', 'biometric', 'passkey']),
})

const ApprovalResolvedPayloadSchema = z.object({
  approvalId: UuidSchema,
  action: ActionSchema,
  resource: ResourceSchema,

  /** Null for `expired`, which nobody answered. */
  respondedVia: ResponseSurfaceSchema.nullable(),
  reason: z.string().max(2048).nullable(),

  /** How long the owner took. The rubber-stamp metric from Chapter 19. */
  timeToDecisionMs: z.int().nonnegative(),
})

export const ApprovalGrantedPayloadSchema = ApprovalResolvedPayloadSchema
export const ApprovalDeclinedPayloadSchema = ApprovalResolvedPayloadSchema
export const ApprovalExpiredPayloadSchema = ApprovalResolvedPayloadSchema

export const ApprovalAutoGrantedPayloadSchema = z.object({
  decisionId: UuidSchema,
  grantId: UuidSchema,
  action: ActionSchema,
  resource: ResourceSchema,
  riskClass: RiskClassSchema,

  /** The owner's own words for why they granted it, shown back to them. */
  grantReason: z.string().min(1).max(1024),

  /** How many times this grant has now been used, and its ceiling. */
  grantUses: z.int().positive(),
  grantMaxUses: z.int().positive().nullable(),
})

export const GrantCreatedPayloadSchema = z.object({
  grantId: UuidSchema,
  actionPattern: z.string().min(1).max(128),
  resourcePattern: z.string().min(1).max(512),
  riskClass: RiskClassSchema,
  negative: z.boolean(),
  expiresAt: TimestampSchema,
  reason: z.string().min(1).max(1024),
})

export const GrantEndedPayloadSchema = z.object({
  grantId: UuidSchema,
  actionPattern: z.string().min(1).max(128),
  resourcePattern: z.string().min(1).max(512),

  /** Total uses over the grant's life — the data Chapter 19's review needs. */
  uses: z.int().nonnegative(),
  reason: z.string().min(1).max(512),
})

/**
 * The Guardian's event types.
 *
 * `approval.auto_granted` carries the name Chapter 19 gives it. It is the most
 * important type in this list and the easiest to leave out: a pre-approved
 * action is still an action, and a standing grant that applied silently would
 * turn Article II off for precisely the actions the owner stopped watching.
 */
export const GUARDIAN_EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: 'guardian.decided',
    payloadVersion: 1,
    schema: GuardianDecidedPayloadSchema,
    maxSensitivity: 'private',
    description: 'The Guardian decided whether an action was permitted.',
  },
  {
    type: 'capability.issued',
    payloadVersion: 1,
    schema: CapabilityIssuedPayloadSchema,
    maxSensitivity: 'private',
    description: 'A narrow, expiring permission was issued for one step.',
  },
  {
    type: 'capability.used',
    payloadVersion: 1,
    schema: CapabilityUsedPayloadSchema,
    maxSensitivity: 'private',
    description: 'A permission was spent.',
  },
  {
    type: 'capability.revoked',
    payloadVersion: 1,
    schema: CapabilityRevokedPayloadSchema,
    maxSensitivity: 'internal',
    description: 'A permission was withdrawn before it expired.',
  },
  {
    type: 'approval.requested',
    payloadVersion: 1,
    schema: ApprovalRequestedPayloadSchema,
    maxSensitivity: 'private',
    description: 'FRIDAY asked before doing something.',
  },
  {
    type: 'approval.granted',
    payloadVersion: 1,
    schema: ApprovalGrantedPayloadSchema,
    maxSensitivity: 'private',
    description: 'You said yes.',
  },
  {
    type: 'approval.declined',
    payloadVersion: 1,
    schema: ApprovalDeclinedPayloadSchema,
    maxSensitivity: 'private',
    description: 'You said no.',
  },
  {
    type: 'approval.expired',
    payloadVersion: 1,
    schema: ApprovalExpiredPayloadSchema,
    maxSensitivity: 'private',
    description: 'Nobody answered in time, so FRIDAY did not act.',
  },
  {
    type: 'approval.auto_granted',
    payloadVersion: 1,
    schema: ApprovalAutoGrantedPayloadSchema,
    maxSensitivity: 'private',
    description: 'A permission you gave in advance covered this, so you were not asked.',
  },
  {
    type: 'grant.created',
    payloadVersion: 1,
    schema: GrantCreatedPayloadSchema,
    maxSensitivity: 'private',
    description: 'You gave FRIDAY standing permission, with an end date.',
  },
  {
    type: 'grant.revoked',
    payloadVersion: 1,
    schema: GrantEndedPayloadSchema,
    maxSensitivity: 'private',
    description: 'You withdrew a standing permission.',
  },
  {
    type: 'grant.expired',
    payloadVersion: 1,
    schema: GrantEndedPayloadSchema,
    maxSensitivity: 'private',
    description: 'A standing permission reached its end date and lapsed.',
  },
]

/**
 * Registers every Guardian event type.
 *
 * @param registry - The registry to populate, usually the kernel's.
 * @returns The same registry, so the call can be chained.
 */
export function registerGuardianEventTypes(registry: EventRegistry): EventRegistry {
  for (const definition of GUARDIAN_EVENT_TYPES) {
    registry.register(definition)
  }
  return registry
}
