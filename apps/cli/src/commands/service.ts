import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode } from '../output.js'

/**
 * `friday service install` / `friday service uninstall` — keeping her alive.
 *
 * ── What owns this ──────────────────────────────────────────────────────────
 *
 * **A `friday` subcommand owns the launchd boundary, and the installer does
 * not.** Unpacking FRIDAY writes to one directory and touches nothing in your
 * login session; making her start at login is a separate act, run deliberately,
 * by a command whose name is what it does. ADR-0036 §5.
 *
 * `service install` loads the agent after writing it, because running the
 * command *is* the consent and making you type `launchctl` afterwards is
 * friction with no decision in it. It prints exactly what undoes it.
 *
 * ── The creation-only bound, inherited ──────────────────────────────────────
 *
 * `install` refuses when the plist already exists and names `uninstall` as the
 * way through. `uninstall` removes a file **only** when it can prove FRIDAY
 * wrote it — the `Label` must be ours and the program path must point inside a
 * FRIDAY install. It will not delete a plist it cannot account for, which is
 * the same reasoning as `friday init` declining to mint a key beside a database
 * it did not create.
 *
 * ── Why this does not import `@friday/core` ─────────────────────────────────
 *
 * It resolves a *path* and never a module. The CLI must keep working when the
 * kernel does not — that is the whole reason it is a separate app — so it
 * locates core's entry point on disk, checks it is there, and hands the string
 * to launchd. Importing it would make `friday panic` load the thing it is being
 * used to recover from.
 *
 * Reference: docs/adr/0036-packaging-delivers-friday-init-provisions.md §5
 *            docs/01-bible/33-deployment-strategy.md
 */

/** The agent's name. Hard-coded: `uninstall` proves ownership by it. */
export const SERVICE_LABEL = 'com.friday.core'

/** Where a LaunchAgent lives. Per-user, never `/Library/LaunchDaemons`. */
function agentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
}

/**
 * Everything the template needs, resolved from the running copy.
 *
 * Exported for its tests: rendering is the part that must be verifiable
 * without a Mac, a Keychain, or `launchctl`.
 */
export interface ServicePaths {
  /** The artifact root — the directory holding `node_modules`. */
  readonly artifact: string

  /** `apps/core`'s entry point inside that artifact. */
  readonly coreEntry: string

  /** The Node that will run her. Absolute: launchd has no useful PATH. */
  readonly node: string

  readonly stdoutLog: string
  readonly stderrLog: string
}

/**
 * Locates the installed artifact by asking where this file is.
 *
 * ★ Self-location rather than configuration, because the alternative is a path
 * someone types and gets wrong. A packaged `friday` lives at
 * `<artifact>/node_modules/@friday/cli/dist/index.js`, so the artifact root is
 * four directories up, and core sits beside it under the same `node_modules`.
 *
 * **Run from a source checkout this returns an error rather than a guess.** In
 * the workspace the same arithmetic yields the directory *above* the
 * repository, and a service pointing into somebody's projects folder is worse
 * than no service — it would appear to work until the checkout moved.
 *
 * @param moduleUrl - `import.meta.url` of a module inside the CLI package.
 * @returns The resolved paths, or why this copy cannot install a service.
 */
export function resolveServicePaths(input: {
  moduleUrl: string
  execPath: string
  logDirectory: string
}): Result<ServicePaths, FridayError> {
  const here = dirname(fileURLToPath(input.moduleUrl))
  const artifact = resolve(here, '..', '..', '..', '..', '..')
  const coreEntry = join(artifact, 'node_modules', '@friday', 'core', 'dist', 'index.js')

  if (!existsSync(coreEntry)) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          'FRIDAY can only install her service from an installed copy of herself.\n\n' +
          '  This `friday` is running from a source checkout, where there is no packaged\n' +
          '  FRIDAY for the service to point at. A service installed from here would\n' +
          '  break the moment the checkout moved or was rebuilt.\n\n' +
          '  Build an artifact with `node tools/scripts/release.ts`, unpack it, and run\n' +
          '  `friday service install` from there.',
        detail: { expected: coreEntry },
      }),
    )
  }

  return ok({
    artifact,
    coreEntry,
    node: input.execPath,
    stdoutLog: join(input.logDirectory, 'friday-core.out.log'),
    stderrLog: join(input.logDirectory, 'friday-core.err.log'),
  })
}

