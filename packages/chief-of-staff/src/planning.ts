import {
  err,
  type FridayError,
  fridayError,
  type Intent,
  IntentSchema,
  type ModelRequest,
  type ModelResponse,
  ok,
  type Result,
  StepFailureActionSchema,
  uuidv7,
} from '@friday/contracts'
import { z } from 'zod'
import {
  INTENT_PROMPT_VERSION,
  intentPrompt,
  PLAN_PROMPT_VERSION,
  planPrompt,
} from './prompts/index.js'
import type { CapabilityRegistry } from './routing.js'
import { MAX_DEPTH, MAX_STEPS, type ProposedStep, validatePlan } from './validate.js'

/**
 * The two bounded AI operations, and nothing else in this package is one.
 *
 * ★ [ADR-0011](../../../docs/adr/0011-plan-engine-state-machine.md): planning
 * is a bounded AI operation producing a **validated data structure**;
 * execution is a deterministic state machine over that structure. Both calls
 * here are single, tool-less, and schema-validated. Neither can act.
 *
 * ★ **Risk is never asked for.** The planner proposes an action; the Guardian
 * classifies it from the owner's policy table at the moment it runs. The
 * prompt says so, and the schema has nowhere to put a risk class even if a
 * model volunteered one — which is the version of that rule that survives a
 * model deciding to be helpful.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · Chapter 11
 */

/** Asks a model. Injected so this package names no vendor and no router. */
export type Invoke = (request: ModelRequest) => Promise<Result<ModelResponse, FridayError>>

export interface ParseIntentOptions {
  readonly utterance: string
  readonly registry: CapabilityRegistry
  readonly invoke: Invoke

  /** Ceilings for the one call. Bounded, per ADR-0011. */
  readonly maxTokens?: number
  readonly timeoutMs?: number
}

/**
 * Reads an utterance into a structured Intent.
 *
 * @param options - What was said, what exists, and how to ask a model.
 * @returns The Intent, or a refusal. Never a guess.
 */
export async function parseIntent(
  options: ParseIntentOptions,
): Promise<Result<Intent, FridayError>> {
  const prompt = intentPrompt({
    utterance: options.utterance,
    actions: options.registry.actions,
  })

  const answered = await askOnce({
    invoke: options.invoke,
    prompt,
    utterance: options.utterance,
    promptVersion: INTENT_PROMPT_VERSION,
    maxTokens: options.maxTokens ?? 2000,
    timeoutMs: options.timeoutMs ?? 30_000,
    schema: IntentSchema,
    what: 'what you asked for',
  })

  return answered
}

/** The shape a planning model must return. Risk is absent by construction. */
const ProposedPlanSchema = z.object({
  rationale: z.string().min(1).max(4096),
  steps: z
    .array(
      z.object({
        sequence: z.int().positive(),
        dependsOn: z.array(z.int().positive()).max(MAX_STEPS),
        description: z.string().min(1).max(1024),
        actionType: z.string().min(1).max(128),
        department: z.string().min(1).max(128),
        onFailure: StepFailureActionSchema,
      }),
    )
    .min(1)
    .max(MAX_STEPS),
})

export interface GeneratePlanOptions {
  readonly utterance: string
  readonly intent: Intent
  readonly registry: CapabilityRegistry
  readonly invoke: Invoke
  readonly maxTokens?: number
  readonly timeoutMs?: number
}

/** A plan as proposed: its reasoning, and its steps with real ids. */
export interface ProposedPlan {
  readonly rationale: string
  readonly steps: readonly ProposedStep[]
}

/**
 * Turns an Intent into an ordered, validated plan.
 *
 * ★ The model works in **sequence numbers**; this assigns the ids. A model
 * inventing step ids would be a model inventing identity, and the dependency
 * graph would then reference things that may not exist. Sequence numbers are
 * small integers a model handles reliably, and translating them here means a
 * dangling reference is caught as a number out of range rather than becoming a
 * plausible-looking id.
 *
 * @param options - The request, its reading, what exists, and how to ask.
 * @returns The validated plan, or the first reason it is not one.
 */
