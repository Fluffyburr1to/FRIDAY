#!/usr/bin/env node
/**
 * Builds the installable artifact, and refuses to hand one over that would only
 * work here.
 *
 * ── The order, and why it is not negotiable ─────────────────────────────────
 *
 *   build → deploy → audit → extract → run
 *
 * **Build before deploy**, because on a fresh clone `pnpm install` cannot link
 * `.bin/friday` — `apps/cli/dist/index.js` does not exist yet — and a deploy of
 * an unbuilt workspace produces a bundle with no entry point. Observed, not
 * anticipated.
 *
 * **Audit before archive**, because the point is to fail here rather than on the
 * owner's machine.
 *
 * **Extract somewhere unrelated, then run**, because every packaging failure
 * this repository has met looked correct in the directory it was created in. An
 * artifact that has not been executed from a path it was not built at is an
 * artifact whose central claim is untested.
 *
 * ── Why the artifact is deployed flat ───────────────────────────────────────
 *
 * pnpm identifies an injected workspace package by the `file://` URL of the
 * directory it came from, and under the default linker that identifier becomes
 * the *name* of a directory in the virtual store:
 *
 *   @friday+cli@file++++private+tmp+friday-release-build+src+apps+cli
 *
 * The build path is therefore what the package is called, not a note about it,
 * so no amount of deleting files reaches it — measured, eleven findings survived
 * a full strip, including the `NODE_PATH` inside `.bin/friday`. `node-linker=hoisted`
 * removes the concept those names belong to: real directories, no store, nothing
 * to name after a source path. Zero findings. ADR-0038.
 *
 * The staging directory is still fixed and generic rather than random. That is
 * no longer load-bearing for the audit, but a release should not vary with where
 * it happened to be built, and the two lockfiles and the node-gyp leftovers the
 * strip removes below would otherwise carry whatever path was used.
 *
 * ── The safety property ─────────────────────────────────────────────────────
 *
 * `pnpm deploy --prod` leaves the workspace it ran in marked production-only,
 * and the next ordinary `pnpm` command there offers to delete every development
 * dependency. That has already happened once, to a live checkout. **This script
 * never runs pnpm in the repository it was invoked from.** It clones to the
 * staging directory and works only there, and it refuses to start if those two
 * are the same place.
 *
 * Usage:  node tools/scripts/release.ts [--keep]
 *
 * Reference: docs/adr/0036-packaging-delivers-friday-init-provisions.md §1, §6
 *            docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md §5, §6
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditArtifact, describeFindings } from './release-audit.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * ★ Fixed, generic, and outside any home directory — see the header. Changing
 * this changes the constant baked into every future artifact.
 */
const STAGING = '/tmp/friday-release-build'

/** Exits: `1` a stated problem, matching the CLI's convention. */
const EXIT_PROBLEM = 1

/** Runs a command, streaming nothing, and throws with context on failure. */
function run(command: string, args: readonly string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: 900_000 })
}

function say(message: string): void {
  process.stdout.write(`${message}\n`)
}

/**
 * Clones the repository into the staging directory.
 *
 * A clone of `HEAD` rather than a copy of the working tree, so what is released
 * is what is committed. Uncommitted work is reported rather than shipped.
 */
function stage(): string {
  if (resolve(STAGING) === REPO) {
    throw new Error('The staging directory is the repository. Refusing to build here.')
  }

  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })

  if (dirty.trim() !== '') {
    say('  ! the working tree has uncommitted changes; they are NOT in this artifact')
  }

  rmSync(STAGING, { recursive: true, force: true })
  mkdirSync(STAGING, { recursive: true })

  const source = join(STAGING, 'src')
  run('git', ['clone', '--local', '--no-hardlinks', REPO, source], STAGING)

  return source
}

/** Installs and builds the staged workspace. Never touches the repository. */
function build(source: string): void {
  run('pnpm', ['install', '--config.confirmModulesPurge=false'], source)
  run('pnpm', ['build'], source)

  if (!existsSync(join(source, 'apps/cli/dist/index.js'))) {
    throw new Error('The build produced no CLI entry point; a deploy now would have no `friday`.')
  }
}

