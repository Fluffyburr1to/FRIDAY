import { constants, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode } from '../output.js'

/**
 * `friday init` — put FRIDAY's rules where she will look for them.
 *
 * FRIDAY cannot start until `paths.policiesDir` holds her authorization rules
 * (ADR-0033). Nothing creates that directory, which is why this command
 * exists: it copies the rules she ships with into the directory she decides
 * against, once, and never touches them again.
 *
 * ── The invariant ──────────────────────────────────────────────────────────
 *
 * **This command creates. It never overwrites, never merges, never deletes,
 * and never authors a rule.** A populated policy directory is the owner's, and
 * the only safe thing to do with it is leave it alone and say so — init cannot
 * tell a rule the owner edited from a shipped one that has moved on, and
 * guessing wrong replaces the mechanism of consent.
 *
 * That is also why this may run before the Guardian exists without becoming a
 * back door. It can bring absent things into being and cannot alter anything
 * present, so it has no power over a FRIDAY that already exists.
 *
 * Reference: docs/adr/0035-first-run-provisioning-is-creation-only.md
 */

/**
 * The file whose location tells us where the shipped rules are.
 *
 * A README rather than a rule file, because `tools/scripts/check-docs.mjs`
 * fails the build when any directory lacks one — so this anchor cannot quietly
 * disappear, whereas rule files are the owner's to add and remove.
 *
 * ★ Resolution proves the *export mapping*, not the file. `import.meta.resolve`
 * returns a path for an exports subpath without checking anything is there, so
 * a `files` regression in `@friday/guardian` surfaces at the directory read
 * below rather than here. `tests/architecture/packaging.test.ts` is what
 * catches that at build time.
 */
const SHIPPED_POLICIES_ANCHOR = '@friday/guardian/policies/README.md'

/**
 * Locates the rules FRIDAY ships with.
 *
 * Resolved through the package rather than by walking up from this file, so
 * the answer is the same in the workspace and in an installed copy. ADR-0033
 * rejected resolving this path *at runtime*; here it is a copy source read
 * once, before FRIDAY runs, and the runtime still loads one directory only.
 *
 * @returns The directory holding the shipped rule files, or why it was not found.
 */
function shippedPolicies(): Result<string, FridayError> {
  try {
    return ok(dirname(fileURLToPath(import.meta.resolve(SHIPPED_POLICIES_ANCHOR))))
  } catch (cause) {
    return err(
      fridayError({
        code: 'POLICY_INVALID',
        message:
          'FRIDAY could not find the rules she ships with. This is a fault in the ' +
          'installation rather than anything you have done — the rules should be part ' +
          'of the package and are not.',
        detail: { anchor: SHIPPED_POLICIES_ANCHOR },
        cause,
      }),
    )
  }
}

/**
 * Lists the rule files in a directory.
 *
 * `*.json` only, because that is exactly what `loadPolicySet` reads. Sorted so
 * the report is stable — file order carries no meaning to the Guardian
 * (ADR-0025), and it should not appear to carry any here either.
 */
function ruleFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

/** What init did, so the caller can report it without re-deriving it. */
interface SeedOutcome {
  readonly kind: 'copied' | 'left-alone'
  readonly files: readonly string[]
}

/**
 * Copies the shipped rules into the owner's policy directory.
 *
 * Creates the directory when it is absent, and populates it when it exists but
 * holds no rules — an empty directory carries no intent, and leaving it empty
 * would leave FRIDAY unable to start, since the loader refuses an empty rule
 * set rather than treating it as "deny everything".
 *
 * @param directory - The configured `paths.policiesDir`.
 * @returns What was done, or why it could not be.
 */
function seedPolicies(directory: string): Result<SeedOutcome, FridayError> {
  const source = shippedPolicies()
  if (!source.ok) return err(source.error)

  let shipped: string[]

  try {
    shipped = ruleFiles(source.value)
  } catch (cause) {
    // Resolution succeeded and the directory is not there — the packaging
    // fault ADR-0033 predicted, surfacing exactly where it was expected to.
    return err(
      fridayError({
        code: 'POLICY_INVALID',
        message:
          `FRIDAY found where her shipped rules should be — ${source.value} — but there ` +
          'is nothing there. This is a fault in the installation.',
        detail: { source: source.value },
        cause,
      }),
    )
  }

  if (shipped.length === 0) {
    return err(
      fridayError({
        code: 'POLICY_SET_EMPTY',
        message:
          'FRIDAY ships with no authorization rules, which cannot be right. Rather than ' +
          'set up a FRIDAY that would refuse everything, she has stopped.',
        detail: { source: source.value },
      }),
    )
  }

  if (existsSync(directory)) {
    const existing = ruleFiles(directory)

    // The normal second run. Never overwritten, never merged, never diffed —
    // init cannot tell a rule you changed from a shipped one that moved on.
    if (existing.length > 0) return ok({ kind: 'left-alone', files: existing })
  } else {
    mkdirSync(directory, { recursive: true })
  }

  for (const file of shipped) {
    // ★ COPYFILE_EXCL makes "never overwrite" a property of the syscall rather
    // than of the check above. The same reasoning as omitting `-U` when writing
    // a Keychain item: the safe behaviour should be the one the OS enforces.
    copyFileSync(join(source.value, file), join(directory, file), constants.COPYFILE_EXCL)
  }

  return ok({ kind: 'copied', files: shipped })
}

/**
 * Runs `friday init`.
 *
 * @param input - The loaded configuration and the output surface.
 * @returns The exit code.
 */
export function runInit(input: { context: CommandContext }): ExitCode {
  const { config, out } = input.context
  const directory = config.paths.policiesDir

  const seeded = seedPolicies(directory)

  if (!seeded.ok) {
    out.problem(seeded.error.message)
    out.json({ problem: seeded.error })
    return EXIT.problem
  }

  const { kind, files } = seeded.value
  out.json({ policies: { directory, action: kind, files } })

  if (kind === 'left-alone') {
    out.line(`Your authorization rules are already in ${directory}.`)
    out.line(`FRIDAY has left all ${files.length} of them exactly as they are.`)
    return EXIT.ok
  }

  out.line(`Put ${files.length} authorization rules in ${directory}.`)
  out.line('These are the rules FRIDAY obeys. They are yours to read and to change,')
  out.line('and she can never change them herself.')

  return EXIT.ok
}
