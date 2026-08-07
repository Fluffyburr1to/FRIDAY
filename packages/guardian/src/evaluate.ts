import type { RiskClass } from '@friday/contracts'
import { type Policy, type PolicyEffect, policyMatches } from './policy.js'
import type { PolicySet } from './policy-set.js'
import { RISK_RANK } from './risk.js'

/**
 * Evaluating the rule set.
 *
 * ADR-0025 in code, and the whole of it fits in one sentence: **every rule is
 * evaluated, the strictest outcome wins, and no match denies.**
 *
 * The property being bought is that the result is a pure function of the
 * request and the rule set — independent of file order, load order, and
 * insertion order. A decision that depended on the order files came off a disk
 * could not be re-derived from the record years later, and adding a file could
 * disarm an existing restriction with nothing in the diff to show it.
 *
 * Reference: docs/adr/0025-policy-evaluation-is-order-independent-and-fails-closed.md
 */

/**
 * Strictness, ascending. `deny` ends the question.
 *
 * Not exported: callers compare through the evaluator, so the numbers stay an
 * implementation detail and cannot end up persisted, where inserting a level
 * would silently change what old records meant.
 */
const EFFECT_RANK: Readonly<Record<PolicyEffect, number>> = {
  allow: 0,
  require_approval: 1,
  deny: 2,
}

/** What every evaluation reports, whether or not anything matched. */
interface EvaluationBase {
  /**
   * The strictest class among the matching rules.
   *
   * `critical` when nothing matched. An unclassified action is not a harmless
   * one, and recording it as `low` would let something downstream treat an
   * action nobody has ever considered as routine.
   */
  readonly riskClass: RiskClass

  /** ★ Every rule that matched, so an explanation can be honest about scope. */
  readonly matched: readonly string[]

  /** Rules that would have matched but were exempted by a standing grant. */
  readonly exempted: readonly string[]
}

/** No rule mentioned this action. Under ADR-0025 that is a refusal. */
export interface UnmatchedEvaluation extends EvaluationBase {
  readonly effect: null
  readonly deciding: null
}

/** At least one rule applied. */
export interface MatchedEvaluation extends EvaluationBase {
  readonly effect: PolicyEffect

  /**
   * The rule that carried the decision: strictest effect, then highest risk,
   * then first by id.
   *
   * The whole rule rather than its id, so that composing an explanation cannot
   * fail to find it. The tiebreak on id exists only so that two equally
   * decisive rules produce the same explanation every time; without it, the
   * sentence shown to the owner could change between runs for reasons that
   * mean nothing.
   */
  readonly deciding: Policy
}

/**
 * What the rule set says about one request.
 *
 * A union rather than one shape with nullable fields, so that "nothing matched
 * but here is the deciding rule" cannot be written down. The caller narrows on
 * `effect` once and everything else follows, which is what removes a branch
 * that no test could ever reach and no reader could ever be sure about.
 */
export type PolicyEvaluation = UnmatchedEvaluation | MatchedEvaluation

/** What the evaluator needs to know beyond the request itself. */
export interface EvaluationContext {
  /**
   * Whether a live standing grant covers this request.
   *
   * Supplied by the caller because grants are stored state and the evaluator
   * is pure. The evaluator never decides whether a grant is valid — it only
   * honours `unless: { standingGrant: true }` on a rule that asked.
   */
  readonly standingGrantApplies: boolean
}

/** What the matching pass found, before anything is reduced. */
interface MatchingRules {
  /** In id order, with exempted rules already softened to `allow`. */
  readonly applying: readonly Policy[]
  readonly matched: readonly string[]
  readonly exempted: readonly string[]
}

/**
 * Finds every rule that covers a request, and applies rule-local exemptions.
 *
 * Split from the reduction below so each half is separately readable: this one
 * answers "which rules are in play", and the other answers "what do they add
 * up to". They were one function and it was hard to hold in the head, which is
 * a real cost in the component whose behaviour has to be verifiable by eye.
 */
function findMatchingRules(
  policySet: PolicySet,
  request: { action: string; resource: string; actorType: string; actorId: string },
  context: EvaluationContext,
): MatchingRules {
  const applying: Policy[] = []
  const matched: string[] = []
  const exempted: string[] = []

  for (const policy of policySet.policies) {
    if (!policyMatches(policy, request)) continue

    matched.push(policy.id)

    // A rule-local exemption, never a global override.
    //
    // The exempted rule softens to `allow`; it is not removed. Removing it
    // would mean a request covered by a standing grant, and matched by nothing
    // else, fell through to "no rule matched" and was refused — the owner
    // would have granted permission and made the action *less* possible. It
    // also keeps the rule's risk class counting toward the maximum, because a
    // pre-approved action has not become a safe one.
    //
    // Because this only softens toward `allow`, a `deny` anywhere else still
    // wins, and a rule that did not ask for the exemption is untouched. That
    // is how "no standing grant may fully satisfy a critical action" holds
    // without a special case: critical rules simply carry no `unless`.
    const exempt = policy.unless?.standingGrant === true && context.standingGrantApplies
    if (exempt) exempted.push(policy.id)

    applying.push(exempt ? { ...policy, effect: 'allow' } : policy)
  }

  return { applying, matched, exempted }
}

/**
 * Evaluates every rule against one request.
 *
 * @param policySet - The complete rule set.
 * @param request - The action, resource, and actor being considered.
 * @param context - Facts the rules may exempt themselves on.
 * @returns What the rule set collectively says, and which rules said it.
 */
export function evaluatePolicies(
  policySet: PolicySet,
  request: { action: string; resource: string; actorType: string; actorId: string },
  context: EvaluationContext,
): PolicyEvaluation {
  const { applying, matched, exempted } = findMatchingRules(policySet, request, context)

  const first = applying[0]
  if (first === undefined) {
    return { effect: null, riskClass: 'critical', matched, deciding: null, exempted }
  }

  let effect = first.effect
  let riskClass = first.riskClass
  let deciding = first

  // One pass. `applying` is in id order, and every comparison is strict, so a
  // tie keeps the earliest id — which is what makes the sentence shown to the
  // owner identical on every run.
  for (const policy of applying) {
    if (EFFECT_RANK[policy.effect] > EFFECT_RANK[effect]) effect = policy.effect

    // Risk is maximised independently of effect. A rule may allow something
    // and still classify it as high risk, and that classification still counts
    // — it is what a standing grant is later checked against.
    if (RISK_RANK[policy.riskClass] > RISK_RANK[riskClass]) riskClass = policy.riskClass

    const stricter = EFFECT_RANK[policy.effect] > EFFECT_RANK[deciding.effect]
    const riskier =
      policy.effect === deciding.effect &&
      RISK_RANK[policy.riskClass] > RISK_RANK[deciding.riskClass]

    if (stricter || riskier) deciding = policy
  }

  return { effect, riskClass, matched, deciding, exempted }
}
