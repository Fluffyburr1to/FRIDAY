import {
  err,
  type FridayError,
  fridayError,
  type ModelRequest,
  ModelRequestSchema,
  type ModelResponse,
  mayLeaveTheMachine,
  ok,
  type Result,
} from '@friday/contracts'
import type { ModelProvider } from './provider.js'

/**
 * The router: capability in, provider out.
 *
 * ★ It fails closed twice, and both refusals are the point of the package
 * rather than error handling around it.
 *
 * **On sensitivity.** A `private` request is refused when no local provider
 * can serve it. It is never downgraded to a cloud provider because the local
 * one is missing, slow, or broken. Article IV's "prefer local processing" is
 * only a guarantee if the alternative to local is *nothing*.
 *
 * **On budget.** Exhausted means stop, never "continue and bill it" — enforced
 * by the ledger this router is given, before any provider is called.
 *
 * Reference: docs/adr/0008-model-router.md · docs/01-bible/11-agent-framework.md
 */

/** Checked before every call. Exhausted means stop. */
export interface BudgetLedger {
  /**
   * Whether `costCents` may still be spent.
   *
   * @param estimateCents - What the call might cost, at its ceiling.
   * @returns Ok when there is room, or the level that is exhausted.
   */
  check(estimateCents: number): Result<void, FridayError>

  /** Records what was actually spent, after the fact. */
  record(costCents: number): void
}

export interface RouterOptions {
  readonly providers: readonly ModelProvider[]
  readonly budget: BudgetLedger

  /**
   * What a call is assumed to cost when deciding whether to allow it.
   *
   * ★ Checked *before* the call, so it has to be an estimate — and it is
   * deliberately a ceiling rather than an average. Guessing low and checking
   * afterwards is how a budget becomes a report of what was already spent.
   */
  readonly estimateCents: (request: ModelRequest) => number
}

export interface ModelRouter {
  invoke(request: ModelRequest): Promise<Result<ModelResponse, FridayError>>
}

/**
 * Builds the router.
 *
 * @param options - Providers, the budget ledger, and the cost estimator.
 * @returns A router that selects a provider by policy and never by name.
 */
export function createModelRouter(options: RouterOptions): ModelRouter {
  const { providers, budget, estimateCents } = options

  return {
    async invoke(request) {
      const validated = ModelRequestSchema.safeParse(request)

      if (!validated.success) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message: 'FRIDAY was asked for thinking in a shape she does not accept.',
            detail: { issues: validated.error.issues.map((issue) => issue.path.join('.')) },
          }),
        )
      }

      const asked = validated.data
      const mustStayLocal = !mayLeaveTheMachine(asked.sensitivity)

      const allowed = providers.filter(
        (provider) =>
          provider.capabilities.includes(asked.capability) && (!mustStayLocal || provider.isLocal),
      )

      if (allowed.length === 0) return err(nothingMayServe(asked, mustStayLocal, providers))

      const affordable = budget.check(estimateCents(asked))
      if (!affordable.ok) return affordable

      const chosen = await firstAvailable(allowed)
      if (chosen === undefined) return err(noneAvailable(asked, mustStayLocal))

      const served = await chosen.serve(asked)
      if (!served.ok) return served

      budget.record(served.value.usage.costCents)

      return ok(served.value)
    },
  }
}

/** The first provider that answers. Order is preference order. */
async function firstAvailable(
  providers: readonly ModelProvider[],
): Promise<ModelProvider | undefined> {
  for (const provider of providers) {
    if (await provider.isAvailable()) return provider
  }

  return undefined
}

/**
 * ★ The refusal that makes sensitivity routing real.
 *
 * The message distinguishes the two cases deliberately. "No provider offers
 * this capability" is a configuration gap. "A local provider is required and
 * there is none" is FRIDAY declining to send the owner's private data to
 * somebody else's computer, and it should read as a decision rather than as a
 * malfunction — because a message that reads like a malfunction invites
 * someone to fix it by removing the check.
 */
function nothingMayServe(
  request: ModelRequest,
  mustStayLocal: boolean,
  providers: readonly ModelProvider[],
): FridayError {
  const capable = providers.filter((provider) => provider.capabilities.includes(request.capability))

  if (mustStayLocal && capable.length > 0) {
    return fridayError({
      code: 'MODEL_UNAVAILABLE',
      message:
        `This is ${request.sensitivity} data, so FRIDAY will only think about it on this ` +
        'machine — and no local model is set up.\n\n' +
        '  She has not sent it anywhere else, and she will not. Install a local model, or ' +
        'ask her something that does not involve private data.',
      detail: { capability: request.capability, sensitivity: request.sensitivity },
    })
  }

  return fridayError({
    code: 'MODEL_UNAVAILABLE',
    message: `FRIDAY has no model set up that can do this kind of thinking (${request.capability}).`,
    detail: { capability: request.capability, sensitivity: request.sensitivity },
  })
}

/** Every eligible provider was reachable in configuration and not in fact. */
function noneAvailable(request: ModelRequest, mustStayLocal: boolean): FridayError {
  return fridayError({
    code: 'MODEL_UNAVAILABLE',
    message: mustStayLocal
      ? 'The local model FRIDAY needs for private data is set up but not responding. ' +
        'She has not sent this anywhere else.'
      : 'No model FRIDAY can use is responding right now.',
    detail: { capability: request.capability, sensitivity: request.sensitivity },
  })
}
