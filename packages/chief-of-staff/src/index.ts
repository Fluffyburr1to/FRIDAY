/**
 * @friday/chief-of-staff — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ★ The central design decision, from Chapter 12: **this is not an AI agent
 * that runs continuously. It is a state machine that uses AI for one step.**
 * The model makes the plan; ordinary deterministic code executes it. That is
 * what makes a plan inspectable before it runs, pausable for days, and
 * explainable afterwards.
 *
 * ★ It is **not an authority.** Risk is assigned by the Guardian and
 * permission is decided by the Guardian, per step, at the moment it runs.
 * Nothing here may become a second path to acting.
 *
 * See: README.md · docs/01-bible/12-chief-of-staff.md
 */

export {
  type AuthorisationOutcome,
  type Authorised,
  type Authorize,
  advance,
  createExecutor,
  type ExecutableStep,
  type Executor,
  type ExecutorOptions,
  type PerformCapability,
} from './executor.js'
export {
  type ComposeOptions,
  composeExplanation,
  type PlanExplanation,
  storedExplanationIsCurrent,
} from './explanation.js'
export {
  approvePlan,
  approveStep,
  beginning,
  type PlanProgress,
  type RunOutcome,
  type RunPlanOptions,
  runPlan,
} from './kernel.js'
export {
  nextStatus,
  nextStepStatus,
  PLAN_APPROVAL_REASONS,
  type PlanApprovalCheck,
  type PlanApprovalReason,
  type PlanEvent,
  planApprovalReason,
} from './machine.js'
export { loadDepartments } from './manifests.js'
export {
  fromStored,
  type StoredProgress,
  toStored,
} from './persistence.js'
export {
  type GeneratePlanOptions,
  generatePlan,
  type Invoke,
  type ParseIntentOptions,
  type ProposedPlan,
  parseIntent,
} from './planning.js'
export {
  INTENT_PROMPT_VERSION,
  PLAN_PROMPT_VERSION,
} from './prompts/index.js'
export {
  type CapabilityRegistry,
  createCapabilityRegistry,
  type RoutableStep,
  type Route,
  routePlan,
} from './routing.js'
export {
  type EventContext,
  eventsFor,
  type Move,
  type PlanTransition,
  type RecordTransition,
  type StepMove,
  type TransitionDetail,
} from './transitions.js'
export {
  MAX_DEPTH,
  MAX_STEPS,
  type ProposedStep,
  readySteps,
  validatePlan,
} from './validate.js'