/**
 * Fills the template in.
 *
 * Exported so a test can read the result without installing anything. Every
 * substitution is a path this process resolved; **nothing derived from
 * configuration secrets, and no environment block, reaches the plist** — a
 * plist is world-readable and survives in backups.
 *
 * @param template - The contents of `com.friday.core.plist.tmpl`.
 * @param paths - What to substitute.
 * @returns The plist to write.
 */
export function renderPlist(template: string, paths: ServicePaths): string {
  const values: Record<string, string> = {
    LABEL: SERVICE_LABEL,
    NODE: paths.node,
    CORE_ENTRY: paths.coreEntry,
    STDOUT_LOG: paths.stdoutLog,
    STDERR_LOG: paths.stderrLog,
    WORKING_DIRECTORY: paths.artifact,
  }

  return template.replace(/{{([A-Z_]+)}}/g, (whole, key: string) => values[key] ?? whole)
}

/** Reads the template that ships beside the installed CLI. */
function readTemplate(artifact: string): Result<string, FridayError> {
  const path = join(artifact, 'share', `${SERVICE_LABEL}.plist.tmpl`)

  try {
    return ok(readFileSync(path, 'utf8'))
  } catch (cause) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          'FRIDAY could not find the service definition she ships with. This is a fault ' +
          'in the installation rather than anything you have done.',
        detail: { path },
        cause,
      }),
    )
  }
}

/**
 * Reports whether a plist is one FRIDAY wrote.
 *
 * ★ Both halves are required, and the second is the one that matters. A file
 * named `com.friday.core.plist` proves nothing — anyone can write one. What
 * `uninstall` needs before deleting is evidence that this file points at a
 * FRIDAY, and the program path is that evidence.
 *
 * Exported for its tests: a deletion guard nobody has watched refuse is a
 * deletion guard that is assumed to work.
 *
 * @param contents - The plist on disk.
 * @returns Whether it is safe to remove.
 */
export function isOurs(contents: string): boolean {
  const labelled = contents.includes(`<string>${SERVICE_LABEL}</string>`)
  const pointsAtFriday = /<string>[^<]*node_modules\/@friday\/core\/dist\/index\.js<\/string>/.test(
    contents,
  )

  return labelled && pointsAtFriday
}

/** Runs `launchctl`, returning its complaint rather than throwing. */
function launchctl(args: readonly string[]): Result<void, string> {
  try {
    execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    return ok(undefined)
  } catch (cause) {
    const failure = cause as { stderr?: unknown }

    return err(typeof failure.stderr === 'string' ? failure.stderr.trim() : String(cause))
  }
}

/**
 * Runs `friday service install`.
 *
 * @param input - The loaded context.
 * @returns The exit code.
 */
export function runServiceInstall(input: { context: CommandContext }): ExitCode {
  const { config, out } = input.context
  const plistPath = agentPath()

  if (existsSync(plistPath)) {
    out.problem(
      `FRIDAY already has a service installed at ${plistPath}.\n\n` +
        '  She has changed nothing. Remove it with `friday service uninstall` first if\n' +
        '  you meant to replace it.',
    )
    out.json({ problem: { code: 'ALREADY_INSTALLED', path: plistPath } })

    return EXIT.problem
  }

  const paths = resolveServicePaths({
    moduleUrl: import.meta.url,
    execPath: process.execPath,
    logDirectory: config.logging.directory,
  })

  if (!paths.ok) {
    out.problem(paths.error.message)
    out.json({ problem: paths.error })

    return EXIT.problem
  }

  const template = readTemplate(paths.value.artifact)

  if (!template.ok) {
    out.problem(template.error.message)
    out.json({ problem: template.error })

    return EXIT.problem
  }

  // launchd discards output when the directory is absent, which would leave a
  // failure to start with nothing to read. This is not under `dataDir` — that
  // directory belongs to `friday init` and packaging may not create it.
  mkdirSync(config.logging.directory, { recursive: true })
  mkdirSync(dirname(plistPath), { recursive: true })

  writeFileSync(plistPath, renderPlist(template.value, paths.value), { mode: 0o644 })

  const loaded = launchctl(['load', '-w', plistPath])

  if (!loaded.ok) {
    out.problem(
      `FRIDAY wrote her service definition to ${plistPath}, but macOS refused to start it:\n\n` +
        `  ${loaded.error}\n\n` +
        '  The file is still there. `friday service uninstall` removes it.',
    )
    out.json({ problem: { code: 'LOAD_FAILED', path: plistPath, detail: loaded.error } })

    return EXIT.problem
  }

  out.json({
    service: {
      label: SERVICE_LABEL,
      plist: plistPath,
      coreEntry: paths.value.coreEntry,
      logs: { stdout: paths.value.stdoutLog, stderr: paths.value.stderrLog },
    },
  })

  report({ out, paths: paths.value, plistPath })

  return EXIT.ok
}

