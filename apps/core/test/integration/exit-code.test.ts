import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The code friday-core exits with when it refuses to start.
 *
 * ── Why this is a spawned process and not a function call ────────────────────
 *
 * `main()` reports a fatal startup fault by calling `process.exit`, so the
 * value under test only exists in a real process. Importing `main` and
 * asserting on a mock would test the mock; the thing launchd reads is the wait
 * status of a process that has ended, and that is what this runs.
 *
 * ── Why the code matters ────────────────────────────────────────────────────
 *
 * The CLI reserves `1` for a problem it found and `2` for being invoked wrongly
 * (`apps/cli/src/output.ts`). Core used to exit `2` for every startup fault
 * while its comment claimed to match that convention, so a machine that could
 * not start FRIDAY reported it in the code that means the command was typed
 * wrong. `launchctl list` surfaces the last exit status, and Chapter 39 carried
 * this as an M4 risk to settle at the first consumer — launchd is that
 * consumer.
 *
 * ── Why a missing policy directory is the fault chosen ──────────────────────
 *
 * It is the first thing `openContext` checks, before any database is opened and
 * before any key is read, so this test reaches the exit path without touching
 * the machine's Keychain and runs identically on the Ubuntu CI runner.
 *
 * Reference: docs/01-bible/39-roadmap.md (carried M4 implementation risks)
 *            docs/01-bible/33-deployment-strategy.md
 */

const ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url))

/** The CLI's convention, restated here because core cannot import the CLI. */
const EXIT = { problem: 1, usage: 2 } as const

interface Ended {
  readonly status: number
  readonly stderr: string
}

/**
 * Runs the built entry point to completion and reports how it ended.
 *
 * `execFileSync` throws on a non-zero exit, which is the case every assertion
 * here is about, so the status is read off the thrown error rather than from a
 * return value that only exists on success.
 */
function startCore(env: Readonly<Record<string, string>>): Ended {
  try {
    execFileSync(process.execPath, [ENTRY], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...env },
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

describe('friday-core refusing to start', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-exit-code-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('exits with the code meaning "a problem was found"', () => {
    const ended = startCore({
      FRIDAY_DATA_DIR: directory,
      FRIDAY_POLICIES_DIR: join(directory, 'not-here'),
    })

    expect(ended.status).toBe(EXIT.problem)
  })

  it('does not exit with the code the CLI reserves for being invoked wrongly', () => {
    // Stated separately from the assertion above because this is the property
    // that was wrong, and a future edit that reintroduced `2` would otherwise
    // read as a change of convention rather than as the regression it is. Core
    // takes no arguments, so it can never be invoked wrongly.
    const ended = startCore({
      FRIDAY_DATA_DIR: directory,
      FRIDAY_POLICIES_DIR: join(directory, 'not-here'),
    })

    expect(ended.status).not.toBe(EXIT.usage)
  })

  it('says what it could not do before exiting', () => {
    // An exit code alone is not an explanation. Whoever reads `launchctl list`
    // gets a number; whoever reads the agent's stderr log needs the sentence.
    const ended = startCore({
      FRIDAY_DATA_DIR: directory,
      FRIDAY_POLICIES_DIR: join(directory, 'not-here'),
    })

    expect(ended.stderr).toContain('authorization rules')
  })
})
