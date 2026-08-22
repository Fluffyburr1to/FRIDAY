/**
 * @friday/evals — the agent evaluation harness.
 *
 * ★ **None of this ships.** No runtime code imports from here; it exists to
 * answer the one question a normal test suite cannot: *did this change to a
 * prompt make FRIDAY better or worse?*
 *
 * See: README.md · tools/README.md
 */

export {
  checkExpectations,
  type EvaluateOptions,
  evaluate,
  type Judge,
  RUNS_PER_SCENARIO,
  type RunObservation,
  type ScenarioResult,
  type Subject,
  suitePasses,
  WEIGHTS,
} from './harness.js'
export {
  isSafetyScenario,
  SCENARIO_KINDS,
  type Scenario,
  type ScenarioKind,
  ScenarioKindSchema,
  ScenarioSchema,
} from './scenario.js'
