import { z } from 'zod'

/**
 * What an evaluation scenario is.
 *
 * ★ Ordinary code is deterministic — same input, same output — so a test
 * asserts equality. **Agents are not.** The same request produces different
 * phrasing, different tool sequences, and occasionally different conclusions,
 * so `assert(output === expected)` is not merely inadequate here: it fails on
 * a perfectly good result and passes on a subtly bad one that happened to
 * match.
 *
 * Agents are therefore **graded**. But not all of it is a matter of taste,
 * and the split below is the whole design.
 *
 * Reference: tools/README.md · docs/01-bible/28-testing-strategy.md
 */

/**
 * ★ The three at the bottom are **safety** scenarios and are pass/fail.
 *
 * They are not graded on a curve because there is no partial credit for
 * *mostly* ignoring an injected instruction, or for staying inside a declared
 * capability *most* of the time. A scored safety property is a safety property
 * that can be averaged away by doing well elsewhere.
 */
export const SCENARIO_KINDS = [
  /** It does the ordinary thing well. Scored. */
  'happy_path',
  /** It **asks** rather than guessing. Scored, and checkable. */
  'ambiguous_input',
  /** It states uncertainty rather than inventing. Scored. */
  'missing_context',

  /** ★ It ignores instructions embedded in content. **Pass/fail.** */
  'prompt_injection',
  /** ★ It does not request tools outside its manifest. **Pass/fail.** */
  'capability_overreach',
  /** ★ It degrades cleanly rather than failing messily. **Pass/fail.** */
  'budget_pressure',
] as const

export const ScenarioKindSchema = z.enum(SCENARIO_KINDS)
export type ScenarioKind = z.infer<typeof ScenarioKindSchema>

const SAFETY_KINDS: readonly ScenarioKind[] = [
  'prompt_injection',
  'capability_overreach',
  'budget_pressure',
]

/**
 * Whether a scenario is pass/fail rather than scored.
 *
 * @param kind - The scenario kind.
 * @returns True when no partial credit exists.
 */
export function isSafetyScenario(kind: ScenarioKind): boolean {
  return SAFETY_KINDS.includes(kind)
}

export const ScenarioSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'scenario ids are kebab-case'),

  kind: ScenarioKindSchema,

  /** What this case establishes, in one line. */
  description: z.string().min(1).max(512),

  /** What the subject is given. */
  input: z.record(z.string(), z.unknown()),

  /**
   * What must be true of the run, whatever the wording.
   *
   * ★ Deterministic assertions carry 40% of the score deliberately: *"did it
   * ask instead of guessing about an ambiguous recipient"* is a **checkable
   * fact**, not a judgment call, and it is exactly the behaviour Principle 1
   * requires. Wherever a quality requirement can be expressed as one of these,
   * it is.
   */
  expect: z.object({
    /** The outcome the run must reach. */
    outcome: z.enum(['completed', 'suspended', 'failed', 'terminated']).optional(),

    /** Why it was stopped, when it should have been. */
    terminationReason: z.string().min(1).max(64).optional(),

    /** ★ It must have asked the owner rather than proceeding. */
    mustAsk: z.boolean().optional(),

    /** ★ It must never have reached the Guardian with these actions. */
    mustNotAttempt: z.array(z.string().min(1).max(128)).max(32).optional(),

    /** It must have stayed inside its ceilings. */
    withinBudget: z.boolean().optional(),

    /** Text the answer must not contain — the injected instruction's effect. */
    mustNotContain: z.array(z.string().min(1).max(256)).max(16).optional(),
  }),

  /** Prompts for the judge, when one is available. Never required. */
  rubric: z.array(z.string().min(1).max(512)).max(16).default([]),
})

/** One evaluation case. */
export type Scenario = z.infer<typeof ScenarioSchema>
