import type {
  Actor,
  AgentManifest,
  AgentSuspension,
  FridayError,
  GuardianDecision,
  PrincipalId,
  Result,
  RiskClass,
  TerminationReason,
} from '@friday/contracts'
import { manifestAllows, manifestAllowsConnector } from '@friday/contracts'
import { isAtLeastAsRiskyAs } from '@friday/guardian'

/**
 * The mediator — where *"an agent cannot do anything; it can only ask"* stops
 * being a sentence and becomes a function call.
 *
 * ★ Every effect an agent wants passes through here, and the order of the
 * checks is the design rather than an implementation detail:
 *
 *   1. **Is this agent even the kind of thing that does this?** — the manifest.
 *      Cheapest, most absolute, and answerable without any state. An agent
 *      asking for something it never declared is not denied, it is
 *      **terminated**: it is malfunctioning or has been manipulated, and both
 *      mean the correct response is to stop it rather than to say no and let
 *      it try something else.
 *   2. **May this actor do this, to this, right now?** — the Guardian. The only
 *      authority, and never consulted before step 1 because a manifest breach
 *      should not become an ordinary permission question.
 *   3. **Does the answer exceed what this agent may attempt?** — the risk
 *      ceiling. A `low`-only agent that provokes a `high` classification is
 *      terminated even if the Guardian would have asked the owner, because the
 *      agent had no business getting there.
 *
 * A `needs_approval` answer is **not** an error and **not** a wait. It becomes
 * a suspension the caller returns, so the plan waits and the agent does not.
 *
 * Reference: docs/01-bible/11-agent-framework.md · docs/01-bible/19-approval-system.md
 */

/** What an agent is asking to do. */
export interface ToolRequest {
  /** The capability it is exercising, e.g. `memory.read`. */
  readonly capability: string

  /** The action the Guardian will classify, e.g. `memory.read`. */
  readonly action: string

  /** What it happens to. */
  readonly resource: string

  /** Which connector, when the capability reaches one. M6 and later. */
  readonly connector?: string | undefined

  /** Plain language, carried onto the approval screen if one is needed. */
  readonly because: string
}

/** What the Guardian is asked, without the mediator owning the shape. */
export type AuthorizeFn = (input: {
  actor: Actor
  principalId: PrincipalId
  action: string
  resource: string
}) => Result<GuardianDecision, FridayError>

export type MediationOutcome =
  /** The Guardian said yes. The caller may perform the effect. */
  | { readonly kind: 'allowed'; readonly decision: GuardianDecision }
  /** The owner must decide. The agent returns; the plan waits. */
  | { readonly kind: 'suspended'; readonly suspension: AgentSuspension }
  /** The Guardian said no. The agent may carry on and try something else. */
  | { readonly kind: 'denied'; readonly decision: GuardianDecision }
  /** The agent stepped outside its own manifest. Stop it. */
  | {
      readonly kind: 'terminate'
      readonly reason: TerminationReason
      readonly because: string
    }
  /** FRIDAY's own permission system could not answer. Not the agent's fault. */
  | { readonly kind: 'unavailable'; readonly because: string }

export interface MediatorOptions {
  readonly manifest: AgentManifest
  readonly actor: Actor
  readonly principalId: PrincipalId
  readonly authorize: AuthorizeFn
}

export interface Mediator {
  mediate(request: ToolRequest): MediationOutcome
}

/**
 * Builds the mediator for one agent invocation.
 *
 * @param options - The manifest, who is asking, and how to reach the Guardian.
 * @returns A mediator that answers with one of four outcomes and never acts.
 */
export function createMediator(options: MediatorOptions): Mediator {
  const { manifest, actor, principalId, authorize } = options

  return {
    mediate(request) {
      // ── 1. The manifest, before anything else ───────────────────────────
      if (!manifestAllows(manifest, request.capability)) {
        return {
          kind: 'terminate',
          reason: 'capability_not_declared',
          because:
            `The agent "${manifest.id}" asked to use ${request.capability}, which it does not ` +
            'declare. It was stopped rather than refused: an agent reaching outside its own ' +
            'manifest is malfunctioning or has been manipulated.',
        }
      }

      if (
        request.connector !== undefined &&
        !manifestAllowsConnector(manifest, request.connector)
      ) {
        return {
          kind: 'terminate',
          reason: 'connector_not_declared',
          because:
            `The agent "${manifest.id}" tried to reach ${request.connector}, which it does not ` +
            'declare. It was stopped rather than refused.',
        }
      }

      // ── 2. The Guardian, the only authority ─────────────────────────────
      const decided = authorize({
        actor,
        principalId,
        action: request.action,
        resource: request.resource,
      })

      if (!decided.ok) {
        // ★ A Guardian that cannot answer is not a Guardian that said yes.
        // Failing closed here is what keeps a broken policy store from
        // becoming an open door.
        //
        // Reported as `unavailable` rather than as a termination, because the
        // agent did nothing wrong and the distinction is what the owner needs:
        // "your assistant misbehaved" and "FRIDAY's own permission system is
        // down" are different incidents with different fixes.
        return {
          kind: 'unavailable',
          because:
            'FRIDAY could not get a permission decision, so she stopped. She does not proceed ' +
            'on an unanswered question.',
        }
      }

      const decision = decided.value

      // ── 3. The risk ceiling this agent declared ─────────────────────────
      if (exceedsCeiling(decision.riskClass, manifest.riskClasses)) {
        return {
          kind: 'terminate',
          reason: 'risk_class_exceeded',
          because:
            `The agent "${manifest.id}" provoked a ${decision.riskClass} decision, above the ` +
            `${manifest.riskClasses.join(', ')} it declares. It was stopped, and the owner was ` +
            'not asked — an agent should not be able to put a question in front of him that it ' +
            'had no business raising.',
        }
      }

      if (decision.decision === 'needs_approval') {
        // ★ Not a wait. The agent returns; the plan waits.
        return {
          kind: 'suspended',
          suspension: {
            action: request.action,
            resource: request.resource,
            because: request.because,
          },
        }
      }

      return decision.decision === 'allow'
        ? { kind: 'allowed', decision }
        : { kind: 'denied', decision }
    },
  }
}

/**
 * Whether a decision's risk sits above every class the manifest declared.
 *
 * The ceiling is the highest declared class, so this asks whether *any*
 * declared class is at least as risky as the decision. If none is, the agent
 * has provoked something above its own envelope.
 */
function exceedsCeiling(riskClass: RiskClass, declared: readonly RiskClass[]): boolean {
  return !declared.some((allowed) => isAtLeastAsRiskyAs(allowed, riskClass))
}
