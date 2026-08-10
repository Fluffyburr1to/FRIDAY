import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { createContext, createOutput, run, runInit } from '@friday/cli'
import { loadPolicySet } from '@friday/guardian'
import { createInMemoryKeyProvisioner, KEY_LENGTH_BYTES } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * `friday init`.
 *
 * ── Why these call `runInit` rather than `run(['init'])` ────────────────────
 *
 * Going through the dispatcher would build the **Keychain-backed** provisioner,
 * and these tests would write real key material into the developer's login
 * Keychain. There is no safe way to do that: `security add-generic-password`
 * cannot both keep the value out of `argv` — which requires `-w` last — and
 * target a non-default keychain, which requires a trailing positional path.
 *
 * So the provisioner is injected. Every decision this command makes is
 * exercised against an in-memory one; what is left behind the boundary is the
 * `execFileSync` call itself, which is the same boundary the key *provider*
 * has always had and the reason ADR-0020 made it an injected port.
 *
 * ── ★ What "all tests green" does NOT mean ──────────────────────────────────
 *
 * **No test in this repository starts FRIDAY against a real Keychain.** The
 * full path — `friday init` writing two keys, then `apps/core` reading them
 * back at startup and reaching "listening" — is not exercised anywhere, because
 * `main()` constructs the Keychain-backed provider and CI has no Keychain it is
 * allowed to write to.
 *
 * What IS proven, and it is worth knowing exactly where the chain ends:
 *
 *   1. init writes a policy set that the real `loadPolicySet` accepts    (here)
 *   2. that set is byte-identical to the rules the repository ships      (here)
 *   3. those shipped rules compose a Guardian and open storage
 *                          (apps/core/test/integration/composition.test.ts)
 *   4. the rules actually ship in the package
 *                          (tests/architecture/packaging.test.ts)
 *   5. keys are created once, never replaced, never printed              (here)
 *   6. a missing field key beside an existing database is refused        (here)
 *
 * The link that is missing is between 5 and 1: **a real Keychain round trip.**
 * If you are reading this while deciding whether first-run works on a real Mac,
 * the answer from the test suite is "every decision is right"; it is not
 * "someone has watched it work". That has to be done by hand, once.
 *
 * Reference: docs/adr/0035-first-run-provisioning-is-creation-only.md
 */

function capture() {
  const chunks: string[] = []
  const errors: string[] = []

  const sink = (into: string[]) =>
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        into.push(chunk.toString())
        callback()
      },
    })

  return {
    stdout: sink(chunks),
    stderr: sink(errors),
    out: () => chunks.join(''),
    errors: () => errors.join(''),
  }
}

