import { describe, expect, it } from 'vitest'
import { isRegistered, launchctlFailure, serviceTarget } from '../../src/commands/launchd.js'

/**
 * Telling a `launchctl` success from a `launchctl` failure.
 *
 * ── The measurement this exists because of ──────────────────────────────────
 *
 * On macOS 26.6, run against a job that is not loaded:
 *
 *   $ launchctl unload -w /tmp/notloaded.plist
 *   Unload failed: 5: Input/output error
 *   $ echo $?
 *   0
 *
 * **It printed a failure and exited zero.** The first version of this code
 * trusted the exit status, which meant `friday service install` could tell the
 * owner FRIDAY would start at login when launchd had refused the job outright —
 * a false claim about whether her assistant exists.
 *
 * These run anywhere: the rule under test is how a result is *interpreted*, and
 * the results are supplied rather than produced. What `launchctl` actually
 * prints on a given macOS is not, and cannot be, tested here.
 *
 * Reference: docs/01-bible/33-deployment-strategy.md
 */

describe('deciding whether launchctl succeeded', () => {
  it('treats a clean exit with no complaint as success', () => {
    expect(launchctlFailure({ status: 0, stdout: '', stderr: '' })).toBeUndefined()
  })

  it('★ treats exit 0 with a failure on stderr as a failure', () => {
    // The measured case, verbatim.
    const reason = launchctlFailure({
      status: 0,
      stdout: '',
      stderr: 'Unload failed: 5: Input/output error\n',
    })

    expect(reason).toBe('Unload failed: 5: Input/output error')
  })

  it('catches the other words launchd fails with', () => {
    for (const said of [
      'Bootstrap failed: 5: Input/output error',
      'Error: Operation not permitted',
      'Load failed: 37: Operation already in progress',
      'Operation not permitted while System Integrity Protection is engaged',
    ]) {
      expect(launchctlFailure({ status: 0, stdout: '', stderr: said })).toBeDefined()
    }
  })

  it('reports why when the status is non-zero', () => {
    expect(launchctlFailure({ status: 3, stdout: '', stderr: 'no such service' })).toBe(
      'no such service',
    )
  })

  it('still reports a failure when a non-zero exit said nothing at all', () => {
    // Silence plus a bad status must not read as success by falling through.
    expect(launchctlFailure({ status: 1, stdout: '', stderr: '' })).toBe('exited 1')
    expect(launchctlFailure({ status: null, stdout: '', stderr: '' })).toBe('exited abnormally')
  })

  it('does not invent a failure from ordinary output', () => {
    // A gate that fires on any stderr would make every install look broken.
    expect(
      launchctlFailure({ status: 0, stdout: 'ok', stderr: 'note: reticulating' }),
    ).toBeUndefined()
  })
})

describe('confirming the service actually exists', () => {
  const uid = 501

  it('asks launchd about the service, not about the file', () => {
    // ★ The success condition must not be "the plist parsed". It is "launchd
    // reports a job at this address".
    const asked: string[][] = []

    isRegistered(uid, (args) => {
      asked.push([...args])
      return { status: 0, stdout: 'ok', stderr: '' }
    })

    expect(asked).toEqual([['print', serviceTarget(uid)]])
    expect(serviceTarget(uid)).toBe('gui/501/com.friday.core')
  })

  it('reports registered only when the query genuinely succeeds', () => {
    expect(isRegistered(uid, () => ({ status: 0, stdout: 'ok', stderr: '' }))).toBe(true)
    expect(
      isRegistered(uid, () => ({ status: 113, stdout: '', stderr: 'Could not find service' })),
    ).toBe(false)
  })

  it('★ reports not-registered when the query exits 0 but complains', () => {
    // The same trap as above, in the place that would matter most: this is what
    // `install` relies on to decide whether to claim success.
    expect(
      isRegistered(uid, () => ({ status: 0, stdout: '', stderr: 'Bootstrap failed: 5' })),
    ).toBe(false)
  })
})
