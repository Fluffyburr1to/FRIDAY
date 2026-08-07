import {
  type AuthorizationRequest,
  AuthorizationRequestSchema,
  type DecisionReason,
  err,
  type FridayError,
  fridayError,
  type GuardianDecision,
  ok,
  type Result,
  type RiskClass,
  uuidv7,
} from '@friday/contracts'
import { isRecognisableActor, requiresCapability } from './actor-identity.js'
import type { CapabilityIssuer } from './capabilities.js'
import { evaluatePolicies, type MatchedEvaluation } from './evaluate.js'
import type { GrantOutcome, GrantRegistry } from './grants.js'
import type { PolicySet } from './policy-set.js'

/**
 * The Guardian.
 *
 * Chapter 17's four layers, in order, all of which must pass:
 *
 * ```
 * 1. AUTHENTICATION   Who is asking? Unknown → reject.
 * 2. CAPABILITY       Does the ticket cover this exact action and resource,
 *                     and is it still valid?           → no: reject
 * 3. POLICY           Do the owner's rules permit this? → no: deny
 * 4. RISK             Does it need approval?           → yes: NEEDS_APPROVAL
 * ```
 *
 * Capability and policy are both required, deliberately. A capability says
 * "this actor was given permission for this step". Policy says "this kind of
 * action is permitted at all". A bug in capability issuance cannot bypass
 * policy, and an over-broad policy cannot grant an agent something its step
 * did not require. Two independent gates.
 *
 * **Every path returns a decision, and every decision carries a sentence the
 * owner can read.** A refusal nobody can explain is Article II failing at the
 * one place it matters most.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · Chapter 19
 */

/** Everything the Guardian needs to answer a question. */
export interface GuardianOptions {
  readonly policies: PolicySet
  readonly capabilities: CapabilityIssuer
  readonly grants: GrantRegistry
  readonly now?: (() => number) | undefined
}

/** The sole authority on whether an action may proceed. */
export interface Guardian {
  /**
   * Answers: may this actor take this action on this resource right now?
   *
   * @param request - Who, what, on what, and with which ticket.
   * @returns The decision, or an error when the question itself was malformed.
   */
  authorize(request: AuthorizationRequest): Result<GuardianDecision, FridayError>
}

/**
 * Builds the Guardian.
 *
 * @param options - The rule set, the capability issuer, the grant registry.
 * @returns A Guardian.
 */
export function createGuardian(options: GuardianOptions): Guardian {
  const now = options.now ?? Date.now

  return {
    authorize(input) {
      const parsed = AuthorizationRequestSchema.safeParse(input)
      if (!parsed.success) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message: 'FRIDAY was asked a permission question she could not make sense of.',
            detail: { issues: parsed.error.issues },
          }),
        )
      }

      const request = parsed.data
      const decide = (
        outcome: Outcome,
        extras: Partial<GuardianDecision> = {},
      ): Result<GuardianDecision, FridayError> => ok(record(request, outcome, now(), extras))

      // ── Layer 1: who is asking ──────────────────────────────────────────
      if (!isRecognisableActor(request.actor)) {
        return decide({
          decision: 'deny',
          reason: 'actor_unknown',
          riskClass: 'critical',
          summary: `FRIDAY does not recognise "${request.actor.id}" as something that can ask.`,
        })
      }

      // ── Layer 2: the ticket ─────────────────────────────────────────────
      const capability = checkCapability(request, options.capabilities)
      if (capability.rejected !== undefined) return decide(capability.rejected)

      // ── Layers 3 and 4: the rules, and what they cost you ───────────────
      const [outcome, extras] = judge(request, options)

      return decide(outcome, {
        ...extras,
        capabilityId: capability.capabilityId ?? null,
      })
    },
  }
}

/** The fields every path must produce. */
interface Outcome {
  readonly decision: GuardianDecision['decision']
  readonly reason: DecisionReason
  readonly riskClass: RiskClass
  readonly summary: string
  readonly matchedPolicies?: readonly string[] | undefined
}

/**
 * Verifies a presented ticket, and insists on one where the actor's kind
 * requires it.
 */
function checkCapability(
  request: AuthorizationRequest,
  capabilities: CapabilityIssuer,
): { rejected?: Outcome; capabilityId?: string } {
  if (request.capability === undefined) {
    if (!requiresCapability(request.actor)) return {}

    return {
      rejected: {
        decision: 'deny',
        reason: 'capability_required',
        riskClass: 'critical',
        summary:
          'An agent tried to act without a permission slip, so there is nothing tying ' +
          'what it did to work you asked for.',
      },
    }
  }

  const verified = capabilities.verify({
    token: request.capability,
    actor: request.actor,
    action: request.action,
    resource: request.resource,
  })

  if (!verified.ok) {
    return {
      rejected: {
        decision: 'deny',
        reason: verified.error.reason,
        riskClass: 'critical',
        summary: verified.error.error.message,
      },
    }
  }

  return { capabilityId: verified.value.id }
}

/**
 * Layers 3 and 4 together, because the risk class layer 4 needs is the one
 * layer 3 produced.
 *
 * The rule set is evaluated first with no grant in play, which is what yields
 * the risk class a grant is then measured against. Evaluating the other way
 * round would let a grant decide its own sufficiency.
 */