/**
 * Deploys the bundle root — never `@friday/cli`.
 *
 * ── The two flags, and why both are scoped to this command ──────────────────
 *
 * **`inject-workspace-packages`** makes the deploy resolve FRIDAY's own
 * packages into real content rather than links into the source checkout
 * (ADR-0036 §1).
 *
 * **`node-linker=hoisted`** lays the result out flat, and it is here for a
 * specific reason rather than a preference. pnpm identifies an injected
 * workspace package by the `file://` URL of the directory it came from, and
 * that identifier is what names the virtual store's directories, what
 * `.package-map.json` records, and what `.bin/friday` bakes into `NODE_PATH`.
 * The build path is therefore the package's *name*, not a stray note about it,
 * and no amount of deleting files reaches it — measured, eleven findings
 * survived a full strip. Hoisting removes the concept those names belong to:
 * real directories, no virtual store, nothing to name after a source path.
 * ADR-0038.
 *
 * Neither flag is written into `pnpm-workspace.yaml`. Both change how packages
 * link, and a developer's workspace must not inherit either for a property only
 * this script needs.
 *
 * **`--legacy` is prohibited** (ADR-0036 §1) and is unaffected by any of this:
 * it produces symlinks that escape into the source checkout, which the audit
 * fails on a different rule and which no linker setting makes acceptable.
 */
function deploy(source: string): string {
  const out = join(STAGING, 'out')

  run(
    'pnpm',
    [
      '--config.inject-workspace-packages=true',
      '--config.node-linker=hoisted',
      'deploy',
      '--filter',
      '@friday/bundle',
      '--prod',
      out,
    ],
    source,
  )

  return out
}

/**
 * Removes build metadata from the artifact.
 *
 * **Every removal here was proven inert before it was written**, by deleting it
 * from a real artifact and then running the CLI and starting core from the
 * result: the CLI exited 0 and core loaded its rules, opened both databases
 * through the prebuilt driver, and stopped at the Keychain.
 *
 * They are removed rather than rewritten because none of them is read at
 * runtime — Node resolves through `node_modules`, not through any of these —
 * and because leaving a lockfile in a shipped tree invites someone to run
 * `pnpm install` inside an installed FRIDAY.
 *
 * `better-sqlite3/build/` is the surprising one. It holds **no compiled
 * binary** — only node-gyp scaffolding left by a configure step that produced
 * nothing, because the driver ships as a prebuild. Two of those files carry the
 * builder's home directory.
 */
function stripBuildMetadata(artifact: string): void {
  for (const relativePath of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'node_modules/.modules.yaml',
    // A second lockfile, written inside the virtual store. Same argument.
    'node_modules/.pnpm/lock.yaml',
  ]) {
    rmSync(join(artifact, relativePath), { force: true })
  }

  removeUnrunnableShims(artifact)

  // Located by search, not by a fixed path: the driver sits at
  // `node_modules/better-sqlite3` under the hoisted layout and sat inside the
  // virtual store before it, and a hard-coded path would silently stop removing
  // anything the day the layout moved — leaving the leak it exists to remove.
  const driverBuild = findDriverBuild(join(artifact, 'node_modules'))

  if (driverBuild !== undefined) rmSync(driverBuild, { recursive: true, force: true })

  // The deployed manifest names its workspace dependencies by absolute
  // `file://` URL into the staging tree. Nothing resolves through it — the
  // tree is already materialised — so the specifier is replaced rather than
  // the field removed, which keeps the manifest a truthful list of contents.
  const manifestPath = join(artifact, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }

  if (manifest.dependencies !== undefined) {
    for (const name of Object.keys(manifest.dependencies)) manifest.dependencies[name] = '*'
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Removes dependency command-line shims that cannot survive relocation.
 *
 * ★ Not a tidy-up. pnpm writes two kinds of shim: `.bin/friday` computes its
 * own location (`basedir=$(dirname "$0")`) and therefore relocates, while the
 * shims for `tsc`, `tsserver`, `pino`, and `intent` hard-code an absolute
 * `NODE_PATH` into the directory they were generated in. Those four are broken
 * the moment the artifact moves — they are *the* case of an executable that
 * requires the build machine's filesystem.
 *
 * They are removed rather than repaired because **nothing in FRIDAY runs any of
 * them.** They arrive as transitive command-line entry points of libraries she
 * uses as libraries: `pino` is imported by `@friday/telemetry`, and TypeScript
 * is a peer of `@trpc/server`. Verified by deleting them from a real artifact
 * and then running it — the CLI exited 0, and core loaded its rules, opened
 * both databases, and stopped at the Keychain.
 *
 * This deliberately touches no directory name and no symlink target.
 */
function removeUnrunnableShims(artifact: string): void {
  const unused = new Set(['tsc', 'tsserver', 'pino', 'intent'])

  for (const binDirectory of findBinDirectories(join(artifact, 'node_modules'))) {
    for (const name of readdirSync(binDirectory)) {
      if (unused.has(name)) rmSync(join(binDirectory, name), { force: true })
    }
  }
}

/** The SQLite driver's leftover node-gyp directory, wherever the layout put it. */
function findDriverBuild(modules: string): string | undefined {
  const visit = (directory: string): string | undefined => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue

      const path = join(directory, entry.name)

      if (entry.name === 'better-sqlite3' && existsSync(join(path, 'build'))) {
        return join(path, 'build')
      }

      const found = visit(path)
      if (found !== undefined) return found
    }

    return undefined
  }

  return visit(modules)
}

