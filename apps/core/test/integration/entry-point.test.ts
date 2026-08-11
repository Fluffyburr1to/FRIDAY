import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * That friday-core runs at all when she is started the way she is installed.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 *
 * This file guarded its entry point by comparing
 * `fileURLToPath(import.meta.url)` against `process.argv[1]`. In the workspace
 * those agree. In an installed copy they cannot: `node_modules/@friday/core` is
 * a symlink into pnpm's virtual store, Node resolves `import.meta.url` to the
 * real path, and `process.argv[1]` stays the path that was invoked. `main()`
 * was therefore never called.
 *
 * **The failure had no symptom.** Exit 0, nothing on stdout, nothing on stderr.
 * Under the supervision that starts FRIDAY at login — `RunAtLoad`,
 * unconditional `KeepAlive`, `ThrottleInterval 10` — that is a relaunch every
 * ten seconds, forever, each one reported as a success, with nothing in any log
 * because the code that opens the log is never reached.
 *
 * ── Why the test spawns through a symlink ───────────────────────────────────
 *
 * The condition is a disagreement between two paths, so it only exists in a
 * process started through a real symlink. A unit test of a helper could not
 * have this bug, and could not have caught it: there was no helper, and the
 * defect was in how the process identified itself. This builds the installed
 * shape and starts it.
 *
 * ── Why "refuses to start" is the evidence that it started ──────────────────
 *
 * Reaching a stated refusal proves `main()` ran. A missing policy directory is
 * the first thing startup checks, before any database is opened and before any
 * key is read, so this never touches the machine's Keychain and behaves the
 * same on the Ubuntu CI runner.
 *
 * Reference: docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md §4
 */

/** The `apps/core` package directory — what pnpm symlinks into a bundle. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The CLI's convention, restated here because core cannot import the CLI. */
const EXIT = { ok: 0, problem: 1 } as const

interface Ended {
  readonly status: number
  readonly stderr: string
}

/**
 * Starts core from a given entry path and reports how it ended.
 *
 * `execFileSync` throws on a non-zero exit, which is the case every assertion
 * here is about, so the status is read off the thrown error rather than from a
 * return value that only exists on success.
 */
function startCore(entry: string, env: Readonly<Record<string, string>>): Ended {
  try {
    execFileSync(process.execPath, [entry], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...env },
    })

    return { status: EXIT.ok, stderr: '' }
  } catch (cause) {
    const ended = cause as { status?: unknown; stderr?: unknown }

    return {
      status: typeof ended.status === 'number' ? ended.status : -1,
      stderr: typeof ended.stderr === 'string' ? ended.stderr : '',
    }
  }
}

describe('starting friday-core the way she is installed', () => {
  let directory: string
  let linkedEntry: string
  let environment: Record<string, string>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-entry-point-'))

    // The installed shape: a symlink standing where `node_modules/@friday/core`
    // stands in a bundle, pointing at the package directory.
    const link = join(directory, 'core')
    symlinkSync(PACKAGE_ROOT, link, 'dir')
    linkedEntry = join(link, 'dist', 'index.js')

    environment = {
      FRIDAY_DATA_DIR: directory,
      FRIDAY_POLICIES_DIR: join(directory, 'not-here'),
    }
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('is genuinely started through a path that differs from its real one', () => {
    // ★ The precondition, asserted rather than assumed. If a filesystem or a
    // CI runner ever resolved this symlink away, every test below would pass
    // while exercising nothing, and the regression would be silently unguarded.
    expect(resolve(linkedEntry)).not.toBe(realpathSync(linkedEntry))
  })

  it('runs its startup path when invoked through the symlink', () => {
    const ended = startCore(linkedEntry, environment)

    expect(ended.stderr).toContain('authorization rules')
  })

  it('does not exit reporting success without having done anything', () => {
    // This is the regression itself. `0` here means she was started, said
    // nothing, and stopped — which supervision reads as a healthy run and
    // repeats every ten seconds for as long as the machine is on.
    const ended = startCore(linkedEntry, environment)

    expect(ended.status).not.toBe(EXIT.ok)
    expect(ended.status).toBe(EXIT.problem)
  })

  it('behaves the same whether it is reached directly or through the symlink', () => {
    const direct = startCore(join(PACKAGE_ROOT, 'dist', 'index.js'), environment)
    const linked = startCore(linkedEntry, environment)

    expect(linked.status).toBe(direct.status)
    expect(linked.stderr).toBe(direct.stderr)
  })
})
