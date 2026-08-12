import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditArtifact } from '../../tools/scripts/release-audit.ts'

/**
 * That the release gate can actually fail.
 *
 * ── Why this tier ───────────────────────────────────────────────────────────
 *
 * A gate nobody has watched reject something is a gate that is assumed to work.
 * `tests/architecture/README.md` states the rule this file follows: a boundary
 * rule must be accompanied by a test proving it can fire — Rules 4 and 5 were
 * found inert since Milestone 0 precisely because nobody had checked.
 *
 * The release script's audit is the same shape of claim. It runs on macOS
 * against an 84 MB tree that takes minutes to build, and it is the only thing
 * standing between a bundle that carries the builder's home directory and the
 * owner's machine. So the *logic* is tested here, portably, against small
 * planted fixtures — every one of these runs identically on the Ubuntu runner,
 * and none of them skips.
 *
 * What this does NOT test is the artifact itself. That is proven by building
 * one, extracting it somewhere unrelated, and running it — which is what
 * `release.ts` does on every release and what no CI runner can do.
 *
 * Reference: docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md §6
 */

/** A minimal tree that passes, so each test can break exactly one thing. */
function buildValidArtifact(root: string): void {
  mkdirSync(join(root, 'node_modules/@friday/cli'), { recursive: true })
  mkdirSync(join(root, 'node_modules/@friday/core'), { recursive: true })
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.bin/friday'), '#!/usr/bin/env node\n')

  const guardian = join(root, 'node_modules/.pnpm/g/node_modules/@friday/guardian/policies')
  mkdirSync(guardian, { recursive: true })
  writeFileSync(join(guardian, '00-defaults.json'), '[]\n')

  const prebuilds = join(root, 'node_modules/.pnpm/better-sqlite3@13.0.3/prebuilds')
  mkdirSync(prebuilds, { recursive: true })
  writeFileSync(join(prebuilds, 'darwin-arm64.node'), 'binary')
}

describe('the release relocation gate', () => {
  let root: string
  const FORBIDDEN = ['/Users/somebody', '/tmp/friday-release-build']

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'friday-audit-'))
    buildValidArtifact(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('passes an artifact that carries nothing of the build machine', () => {
    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toEqual([])
  })

  it('fails a build path hidden in a file that is not package.json', () => {
    // The defect this gate exists for. ADR-0037 predicted the leak would be in
    // the root manifest; measuring a real artifact found it in four other
    // places, including node-gyp leftovers nobody would think to open.
    const buried = join(root, 'node_modules/.pnpm/better-sqlite3@13.0.3/build')
    mkdirSync(buried, { recursive: true })
    writeFileSync(join(buried, 'Makefile'), 'INC=/Users/somebody/Library/node-gyp\n')

    const findings = auditArtifact({ root, forbidden: FORBIDDEN })

    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('build-path')
    expect(findings[0]?.path).toContain('Makefile')
  })

  it('fails a build path baked into a binary rather than into text', () => {
    // Read as bytes on purpose: a path compiled into a native addon is a leak,
    // and a gate that only parsed JSON would ship it.
    writeFileSync(
      join(root, 'node_modules/.pnpm/better-sqlite3@13.0.3/prebuilds/darwin-arm64.node'),
      Buffer.concat([Buffer.from([0x00, 0x01, 0xff]), Buffer.from('/Users/somebody/build')]),
    )

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'build-path' }),
    )
  })

  it('fails a directory whose name encodes the build path', () => {
    // pnpm names virtual-store entries after the source location. Nothing
    // points at the build machine through them, but they carry it.
    mkdirSync(
      join(root, 'node_modules/.pnpm/@friday+cli@file++++tmp+friday-release-build+apps+cli'),
    )

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'build-path' }),
    )
  })

  it('fails a symlink that escapes the artifact', () => {
    // The `--legacy` failure exactly: resolves on the machine that built it,
    // and is inert everywhere else.
    symlinkSync('/etc', join(root, 'node_modules/@friday/escape'), 'dir')

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'escaping-symlink' }),
    )
  })

  it('fails a symlink whose target the archive did not carry', () => {
    symlinkSync(
      join(root, 'node_modules/@friday/gone'),
      join(root, 'node_modules/@friday/dangling'),
    )

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'dangling-symlink' }),
    )
  })

  it('fails an artifact missing the core — the defect ADR-0037 exists to close', () => {
    rmSync(join(root, 'node_modules/@friday/core'), { recursive: true })

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'missing', path: 'node_modules/@friday/core' }),
    )
  })

  it('fails an artifact missing the shipped authorization rules', () => {
    rmSync(join(root, 'node_modules/.pnpm/g'), { recursive: true })

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'missing' }),
    )
  })

  it('fails an artifact with no macOS prebuild for the SQLite driver', () => {
    rmSync(join(root, 'node_modules/.pnpm/better-sqlite3@13.0.3'), { recursive: true })

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toContainEqual(
      expect.objectContaining({ kind: 'missing' }),
    )
  })

  it('does not fail on an upstream document string that merely looks like a path', () => {
    // ★ SQLite's amalgamation and Node's type definitions contain `/Users/me`
    // and `/Users/maciej` in comments. A gate that flagged those could never be
    // satisfied, and an unsatisfiable gate gets switched off.
    writeFileSync(
      join(root, 'node_modules/.pnpm/g/node_modules/@friday/guardian/policies/00-defaults.json'),
      '["see /Users/me/example and /Users/maciej/notes"]\n',
    )

    expect(auditArtifact({ root, forbidden: FORBIDDEN })).toEqual([])
  })
})
