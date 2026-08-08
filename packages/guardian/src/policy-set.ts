import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { type Policy, PolicySchema } from './policy.js'

/**
 * Loading the rules.
 *
 * File layout carries no meaning. ADR-0025 evaluates every rule and takes the
 * strictest outcome, so the owner may organise `policies/` into whatever files
 * read well — one per department, one per risk class, one big file — without
 * any of it changing a decision. That property is worth more than it sounds:
 * it means adding a file can never silently disarm a rule in another file.
 *
 * What is not permitted is ambiguity about identity. Two rules with the same
 * id would make an explanation naming that id untrue, so a duplicate is a load
 * failure rather than a last-one-wins.
 *
 * Reference: docs/01-bible/17-authentication-authorization.md · ADR-0025
 */

/** The complete rule set the Guardian decides against. */
export interface PolicySet {
  /** Every rule, sorted by id so listings and explanations read stably. */
  readonly policies: readonly Policy[]

  /**
   * One rule by id.
   *
   * @param id - The rule's stable identifier.
   * @returns The rule, or undefined when no rule carries that id.
   */
  get(id: string): Policy | undefined
}

/**
 * Builds a policy set from already-parsed rule objects.
 *
 * @param inputs - Candidate rules, from JSON files or from a test.
 * @returns The validated set, or the first thing wrong with it.
 */
export function createPolicySet(inputs: readonly unknown[]): Result<PolicySet, FridayError> {
  // An empty set is refused rather than accepted as "deny everything". It
  // would behave identically — nothing matches, so nothing is permitted — but
  // it would do so silently, and a Guardian that refuses every action because
  // its rules failed to load is a broken system that looks like a strict one.
  if (inputs.length === 0) {
    return err(
      fridayError({
        code: 'POLICY_SET_EMPTY',
        message:
          'No authorization rules were found, so FRIDAY would refuse everything. ' +
          'Check that packages/guardian/policies/ contains at least one rule file.',
      }),
    )
  }

  const byId = new Map<string, Policy>()

  for (const [index, input] of inputs.entries()) {
    const parsed = PolicySchema.safeParse(input)
    if (!parsed.success) {
      return err(
        fridayError({
          code: 'POLICY_INVALID',
          message: `An authorization rule is malformed and FRIDAY will not start with it.`,
          detail: { index, issues: parsed.error.issues },
        }),
      )
    }

    const policy = parsed.data
    if (byId.has(policy.id)) {
      return err(
        fridayError({
          code: 'POLICY_INVALID',
          message:
            `Two authorization rules are both called "${policy.id}". ` +
            'Rule names are quoted when FRIDAY explains a decision, so they must be unique.',
          detail: { id: policy.id },
        }),
      )
    }

    byId.set(policy.id, policy)
  }

  const policies = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))

  return ok({
    policies,
    get: (id) => byId.get(id),
  })
}

/**
 * Reads every `*.json` rule file in a directory.
 *
 * A file that is not valid JSON, or that does not contain an array of rules,
 * fails the load. Nothing is skipped: a rule file that quietly failed to parse
 * would remove whatever restrictions it contained, which is the one failure
 * mode this component cannot have.
 *
 * @param directory - Usually `packages/guardian/policies`.
 * @returns The validated set, or what went wrong reading it.
 */
export function loadPolicySet(directory: string): Result<PolicySet, FridayError> {
  let files: string[]

  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch (cause) {
    return err(
      fridayError({
        code: 'POLICY_INVALID',
        message: `FRIDAY could not read her authorization rules from ${directory}.`,
        cause,
      }),
    )
  }

  const inputs: unknown[] = []

  for (const file of files) {
    const path = join(directory, file)
    let contents: unknown

    try {
      contents = JSON.parse(readFileSync(path, 'utf8'))
    } catch (cause) {
      return err(
        fridayError({
          code: 'POLICY_INVALID',
          message: `The authorization rule file ${file} is not valid JSON.`,
          detail: { file },
          cause,
        }),
      )
    }

    if (!Array.isArray(contents)) {
      return err(
        fridayError({
          code: 'POLICY_INVALID',
          message: `The authorization rule file ${file} must contain a list of rules.`,
          detail: { file },
        }),
      )
    }

    inputs.push(...contents)
  }

  return createPolicySet(inputs)
}