/** Every `.bin` directory beneath a root, without following symlinks. */
function findBinDirectories(root: string): string[] {
  const found: string[] = []

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue

      const path = join(directory, entry.name)

      if (entry.name === '.bin') found.push(path)
      else visit(path)
    }
  }

  visit(root)

  return found
}

/**
 * Fails the release unless the artifact is genuinely self-contained.
 *
 * The forbidden set is the staging path and the builder's home. Both are
 * absolute, so upstream documentation strings like `/Users/me` in SQLite's
 * amalgamation do not trip it — a gate nobody can ever satisfy gets disabled.
 */
function audit(artifact: string, label: string): void {
  const findings = auditArtifact({ root: artifact, forbidden: [STAGING, homedir()] })

  if (findings.length > 0) {
    process.stderr.write(`\nThe artifact failed the relocation audit (${label}):\n`)
    process.stderr.write(`${describeFindings(findings)}\n\n`)
    process.stderr.write(
      "A release must not carry the build machine's filesystem, or need it to run.\n" +
        'This is not a warning to pass; the release stops here.\n',
    )

    process.exit(EXIT_PROBLEM)
  }

  say(`  audit passed (${label})`)
}

/**
 * Proves the artifact runs somewhere it was not built.
 *
 * `friday status --help` rather than `friday --help`: the latter prints the
 * usage banner and exits **2** by design, because a bare invocation with no
 * subcommand is a usage error. Asserting on exit 0 there would fail forever.
 *
 * Core is started with a Keychain service that cannot exist, so the expected
 * end is a stated refusal at the key it cannot read — which is reached only
 * after the rules have loaded and both databases have been opened through the
 * native driver. That is the deepest signal available without provisioning a
 * real Keychain, which a release script has no business doing.
 */
