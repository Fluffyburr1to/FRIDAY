import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { run } from '@friday/cli'
import { loadPolicySet } from '@friday/guardian'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * `friday init`, seeding the authorization rules.
 *
 * The assertion that matters most is not that files appeared — it is that
 * `loadPolicySet` accepts what was written. Copying the right bytes to the
 * right place and producing a rule set the Guardian refuses would be a
 * successful-looking setup that leaves FRIDAY unable to start.
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

  async function friday(...argv: string[]): Promise<{ code: number } & ReturnType<typeof capture>> {
    const streams = capture()
    const code = await run({ argv, stdout: streams.stdout, stderr: streams.stderr })

    return { code, ...streams }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-init-'))
    policiesDir = join(directory, 'policies')

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

  it('creates the policy directory and puts the shipped rules in it', async () => {
    const result = await friday('init')

    expect(result.code).toBe(0)
    expect(readdirSync(policiesDir).filter((n) => n.endsWith('.json')).length).toBeGreaterThan(0)
  })

  it('writes a rule set the Guardian actually accepts', async () => {
    // ★ The point of the command. Files in the right place that do not load
    // would be a setup reporting success while FRIDAY cannot start.
    await friday('init')

    const loaded = loadPolicySet(policiesDir)

    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.value.policies.length).toBeGreaterThan(0)
  })

  it('copies only rule files, never the documentation beside them', async () => {
    await friday('init')

    expect(readdirSync(policiesDir).every((name) => name.endsWith('.json'))).toBe(true)
  })

  it('copies the shipped rules byte for byte', async () => {
    // ★ This is what connects init to `apps/core` without either app having to
    // know about the other. Those tests already compose a real Guardian against
    // `packages/guardian/policies`; if what init writes is the same bytes, then
    // what init writes composes too.
    //
    // It also asserts the invariant directly: init copies, it never authors. A
    // transformation on the way through — reformatting, merging, "helpfully"
    // adding a rule — would show up here and nowhere else.
    await friday('init')

    const shipped = new URL('../../../../packages/guardian/policies/', import.meta.url).pathname

    for (const file of readdirSync(policiesDir)) {
      expect(readFileSync(join(policiesDir, file), 'utf8')).toBe(
        readFileSync(join(shipped, file), 'utf8'),
      )
    }
  })

  it('populates a directory that exists but holds no rules', async () => {
    // An empty directory carries no intent, and the loader refuses an empty
    // set — so leaving it empty leaves FRIDAY unable to start.
    mkdirSync(policiesDir, { recursive: true })

    const result = await friday('init')

    expect(result.code).toBe(0)
    expect(readdirSync(policiesDir).length).toBeGreaterThan(0)
  })

  it('never overwrites rules that are already there', async () => {
    mkdirSync(policiesDir, { recursive: true })
    const mine = join(policiesDir, '00-defaults.json')
    writeFileSync(mine, '{"policies":[]}')

    const result = await friday('init')

    expect(result.code).toBe(0)
    expect(readFileSync(mine, 'utf8')).toBe('{"policies":[]}')
  })

  it('adds nothing to a directory it left alone', async () => {
    mkdirSync(policiesDir, { recursive: true })
    writeFileSync(join(policiesDir, 'mine.json'), '{"policies":[]}')

    await friday('init')

    // Not merely "did not overwrite" — did not ADD either. A shipped rule
    // joining the owner's set would widen what FRIDAY may do without asking.
    expect(readdirSync(policiesDir)).toEqual(['mine.json'])
  })

  it('says it left an existing rule set alone', async () => {
    mkdirSync(policiesDir, { recursive: true })
    writeFileSync(join(policiesDir, 'mine.json'), '{"policies":[]}')

    const result = await friday('init')

    expect(result.out()).toContain('already')
    expect(result.out()).toContain('left')
  })

  it('is safe to run twice', async () => {
    await friday('init')
    const before = readdirSync(policiesDir).sort()

    const second = await friday('init')

    expect(second.code).toBe(0)
    expect(readdirSync(policiesDir).sort()).toEqual(before)
    expect(second.out()).toContain('already')
  })

  it('reports what it did in JSON, for a script that has to check', async () => {
    const result = await friday('init', '--json')

    expect(result.code).toBe(0)

    const reported = JSON.parse(result.out().trim()) as {
      policies: { action: string; files: string[] }
    }

    expect(reported.policies.action).toBe('copied')
    expect(reported.policies.files.length).toBeGreaterThan(0)
  })
})
