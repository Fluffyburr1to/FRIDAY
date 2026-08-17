/**
 * @friday/contracts — the public surface.
 *
 * This is the ONLY file other packages may import from. Everything else under
 * `src/` is private by convention and by dependency-cruiser rule, which is
 * what makes this package genuinely replaceable: consumers depend on a small
 * declared surface rather than on internal structure that shifts.
 *
 * `contracts` is the root of the dependency graph. It imports nothing internal,
 * ever. If it ever imports from FRIDAY, the architecture has inverted.
 *
 * See: README.md · docs/01-bible/09-database-design.md · Chapter 10 · Chapter 20
 */
// ── Identity ────────────────────────────────────────────────────────────────
export {
  ACTOR_TYPES,
  type Actor,
  ActorSchema,
  type ActorType,
  ActorTypeSchema,
  type Subject,
  SubjectSchema,
  SYSTEM_ACTOR,
} from './actor.js'
// ── Asking the owner ────────────────────────────────────────────────────────
export {
  APPROVAL_STATUSES,
  type ApprovalRequest,
  ApprovalRequestSchema,
  type ApprovalStatus,
  ApprovalStatusSchema,
  type Explanation,
  ExplanationSchema,
  type Impact,
  ImpactSchema,
  isTerminalApprovalStatus,
  PREVIEW_KINDS,
  type Preview,
  type PreviewKind,
  PreviewKindSchema,
  PreviewSchema,
  REQUIRED_AUTHS,
  RESPONSE_SURFACES,
  type RequiredAuth,
  RequiredAuthSchema,
  type ResponseSurface,
  ResponseSurfaceSchema,
  TERMINAL_APPROVAL_STATUSES,
} from './approval.js'
// ── Authorization: what a question is about ─────────────────────────────────
export {
  ACTION_PATTERN_REGEX,
  ACTION_REGEX,
  type Action,
  type ActionPattern,
  ActionPatternSchema,
  ActionSchema,
  isUnboundedScope,
  matchesAction,
  matchesResource,
  RESOURCE_PATTERN_REGEX,
  RESOURCE_REGEX,
  type Resource,
  type ResourcePattern,
  ResourcePatternSchema,
  ResourceSchema,
} from './authorization.js'
// ── Narrow, expiring permission ─────────────────────────────────────────────
export {
  CAPABILITY_TOKEN_PREFIX,
  CAPABILITY_TOKEN_REGEX,
  type Capability,
  type CapabilityConstraints,
  CapabilityConstraintsSchema,
  CapabilitySchema,
  type CapabilityToken,
  CapabilityTokenSchema,
  isCapabilityLive,
  MAX_CAPABILITY_LIFETIME_MS,
} from './capability.js'
// ── Authorization: the answer ───────────────────────────────────────────────
export {
  type AuthorizationRequest,
  AuthorizationRequestSchema,
  DECISION_REASONS,
  DECISIONS,
  type Decision,
  type DecisionReason,
  DecisionReasonSchema,
  DecisionSchema,
  type GuardianDecision,
  GuardianDecisionSchema,
  permits,
} from './decision.js'
// ── Outcomes and failures ───────────────────────────────────────────────────
export {
  ERROR_CODES,
  type ErrorCode,
  ErrorCodeSchema,
  type FridayError,
  FridayErrorSchema,
  fridayError,
} from './errors.js'
// ── The event log ───────────────────────────────────────────────────────────
export {
  EVENT_PATTERN_REGEX,
  EVENT_TYPE_PATTERN,
  type EventPattern,
  EventPatternSchema,
  EventSchema,
  type EventType,
  EventTypeSchema,
  type FridayEvent,
  matchesPattern,
  type NewEvent,
  NewEventSchema,
} from './event.js'
export {
  createEventRegistry,
  type EventRegistry,
  type EventTypeDefinition,
} from './event-registry.js'
export {
  ChainVerifiedPayloadSchema,
  CORE_EVENT_TYPES,
  registerCoreEventTypes,
  SystemDegradedPayloadSchema,
  SystemStartedPayloadSchema,
  SystemStoppedPayloadSchema,
  TestEventPayloadSchema,
} from './event-types.js'
// ── Permission given in advance ─────────────────────────────────────────────
export {
  GRANT_MAX_LIFETIME_MS,
  type GrantConstraints,
  GrantConstraintsSchema,
  isGrantableRiskClass,
  isGrantLive,
  type StandingGrant,
  StandingGrantSchema,
} from './grant.js'
export {
  ApprovalAutoGrantedPayloadSchema,
  ApprovalDeclinedPayloadSchema,
  ApprovalExpiredPayloadSchema,
  ApprovalGrantedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  CapabilityIssuedPayloadSchema,
  CapabilityRevokedPayloadSchema,
  CapabilityUsedPayloadSchema,
  GrantCreatedPayloadSchema,
  GrantEndedPayloadSchema,
  GUARDIAN_EVENT_TYPES,
  GuardianDecidedPayloadSchema,
  registerGuardianEventTypes,
} from './guardian-event-types.js'
export {
  type CausationId,
  CausationIdSchema,
  type CorrelationId,
  CorrelationIdSchema,
  type EventId,
  EventIdSchema,
  type PlanId,
  PlanIdSchema,
  type PlanStepId,
  PlanStepIdSchema,
  type PrincipalId,
  PrincipalIdSchema,
  timestampFromUuidv7,
  UuidSchema,
  uuidv7,
} from './ids.js'
// ── Work ────────────────────────────────────────────────────────────────────
export {
  isTerminalPlanStatus,
  PLAN_STATUSES,
  PLAN_STEP_STATUSES,
  type Plan,
  PlanSchema,
  type PlanStatus,
  PlanStatusSchema,
  type PlanStep,
  PlanStepSchema,
  type PlanStepStatus,
  PlanStepStatusSchema,
  RISK_CLASSES,
  type RiskClass,
  RiskClassSchema,
  TERMINAL_PLAN_STATUSES,
} from './plan.js'
export { type Err, err, isErr, isOk, type Ok, ok, type Result, unwrapOr } from './result.js'
// ── Classification ──────────────────────────────────────────────────────────
export {
  isAtLeastAsSensitiveAs,
  mayLeaveTheMachine,
  requiresFieldEncryption,
  SENSITIVITY_LEVELS,
  type Sensitivity,
  SensitivitySchema,
} from './sensitivity.js'
// ── What the runtime is doing ───────────────────────────────────────────────
export {
  type RuntimeVitals,
  RuntimeVitalsSchema,
  VITAL_IDS,
  type Vital,
  type VitalId,
  type VitalState,
} from './vitals.js'