/** Says what happened, and what undoes it. */
function report(input: {
  out: CommandContext['out']
  paths: ServicePaths
  plistPath: string
}): void {
  const { out, paths, plistPath } = input

  out.line('FRIDAY will now start when you log in.')
  out.line('')
  out.line(`  service   ${SERVICE_LABEL}`)
  out.line(`  defined   ${plistPath}`)
  out.line(`  running   ${paths.coreEntry}`)
  out.line(`  logs      ${paths.stderrLog}`)
  out.line('')
  out.line('If she will not start, that error log is where she says why.')
  out.line('')
  out.line('To stop her starting at login:')
  out.line('')
  out.line('  friday service uninstall')
}

/**
 * Runs `friday service uninstall`.
 *
 * @param input - The loaded context.
 * @returns The exit code.
 */
export function runServiceUninstall(input: { context: CommandContext }): ExitCode {
  const { out } = input.context
  const plistPath = agentPath()

  if (!existsSync(plistPath)) {
    out.line('FRIDAY has no service installed. Nothing to remove.')
    out.json({ service: null })

    return EXIT.ok
  }

  let contents: string

  try {
    contents = readFileSync(plistPath, 'utf8')
  } catch (cause) {
    out.problem(`FRIDAY could not read ${plistPath}, so she has not touched it.`)
    out.json({ problem: { code: 'UNREADABLE', path: plistPath, detail: String(cause) } })

    return EXIT.problem
  }

  if (!isOurs(contents)) {
    out.problem(
      `There is a file at ${plistPath} that FRIDAY did not write.\n\n` +
        '  It carries her name but does not point at any FRIDAY she can find, so she has\n' +
        '  left it exactly as it is. Removing something she cannot account for is not\n' +
        '  something she will do on your behalf.\n\n' +
        '  Delete it yourself if you are sure it is hers.',
    )
    out.json({ problem: { code: 'NOT_OURS', path: plistPath } })

    return EXIT.problem
  }

  // Unload first. Removing the file from underneath a running agent leaves
  // launchd supervising a process whose definition no longer exists.
  const unloaded = launchctl(['unload', '-w', plistPath])

  if (!unloaded.ok) {
    out.problem(
      `macOS would not stop FRIDAY's service:\n\n  ${unloaded.error}\n\n` +
        '  Her service definition has been left in place rather than removed while she\n' +
        '  is still supervised.',
    )
    out.json({ problem: { code: 'UNLOAD_FAILED', path: plistPath, detail: unloaded.error } })

    return EXIT.problem
  }

  try {
    execFileSync('/bin/rm', ['-f', plistPath], { timeout: 10_000, stdio: 'ignore' })
  } catch (cause) {
    out.problem(`FRIDAY stopped her service but could not remove ${plistPath}.`)
    out.json({ problem: { code: 'REMOVE_FAILED', path: plistPath, detail: String(cause) } })

    return EXIT.problem
  }

  out.json({ service: { label: SERVICE_LABEL, removed: plistPath } })

  out.line('FRIDAY will no longer start when you log in.')
  out.line('')
  out.line(`  removed   ${plistPath}`)
  out.line('')
  out.line('Nothing else was touched — her rules, her keys, and everything she has')
  out.line('recorded are exactly where they were.')

  return EXIT.ok
}
