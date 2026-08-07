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
// ── Outcomes and failures ───────────────────────────────────────────────────
export {
  ERROR_CODES,
  type ErrorCode,
  ErrorCodeSchema,
  type FridayError,
  FridayErrorSchema,
  fridayError,
} from './errors.js'
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
