import type {
  AgentInvocationResult,
  AgentManifest,
  AgentSpend,
  TerminationReason,
} from '@friday/contracts'
import type { MediationOutcome, Mediator, ToolRequest } from './mediator.js'
import {
  describeExceeded,
  type ExceededDimension,
  openSpendLedger,
  type SpendLedger,
} from './spend.js'

/**
 * The agent execution loop.
 *
 * ★ Chapter 11's loop, with two properties that are easy to lose in a
 * refactor and expensive to lose in production:
 *
 * **The budget is checked after every step, including the last one.** A budget
 * checked only before the next iteration lets the final step run over and then
 * reports success — which is how an invocation exceeds its ceiling and is
 * recorded as having stayed inside it.
 *
 * **An agent never waits for approval.** A suspension ends the invocation
 * immediately and the thread goes away. The plan waits, as a row, at no cost.
 *
 * The agent's own work is injected as a `step` function rather than being
 * implemented here. That is what lets the same loop drive a scripted agent, a
 * model-backed one, and — when it lands — one inside a worker thread, without
 * the loop learning anything about which it is.
 *
 * Reference: docs/01-bible/11-agent-framework.md
 */

/** What the agent wants to do next, or the answer it has reached. */
export type StepIntent =
  /** Ask to do something. Goes through the mediator. */
  | { readonly kind: 'request'; readonly request: ToolRequest }
  /** Done. The output is validated before it escapes. */
  | { readonly kind: 'finish'; readonly output: unknown }

/**
 * One turn of the agent's own reasoning.
 *
 * Receives the outcome of its previous request — `undefined` on the first
 * turn — and says what it wants next. It is given no way to act, only to ask.
 */
export type AgentStep = (previous: MediationOutcome | undefined) => Promise<StepIntent> | StepIntent

/** Validates what the agent produced, by the name its manifest declared. */
export type OutputValidator = (
  schemaName: string,
  output: unknown,
) => { readonly ok: true } | { readonly ok: false; readonly problem: string }

export interface RunAgentOptions {
  readonly manifest: AgentManifest
  readonly mediator: Mediator
  readonly step: AgentStep
  readonly validate: OutputValidator

  /** Injected so a test can drive the clock rather than sleep through it. */
  readonly now?: () => number

  /** Injected so a resumed invocation continues an existing ledger. */
  readonly ledger?: SpendLedger
}

/**
 * Runs one agent invocation to a single outcome.
 *
 * @param options - The manifest, the mediator, the agent's own step function,
 *   and how to validate its output.
 * @returns Exactly one of: completed, suspended, failed, or terminated.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentInvocationResult> {
  const { manifest, mediator, step, validate } = options
  const ledger = options.ledger ?? openSpendLedger({ budget: manifest.budget, now: options.now })

  const state: LoopState = { previous: undefined, retriedOutput: false }

  // Bounded by the manifest's tool-call ceiling plus the turns that finish.
  // The ledger is the real bound; this only stops a step function that never
  // returns either kind of intent.
  for (let turn = 0; turn <= manifest.budget.maxToolCalls + 1; turn++) {
    // Before the step: catches an invocation resumed already over budget, so a
    // suspended agent cannot come back and run one more turn on credit.
    const before = ledger.exceeded()
    if (before !== undefined) return overBudget(before, manifest, ledger.spend)

    const intent = await step(state.previous)

    // ★ And after it. A budget checked only before the NEXT iteration lets the
    // final step run over and then reports success — an invocation that
    // exceeded its ceiling and is recorded as having stayed inside it. The
    // wall-clock ceiling is where this bites: a single slow step can pass it
    // without any request being made at all.
    const after = ledger.exceeded()
    if (after !== undefined) return overBudget(after, manifest, ledger.spend)

    const ended =
      intent.kind === 'finish'
        ? finish(intent.output, manifest, validate, ledger, state)
        : request(intent.request, mediator, ledger, state)

    if (ended !== undefined) return ended
  }

  // Falling out means the step function kept asking past every bound. Treated
  // as a budget termination rather than a failure: it is the runaway shape,
  // whatever the intent behind it.
  return terminated('budget_exhausted', 'it kept going past every limit it was given', ledger.spend)
}

/** What carries between turns. Deliberately small — agents are stateless. */
interface LoopState {
  previous: MediationOutcome | undefined
  retriedOutput: boolean
}

/**
 * Handles an agent that says it is done.
 *
 * @returns The outcome, or `undefined` to take one more turn on a retry.
 */
function finish(
  output: unknown,
  manifest: AgentManifest,
  validate: OutputValidator,
  ledger: SpendLedger,
  state: LoopState,
): AgentInvocationResult | undefined {
  const checked = validate(manifest.output, output)

  if (checked.ok) return { kind: 'completed', output, spend: ledger.spend }

  // ★ One retry, with the validation error fed back. Models correct their own
  // format errors reliably given the error; they do not correct them at all
  // given silence. A second failure is terminal — malformed output must never
  // reach the database, the owner, or another agent.
  if (state.retriedOutput) {
    return terminated(
      'output_invalid',
      `it produced a result FRIDAY could not read, twice: ${checked.problem}`,
      ledger.spend,
    )
  }

  state.retriedOutput = true
  state.previous = undefined

  return undefined
}

/**
 * Puts one request through the mediator.
 *
 * @returns The outcome, or `undefined` when the agent may take another turn.
 */
function request(
  asked: ToolRequest,
  mediator: Mediator,
  ledger: SpendLedger,
  state: LoopState,
): AgentInvocationResult | undefined {
  const outcome = mediator.mediate(asked)

  // Counted whatever the answer was, including a refusal — see spend.ts.
  ledger.record({})

  switch (outcome.kind) {
    case 'terminate':
      return terminated(outcome.reason, outcome.because, ledger.spend)

    case 'unavailable':
      return { kind: 'failed', because: outcome.because, spend: ledger.spend }

    // ★ The invocation ends here. The agent does not wait; the plan does.
    case 'suspended':
      return { kind: 'suspended', suspension: outcome.suspension, spend: ledger.spend }

    default:
      state.previous = outcome
      return undefined
  }
}

function terminated(
  reason: TerminationReason,
  because: string,
  spend: AgentSpend,
): AgentInvocationResult {
  return { kind: 'terminated', reason, because, spend }
}

/** The same termination however the ceiling was reached. */
function overBudget(
  dimension: ExceededDimension,
  manifest: AgentManifest,
  spend: AgentSpend,
): AgentInvocationResult {
  return terminated('budget_exhausted', describeExceeded(dimension, manifest.budget), spend)
}