function proveRelocation(archive: string): void {
  const elsewhere = mkdtempSync(join(tmpdir(), 'friday-relocated-'))

  run('tar', ['-xzf', archive, '-C', elsewhere], elsewhere)
  audit(elsewhere, 'after extraction')

  // ★ `spawnSync` rather than `execFileSync`, and stderr rather than stdout.
  // `createOutput().problem()` writes to stderr in both modes deliberately, so
  // that `friday verify --json | jq` still shows the reason when it fails —
  // which means the usage text this asserts on never appears on stdout. Reading
  // the wrong stream made a working artifact look broken.
  const cli = spawnSync(join(elsewhere, 'node_modules/.bin/friday'), ['status', '--help'], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (cli.status !== 0) {
    throw new Error(`The relocated CLI exited ${cli.status}:\n${cli.stderr}`)
  }

  if (!`${cli.stdout}${cli.stderr}`.includes('friday')) {
    throw new Error('The relocated CLI printed nothing recognisable.')
  }

  say('  relocated CLI ran')

  const data = mkdtempSync(join(tmpdir(), 'friday-relocated-data-'))
  mkdirSync(join(data, 'policies'), { recursive: true })
  seedPolicies(elsewhere, join(data, 'policies'))

  const outcome = startCore(elsewhere, data)

  if (outcome.status !== EXIT_PROBLEM || !outcome.stderr.includes('Keychain')) {
    throw new Error(
      `The relocated core did not reach its Keychain check: exit ${outcome.status}\n${outcome.stderr}`,
    )
  }

  for (const database of ['events.db', 'friday.db']) {
    if (!existsSync(join(data, database))) {
      throw new Error(
        `The relocated core did not open ${database}; the native driver did not load.`,
      )
    }
  }

  say('  relocated core loaded its rules, opened both databases, and stopped at the Keychain')

  rmSync(elsewhere, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
}

/** Copies the artifact's own shipped rules into a policy directory. */
function seedPolicies(artifact: string, into: string): void {
  const probe = join(artifact, 'node_modules/@friday/cli/seed-probe.mjs')

  writeFileSync(
    probe,
    "import { cpSync, readdirSync } from 'node:fs'\n" +
      "import { dirname, join } from 'node:path'\n" +
      "import { fileURLToPath } from 'node:url'\n" +
      "const from = dirname(fileURLToPath(import.meta.resolve('@friday/guardian/policies/README.md')))\n" +
      'for (const f of readdirSync(from).filter((n) => n.endsWith(".json")))\n' +
      '  cpSync(join(from, f), join(process.argv[2], f))\n',
  )

  try {
    run(process.execPath, [probe, into], artifact)
  } finally {
    rmSync(probe, { force: true })
  }
}

/** Starts core through the installed symlinked layout and reports how it ended. */
function startCore(artifact: string, data: string): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [join(artifact, 'node_modules/@friday/core/dist/index.js')], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        FRIDAY_DATA_DIR: data,
        FRIDAY_POLICIES_DIR: join(data, 'policies'),
        FRIDAY_KEYCHAIN_SERVICE: 'com.friday.release-proof.invalid',
      },
    })

    return { status: 0, stderr: '' }
  } catch (cause) {
    const ended = cause as { status?: unknown; stderr?: unknown }

    return {
      status: typeof ended.status === 'number' ? ended.status : -1,
      stderr: typeof ended.stderr === 'string' ? ended.stderr : '',
    }
  }
}

/**
 * Reports how the artifact's version relates to the release tag.
 *
 * **It does not invent one.** ADR-0036 §6 makes a git tag the release, and the
 * repository has no tags yet, so there is nothing to agree with and this says
 * so rather than writing a number that would become a second answer.
 */
function reportVersion(artifact: string): void {
  const manifest = JSON.parse(readFileSync(join(artifact, 'package.json'), 'utf8')) as {
    version?: string
  }

  const tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '')

  if (tags.length === 0) {
    say(`  version ${manifest.version} — no tag on HEAD, so nothing claims a release version yet`)
    return
  }

  say(`  version ${manifest.version} — tag on HEAD: ${tags.join(', ')}`)
  say('  ! nothing reconciles these yet; the tag is authoritative (ADR-0036 §6)')
}

function main(): void {
  say('Building FRIDAY.')

  const source = stage()
  say(`  staged at ${STAGING}`)

  build(source)
  say('  built')

  const artifact = deploy(source)
  stripBuildMetadata(artifact)
  say('  deployed @friday/bundle')

  audit(artifact, 'as deployed')

  const archive = join(STAGING, 'friday.tgz')
  run('tar', ['-czf', archive, '-C', artifact, '.'], STAGING)
  say('  archived')

  proveRelocation(archive)
  reportVersion(artifact)

  const kept = join(REPO, 'friday.tgz')
  cpSync(archive, kept)

  say(`\nReady: ${kept}`)
  say('This artifact was extracted somewhere else and run before you were told about it.')
}

if (import.meta.main) {
  try {
    main()
  } catch (cause) {
    process.stderr.write(`\n${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(EXIT_PROBLEM)
  }
}
