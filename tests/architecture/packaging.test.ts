import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What actually ships inside a package.
 *
 * ── Why this tier and not a package's own tests ─────────────────────────────
 *
 * Every other test in this repository runs against the *workspace*, where pnpm
 * links a package to its source directory and every file is present whether or
 * not it is published. That makes the workspace a poor witness for a question
 * this repository has already been bitten by once: **which files leave the
 * repository when a package is built?**
 *
 * ADR-0033 found that `packages/guardian` declared `"files": ["dist"]`, so the
 * authorization rules the owner reviews were not in the package at all — and
 * recorded that any runtime path resolving them through the package "would work
 * perfectly in development, in CI, and in every test, and would find no rules
 * at all the first time FRIDAY is packaged."
 *
 * ADR-0035 makes `friday init` depend on those rules shipping. So the guarantee
 * has to be checked against the packed artifact rather than against the working
 * tree, and it has to be checked somewhere that is not the package's own suite,
 * because the package's own suite is exactly what would keep passing.
 *
 * ── Why the shipped policies specifically ───────────────────────────────────
 *
 * `friday init` copies them into `paths.policiesDir` on first run. If they stop
 * shipping, `import.meta.resolve` still succeeds — it validates the `exports`
 * mapping, not the file — and the failure surfaces on the owner's machine as a
 * missing directory. This test is the only thing that turns that into a build
 * failure instead.
 *
 * Reference: docs/adr/0033-authorization-rules-are-loaded-from-a-configured-directory.md
 *            docs/adr/0035-first-run-provisioning-is-creation-only.md
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

interface PackedFile {
  path: string
}

/**
 * Asks npm what a package would publish, without writing a tarball.
 *
 * `--dry-run` so this leaves nothing behind, and `--json` so the answer is the
 * file list itself rather than something parsed out of console formatting.
 */
function packedFiles(packageDir: string): string[] {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: resolve(ROOT, packageDir),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  const parsed = JSON.parse(output) as Array<{ files: PackedFile[] }>
  const entry = parsed[0]

  if (entry === undefined) throw new Error(`npm pack reported nothing for ${packageDir}`)

  return entry.files.map((file) => file.path)
}

describe('@friday/guardian ships the rules FRIDAY is set up with', () => {
  const files = packedFiles('packages/guardian')

  it('includes the shipped policy files', () => {
    const policies = files.filter((path) => path.startsWith('policies/') && path.endsWith('.json'))

    // The message matters more than the assertion here: whoever breaks this is
    // editing a manifest, not this test, and needs telling what it costs.
    expect(
      policies.length,
      'packages/guardian no longer publishes policies/*.json. `friday init` seeds the ' +
        "owner's authorization rules from these files, so without them a packaged FRIDAY " +
        'has no rules to be set up with. Check "files" in packages/guardian/package.json.',
    ).toBeGreaterThan(0)
  })

  it('publishes every rule file the workspace holds, not merely some', () => {
    // A partial copy is worse than none: the Guardian would load, and quietly
    // enforce fewer rules than the owner reviewed — with nothing to show which
    // ones went missing.
    const packed = files
      .filter((path) => path.startsWith('policies/') && path.endsWith('.json'))
      .map((path) => path.slice('policies/'.length))
      .sort()

    const onDisk = readdirSync(resolve(ROOT, 'packages/guardian/policies'))
      .filter((name) => name.endsWith('.json'))
      .sort()

    expect(packed).toEqual(onDisk)
  })

  it('keeps the anchor that init resolves the directory by', () => {
    // init locates the directory via `@friday/guardian/policies/README.md`.
    // If that stops shipping, resolution still succeeds and the read fails.
    expect(files).toContain('policies/README.md')
  })
})