describe('friday init', () => {
  let directory: string
  let policiesDir: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined

  /** The Keychain, as far as these tests are concerned. Never the real one. */
  let keychain: Record<string, string>

  function init(): { code: number; out: string; problems: string } {
    const streams = capture()
    const out = createOutput({ json: false, stdout: streams.stdout, stderr: streams.stderr })
    const context = createContext({ out })

    if (!context.ok) throw new Error(context.error.message)

    const code = runInit({
      context: context.value,
      provisioner: createInMemoryKeyProvisioner(keychain),
    })

    return { code, out: streams.out(), problems: streams.errors() }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-init-'))
    policiesDir = join(directory, 'policies')
    keychain = {}

    previousDataDir = process.env.FRIDAY_DATA_DIR
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_DATA_DIR = directory
    process.env.FRIDAY_POLICIES_DIR = policiesDir
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
  })

  describe('the rules', () => {
    it('creates the policy directory and puts the shipped rules in it', () => {
      const result = init()

      expect(result.code).toBe(0)
      expect(readdirSync(policiesDir).filter((n) => n.endsWith('.json')).length).toBeGreaterThan(0)
    })

    it('writes a rule set the Guardian actually accepts', () => {
      // ★ The point of the command. Files in the right place that do not load
      // would be a setup reporting success while FRIDAY cannot start.
      init()

      const loaded = loadPolicySet(policiesDir)

      expect(loaded.ok).toBe(true)
      if (loaded.ok) expect(loaded.value.policies.length).toBeGreaterThan(0)
    })

    it('copies only rule files, never the documentation beside them', () => {
      init()

      expect(readdirSync(policiesDir).every((name) => name.endsWith('.json'))).toBe(true)
    })

    it('copies the shipped rules byte for byte', () => {
      // ★ This is what connects init to `apps/core` without either app having
      // to know about the other. Those tests already compose a real Guardian
      // against `packages/guardian/policies`; if what init writes is the same
      // bytes, then what init writes composes too.
      //
      // It also asserts the ADR's invariant directly: init copies, it never
      // authors. A transformation on the way through — reformatting, merging,
      // "helpfully" adding a rule — would show up here and nowhere else.
      init()

      const shipped = new URL('../../../../packages/guardian/policies/', import.meta.url).pathname

      for (const file of readdirSync(policiesDir)) {
        expect(readFileSync(join(policiesDir, file), 'utf8')).toBe(
          readFileSync(join(shipped, file), 'utf8'),
        )
      }
    })

    it('populates a directory that exists but holds no rules', () => {
      // An empty directory carries no intent, and the loader refuses an empty
      // set — so leaving it empty leaves FRIDAY unable to start.
      mkdirSync(policiesDir, { recursive: true })

      expect(init().code).toBe(0)
      expect(readdirSync(policiesDir).length).toBeGreaterThan(0)
    })

    it('never overwrites rules that are already there', () => {
      mkdirSync(policiesDir, { recursive: true })
      const mine = join(policiesDir, '00-defaults.json')
      writeFileSync(mine, '{"policies":[]}')

      expect(init().code).toBe(0)
      expect(readFileSync(mine, 'utf8')).toBe('{"policies":[]}')
    })

    it('adds nothing to a directory it left alone', () => {
      mkdirSync(policiesDir, { recursive: true })
      writeFileSync(join(policiesDir, 'mine.json'), '{"policies":[]}')

      init()

      // Not merely "did not overwrite" — did not ADD either. A shipped rule
      // joining the owner's set would widen what FRIDAY may do without asking.
      expect(readdirSync(policiesDir)).toEqual(['mine.json'])
    })

    it('says it left an existing rule set alone', () => {
      mkdirSync(policiesDir, { recursive: true })
      writeFileSync(join(policiesDir, 'mine.json'), '{"policies":[]}')

      const result = init()

      expect(result.out).toContain('already')
      expect(result.out).toContain('left')
    })
  })

  describe('the keys', () => {
    it('creates both keys, at the length the reader will accept', () => {
      const result = init()

      expect(result.code).toBe(0)
      expect(Object.keys(keychain).sort()).toEqual([
        'capability-signing-key',
        'field-encryption-key',
      ])

      for (const value of Object.values(keychain)) {
        expect(Buffer.from(value, 'base64')).toHaveLength(KEY_LENGTH_BYTES)
      }
    })

    it('generates a different key for each purpose', () => {
      init()

      const values = Object.values(keychain)
      expect(new Set(values).size).toBe(values.length)
    })

    it('leaves an existing key exactly as it was', () => {
      keychain['field-encryption-key'] = Buffer.alloc(KEY_LENGTH_BYTES, 1).toString('base64')
      const before = keychain['field-encryption-key']

      const result = init()

      expect(result.code).toBe(0)
      expect(keychain['field-encryption-key']).toBe(before)
    })

    it('creates the key that is missing when only one is present', () => {
      keychain['capability-signing-key'] = Buffer.alloc(KEY_LENGTH_BYTES, 2).toString('base64')

      const result = init()

      expect(result.code).toBe(0)
      expect(keychain['field-encryption-key']).toBeDefined()
    })

    it('is safe to run twice, and says nothing changed the second time', () => {
      init()
      const after = { ...keychain }

      const second = init()

      expect(second.code).toBe(0)
      expect(keychain).toEqual(after)
      expect(second.out).toContain('already')
    })

    it('never prints key material', () => {
      const result = init()

      for (const value of Object.values(keychain)) {
        expect(result.out).not.toContain(value)
        expect(result.problems).not.toContain(value)
      }
    })

    it('warns that the field-encryption key cannot be replaced', () => {
      // Required output. The owner cannot take a precaution nobody told them
      // was needed, and this is the only moment they are certainly present.
      const result = init()

      expect(result.out).toContain('cannot be replaced')
      expect(result.out).toContain('never be read again')
    })
  })

  describe('when the databases already exist', () => {
    function makeDatabase(): void {
      writeFileSync(join(directory, 'events.db'), 'not really a database')
    }

    it('refuses to mint a replacement field key', () => {
      // ★ The state that must be impossible. A new key here would let FRIDAY
      // start, verify her chain, and report herself healthy while every
      // decision she ever recorded stayed unreadable.
      makeDatabase()

      const result = init()

      expect(result.code).toBe(1)
      expect(keychain['field-encryption-key']).toBeUndefined()
    })

    it('explains what happened in terms of recovery, not of key management', () => {
      makeDatabase()

      const result = init()

      expect(result.problems).toContain('has NOT made a new key')
      expect(result.problems).toContain('Keychain of the machine that wrote these files')
    })

    it('creates no key at all rather than the one it could safely make', () => {
      makeDatabase()

      init()

      // The capability key would be safe to create here. Not creating it keeps
      // the refusal one decision rather than a partial success to reason about.
      expect(keychain).toEqual({})
    })

    it('still seeds the rules, because that part was never in doubt', () => {
      makeDatabase()

      init()

      expect(readdirSync(policiesDir).filter((n) => n.endsWith('.json')).length).toBeGreaterThan(0)
    })

    it('proceeds normally when the field key is present', () => {
      makeDatabase()
      keychain['field-encryption-key'] = Buffer.alloc(KEY_LENGTH_BYTES, 3).toString('base64')

      const result = init()

      expect(result.code).toBe(0)
      expect(keychain['capability-signing-key']).toBeDefined()
    })
  })

  it('is offered in the usage text', async () => {
    // The dispatcher is covered here rather than by running `init` through it,
    // which would construct the real Keychain provisioner.
    const streams = capture()
    await run({ argv: [], stdout: streams.stdout, stderr: streams.stderr })

    expect(streams.errors()).toContain('friday init')
  })
})
