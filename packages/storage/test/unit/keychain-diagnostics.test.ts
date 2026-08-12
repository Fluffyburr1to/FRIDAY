import { describe, expect, it } from 'vitest'
import { classifyReadFailure, describeReadFailure } from '../../src/index.js'

/**
 * Telling "she is not set up" apart from "she started before you unlocked".
 *
 * ── Why this distinction is worth code ──────────────────────────────────────
 *
 * FRIDAY runs as a LaunchAgent started at login, and her first act reads a key
 * from the login Keychain. That Keychain unlocks at login too, and the two are
 * not ordered — so on a fresh login she can lose the race and be refused by a
 * Keychain that is working perfectly and contains exactly what she needs.
 *
 * Chapter 39 carries this as a known M4 risk and predicted the symptom: the
 * failure would "name a key rather than a timing problem". Someone reading that
 * would go looking for a missing Keychain entry, find it present, and be no
 * closer. The exit status is the only thing that separates the two cases, and
 * this is where it is read.
 *
 * ── What this does not claim ────────────────────────────────────────────────
 *
 * **Nothing here demonstrates the race, or that FRIDAY recovers from it.** It
 * asserts that when macOS reports the locked case, she says so. Whether the
 * agent actually meets a locked Keychain at login, and what happens next, is
 * unproven and is not tested by anything in this repository.
 *
 * Reference: docs/01-bible/39-roadmap.md — carried M4 implementation risks
 *            docs/adr/0020-key-material-comes-from-an-injected-key-provider.md
 */

const REFERENCE = 'capability-signing-key'
const SERVICE = 'com.friday.credentials'

function describe128() {
  return describeReadFailure({
    reference: REFERENCE,
    service: SERVICE,
    failure: { status: 128, cause: new Error('user interaction not allowed') },
  })
}

describe('classifying a failed Keychain read', () => {
  it('reads 128 as a locked Keychain', () => {
    // Observed during the M4 Keychain gate: a locked keychain refuses a
    // non-interactive read with this status.
    expect(classifyReadFailure({ status: 128, cause: undefined })).toBe('locked')
  })

  it('reads 44 as an item that is not there', () => {
    expect(classifyReadFailure({ status: 44, cause: undefined })).toBe('absent')
  })

  it('does not guess at a status it has not seen', () => {
    expect(classifyReadFailure({ status: 1, cause: undefined })).toBe('unknown')
    expect(classifyReadFailure({ status: null, cause: undefined })).toBe('unknown')
  })
})

describe('explaining a failed Keychain read', () => {
  it('leads with timing rather than the key when the Keychain is locked', () => {
    const error = describe128()

    // ★ The property that matters: someone reading this is told *when* it went
    // wrong, not handed an identifier to go hunting for.
    expect(error.message).toContain('before your Keychain was available')
    expect(error.message).toContain('log in')
  })

  it('does not name the key as the explanation when the Keychain is locked', () => {
    // Naming it would send the owner to check an entry that is present and
    // readable, and tell them nothing about why she could not read it.
    expect(describe128().message).not.toContain(REFERENCE)
  })

  it('says her setup is intact when the Keychain is locked', () => {
    const message = describe128().message

    expect(message).toContain('Nothing is wrong with her setup')
    expect(message).toContain('will try again')
  })

  it('points at `friday init` when the key has never been created', () => {
    const error = describeReadFailure({
      reference: REFERENCE,
      service: SERVICE,
      failure: { status: 44, cause: undefined },
    })

    expect(error.message).toContain('friday init')
    expect(error.message).toContain(REFERENCE)
  })

  it('admits when it does not recognise the reason', () => {
    const error = describeReadFailure({
      reference: REFERENCE,
      service: SERVICE,
      failure: { status: 7, cause: undefined },
    })

    expect(error.message).toContain('not one she recognises')
    expect(error.message).toContain('7')
  })

  it('never carries key material, whatever went wrong', () => {
    // ADR-0020 and Chapter 18: the value never appears in an error, a log line,
    // or an event payload. The reference is a name and is allowed; the secret
    // is not, and this function never receives one.
    for (const status of [128, 44, 7, null]) {
      const error = describeReadFailure({
        reference: REFERENCE,
        service: SERVICE,
        failure: { status, cause: undefined },
      })

      expect(JSON.stringify(error)).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/)
    }
  })

  it('records the status it was given, so a report can be acted on', () => {
    expect(describe128().detail).toMatchObject({
      reference: REFERENCE,
      service: SERVICE,
      status: 128,
    })
  })
})
