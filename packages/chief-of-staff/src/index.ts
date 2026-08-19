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
  MAX_DEPTH,
  MAX_STEPS,
  type ProposedStep,
  readySteps,
  validatePlan,
} from './validate.js'
