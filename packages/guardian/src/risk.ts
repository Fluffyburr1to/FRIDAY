import type { RiskClass } from '@friday/contracts'

/**
 * Risk, ordered.
 *
 * Lives in the Guardian and nowhere else. Comparing risk *is* deciding whether
 * something is permitted — it is what a standing grant's ceiling is checked
 * against and what the policy evaluator maximises — and the boundary rules say
 * nothing outside this package decides that.
 *
 * `self_modification` ranks above `critical` rather than beside it. ADR-0025
 * requires only that it be treated as at least critical, and a total order is
 * needed to take a maximum at all. Placing it at the top is the reading that
 * cannot fail in the permissive direction, and it matches the fact that it
 * carries every restriction `critical` does plus one more: it may not be
 * approved from a phone.
 *
 * Not persisted anywhere. A number in the database would silently change
 * meaning if a class were ever inserted into the middle of the scale.
 */
export const RISK_RANK: Readonly<Record<RiskClass, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
  self_modification: 4,
}

/**
 * Compares two risk classes.
 *
 * @param riskClass - The class being tested.
 * @param floor - The class to compare against.
 * @returns True when `riskClass` is at least as serious as `floor`.
 */
export function isAtLeastAsRiskyAs(riskClass: RiskClass, floor: RiskClass): boolean {
  return RISK_RANK[riskClass] >= RISK_RANK[floor]
}