function judge(
  request: AuthorizationRequest,
  options: GuardianOptions,
): [Outcome, Partial<GuardianDecision>] {
  const subject = subjectOf(request)
  const base = evaluatePolicies(options.policies, subject, { standingGrantApplies: false })
  const matchedPolicies = base.matched

  const outcome = options.grants.find({
    principalId: request.principalId,
    action: request.action,
    resource: request.resource,
    riskClass: base.riskClass,
    ...(typeof request.context?.amountCents === 'number'
      ? { amountCents: request.context.amountCents }
      : {}),
  })

  // A standing refusal outranks everything, including a rule that would have
  // allowed this outright. "Never do this again" is a boundary.
  if (outcome.kind === 'denied') {
    return [
      {
        decision: 'deny',
        reason: 'standing_grant_denied',
        riskClass: base.riskClass,
        matchedPolicies,
        summary: `You told FRIDAY not to: ${outcome.grant.reason}`,
      },
      { standingGrantId: outcome.grant.id },
    ]
  }

  if (base.effect === null) {
    return [
      {
        decision: 'deny',
        reason: 'no_policy_matched',
        riskClass: base.riskClass,
        matchedPolicies,
        summary:
          `No rule covers "${request.action}", so FRIDAY refused it. ` +
          'Adding a rule for it is how she learns whether it is allowed.',
      },
      {},
    ]
  }

  if (base.effect === 'deny') {
    return [
      {
        decision: 'deny',
        reason: 'policy_denied',
        riskClass: base.riskClass,
        matchedPolicies,
        summary: describe(base),
      },
      {},
    ]
  }

  if (base.effect === 'allow') {
    return [
      {
        decision: 'allow',
        reason: 'policy_allowed',
        riskClass: base.riskClass,
        matchedPolicies,
        summary: describe(base),
      },
      {},
    ]
  }

  return approvalOrGrant(request, options, base, outcome)
}

/** The four fields the policy layer matches on. */
function subjectOf(request: AuthorizationRequest): {
  action: string
  resource: string
  actorType: string
  actorId: string
} {
  return {
    action: request.action,
    resource: request.resource,
    actorType: request.actor.type,
    actorId: request.actor.id,
  }
}

/** The `require_approval` branch: does a standing permission cover it? */
function approvalOrGrant(
  request: AuthorizationRequest,
  options: GuardianOptions,
  base: MatchedEvaluation,
  outcome: GrantOutcome,
): [Outcome, Partial<GuardianDecision>] {
  const matchedPolicies = base.matched

  if (outcome.kind === 'applies') {
    const withGrant = evaluatePolicies(options.policies, subjectOf(request), {
      standingGrantApplies: true,
    })

    // The grant only helps if the rules that asked for approval were the ones
    // offering the exemption. A `critical` rule carries none, so a grant can
    // match the action and still leave the question standing — which is how
    // "no grant fully satisfies a critical action" holds without a special
    // case here.
    if (withGrant.effect === 'allow') {
      // Counted now rather than after the action runs. An `allow` is FRIDAY
      // saying the action proceeds, and a grant whose uses were only counted
      // on success would under-report exactly when something went wrong.
      options.grants.use(outcome.grant.id)

      return [
        {
          decision: 'allow',
          reason: 'standing_grant_applied',
          riskClass: base.riskClass,
          matchedPolicies,
          summary: `You allowed this in advance: ${outcome.grant.reason}`,
        },
        { standingGrantId: outcome.grant.id },
      ]
    }
  }

  const because = describe(base)

  // A grant that matched the action but did not stretch to it is reported as
  // such. "Your permission does not cover this" and "you gave no permission"
  // lead the owner to different next steps, and only one of them is "widen the
  // permission you already have".
  if (outcome.kind === 'insufficient') {
    return [
      {
        decision: 'needs_approval',
        reason: 'standing_grant_insufficient',
        riskClass: base.riskClass,
        matchedPolicies,
        summary: `Your standing permission does not stretch this far, so FRIDAY is asking. ${because}`,
      },
      { standingGrantId: outcome.grant.id },
    ]
  }

  return [
    {
      decision: 'needs_approval',
      reason: 'approval_required',
      riskClass: base.riskClass,
      matchedPolicies,
      summary: because,
    },
    {},
  ]
}

/**
 * Quotes the deciding rule in the owner's own words.
 *
 * The rule's `description` is required for exactly this: an explanation that
 * said "policy connector-sends-need-approval applied" would be true and would
 * tell the owner nothing. The sentence is composed from rules the owner wrote,
 * never afterwards by asking a model what it was thinking.
 */
function describe(evaluation: MatchedEvaluation): string {
  const others = evaluation.matched.length - 1
  const alsoMatched =
    others > 0 ? ` (${others} other rule${others === 1 ? '' : 's'} also applied.)` : ''

  return `${evaluation.deciding.description}${alsoMatched}`
}

/** Assembles the recorded decision. */
function record(
  request: AuthorizationRequest,
  outcome: Outcome,
  decidedAt: number,
  extras: Partial<GuardianDecision>,
): GuardianDecision {
  return {
    id: uuidv7(decidedAt),
    decision: outcome.decision,
    reason: outcome.reason,
    riskClass: outcome.riskClass,
    matchedPolicies: [...(outcome.matchedPolicies ?? [])],
    approvalId: null,
    standingGrantId: null,
    capabilityId: null,
    summary: outcome.summary,
    actor: request.actor,
    principalId: request.principalId,
    action: request.action,
    resource: request.resource,
    planId: request.planId ?? null,
    planStepId: request.planStepId ?? null,
    correlationId: request.correlationId ?? null,
    decidedAt,
    ...extras,
  }
}
