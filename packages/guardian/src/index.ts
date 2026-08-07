/**
 * @friday/guardian — the public surface.
 *
 * This is the ONLY file other packages may import from, and the restriction is
 * enforced by dependency-cruiser rather than by convention. It matters more
 * here than anywhere else in the repository: if another package could reach
 * `evaluate.ts` directly, it could evaluate policy without the capability and
 * risk layers that surround it, and the answer it got would look like a
 * Guardian decision without being one.
 *
 * Nothing exported here performs an action. The Guardian decides; the kernel
 * executes.
 *
 * See: README.md · docs/01-bible/17-authentication-authorization.md · Chapter 19
 */

export { type ApprovalStore, createInMemoryApprovalStore } from './approval-store.js'
export {
  type ApprovalRegistry,
  type ApprovalRequestInput,
  type ApprovalResponse,
  createApprovalRegistry,
  DEFAULT_APPROVAL_LIFETIME_MS,
  requiredAuthFor,
  STEP_UP_WINDOW_MS,
} from './approvals.js'
export {
  CAPABILITY_KEY_REFERENCE,
  type CapabilityIssuer,
  type CapabilityKeyProvider,
  type CapabilityPresentation,
  type CapabilityRejection,
  type CapabilityRequest,
  createCapabilityIssuer,
  DEFAULT_CAPABILITY_LIFETIME_MS,
} from './capabilities.js'
export { type CapabilityStore, createInMemoryCapabilityStore } from './capability-store.js'
export {
  type EvaluationContext,
  evaluatePolicies,
  type PolicyEvaluation,
} from './evaluate.js'
export { createInMemoryGrantStore, type GrantStore } from './grant-store.js'
export {
  createGrantRegistry,
  type GrantOutcome,
  type GrantQuery,
  type GrantRegistry,
  type NewGrant,
} from './grants.js'
export {
  POLICY_EFFECTS,
  type Policy,
  type PolicyCondition,
  PolicyConditionSchema,
  type PolicyEffect,
  PolicyEffectSchema,
  type PolicyExemption,
  PolicyExemptionSchema,
  PolicySchema,
  policyMatches,
} from './policy.js'
export { createPolicySet, loadPolicySet, type PolicySet } from './policy-set.js'
export { isAtLeastAsRiskyAs, RISK_RANK } from './risk.js'