export async function generatePlan(
  options: GeneratePlanOptions,
): Promise<Result<ProposedPlan, FridayError>> {
  const catalogue = options.registry.actions.map((action) => {
    const route = options.registry.route(action)
    return {
      action,
      description: route.ok ? route.value.capability.description : action,
    }
  })

  const prompt = planPrompt({
    utterance: options.utterance,
    intentKind: options.intent.kind,
    actions: catalogue,
    maxSteps: MAX_STEPS,
    maxDepth: MAX_DEPTH,
  })

  const answered = await askOnce({
    invoke: options.invoke,
    prompt,
    utterance: options.utterance,
    promptVersion: PLAN_PROMPT_VERSION,
    maxTokens: options.maxTokens ?? 4000,
    timeoutMs: options.timeoutMs ?? 60_000,
    schema: ProposedPlanSchema,
    what: 'a plan',
  })

  if (!answered.ok) return answered

  const bySequence = new Map(answered.value.steps.map((step) => [step.sequence, uuidv7()]))

  const steps: ProposedStep[] = []

  for (const step of answered.value.steps) {
    const id = bySequence.get(step.sequence)
    if (id === undefined) continue

    const dependsOn: string[] = []

    for (const on of step.dependsOn) {
      const target = bySequence.get(on)

      if (target === undefined) {
        // ★ Caught as a number that names no step, rather than as an id that
        // looks real. The distinction matters when reading the failure.
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message: `FRIDAY made a plan whose step ${step.sequence} waits on step ${on}, which is not in it.`,
            detail: { sequence: step.sequence, dependsOn: on },
          }),
        )
      }

      dependsOn.push(target)
    }

    steps.push({
      id,
      sequence: step.sequence,
      dependsOn,
      description: step.description,
      actionType: step.actionType,
      department: step.department,
      onFailure: step.onFailure,
    })
  }

  // ★ The same bounds every plan passes, applied to a model's output before it
  // becomes anything. A plan that fails here never existed.
  const valid = validatePlan(steps)
  if (!valid.ok) return valid

  return ok({ rationale: answered.value.rationale, steps })
}

/**
 * One bounded call, with one retry on a format failure.
 *
 * ★ The retry matches the agent runtime's rule and exists for the same reason:
 * models correct their own format errors reliably when given the error, and
 * not at all when given silence. A second failure is a refusal — a plan FRIDAY
 * cannot read is not a plan she should act on.
 */
async function askOnce<T>(input: {
  invoke: Invoke
  prompt: string
  utterance: string
  promptVersion: string
  maxTokens: number
  timeoutMs: number
  schema: z.ZodType<T>
  what: string
}): Promise<Result<T, FridayError>> {
  let feedback: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    const request: ModelRequest = {
      capability: 'reasoning.strong',
      messages: [
        { role: 'system', content: input.prompt },
        ...(feedback === undefined
          ? []
          : ([{ role: 'system', content: `Your last answer was unusable: ${feedback}` }] as const)),
        { role: 'context', content: input.utterance },
      ],
      // ★ The planner never sees more than internal data, and never decides
      // its own sensitivity. A request carrying private content routes to a
      // local provider or is refused — the router's rule, not this one's.
      sensitivity: 'internal',
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      promptVersion: input.promptVersion,
    }

    const answered = await input.invoke(request)
    if (!answered.ok) return answered

    const parsed = input.schema.safeParse(readJson(answered.value.text))

    if (parsed.success) return ok(parsed.data)

    feedback = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'the answer'}: ${issue.message}`)
      .join('; ')
  }

  return err(
    fridayError({
      code: 'VALIDATION_FAILED',
      message: `FRIDAY could not turn this into ${input.what} she can read, so she stopped.`,
      detail: { promptVersion: input.promptVersion, problem: feedback },
    }),
  )
}

/** Reads JSON out of a model's answer, tolerating a code fence around it. */
function readJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}
