import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_COVERAGE_THRESHOLDS,
  fridayTest,
  INTEGRATION_TIMEOUT_MS,
  UNIT_TIMEOUT_MS,
} from '../../index.js'

/**
 * The only tests in the repository at Milestone 2, and deliberately so.
 *
 * They assert nothing about FRIDAY. They assert that the *test harness* does
 * what every future package will assume it does — because a harness whose
 * behaviour nobody has checked is a harness that silently stops running tests,
 * and the failure mode of that is a green pipeline that verifies nothing.
 *
 * They also mean CI proves the runner executes, rather than only proving it
 * found no files to execute.
 */

interface ProjectShape {
  test: {
    name: string
    include: readonly string[]
    testTimeout: number
    passWithNoTests: boolean
    fileParallelism?: boolean
  }
}

function projectsOf(config: ReturnType<typeof fridayTest>): ProjectShape[] {
  return config.test.projects as ProjectShape[]
}

describe('fridayTest', () => {
  it('names both tiers after the package', () => {
    const projects = projectsOf(fridayTest({ name: 'guardian' }))

    expect(projects.map((p) => p.test.name)).toEqual(['guardian:unit', 'guardian:integration'])
  })

  it('separates the two tiers by directory, so neither can silently absorb the other', () => {
    const [unit, integration] = projectsOf(fridayTest({ name: 'kernel' }))

    expect(unit?.test.include).toEqual(['test/unit/**/*.test.ts?(x)'])
    expect(integration?.test.include).toEqual(['test/integration/**/*.test.ts?(x)'])
  })

  it('picks up JSX test files, so a component test can be written as one', () => {
    const [unit] = projectsOf(fridayTest({ name: 'web' }))

    // The directory split above is the guarantee; this is the file extension.
    // Both tiers accept .tsx because apps/web renders components, and a Node
    // package simply never has a file that matches.
    expect(unit?.test.include.every((pattern) => pattern.endsWith('.test.ts?(x)'))).toBe(true)
  })

  it('gives integration tests a longer timeout than unit tests', () => {
    const [unit, integration] = projectsOf(fridayTest({ name: 'storage' }))

    expect(unit?.test.testTimeout).toBe(UNIT_TIMEOUT_MS)
    expect(integration?.test.testTimeout).toBe(INTEGRATION_TIMEOUT_MS)
    expect(INTEGRATION_TIMEOUT_MS).toBeGreaterThan(UNIT_TIMEOUT_MS)
  })

  it('runs integration tests one file at a time', () => {
    const [, integration] = projectsOf(fridayTest({ name: 'storage' }))

    // They share a real SQLite database. Lock contention between parallel
    // files is noise that looks exactly like a bug in the code under test.
    expect(integration?.test.fileParallelism).toBe(false)
  })

  it('does not expose test globals', () => {
    const config = fridayTest({ name: 'audit' })

    // Explicit imports are what tell a reader of a single file — human or an
    // AI assistant with no other context — where `describe` came from.
    expect(config.test.globals).toBe(false)
  })

  it('resets mock state between tests', () => {
    const config = fridayTest({ name: 'audit' })

    expect(config.test.clearMocks).toBe(true)
    expect(config.test.mockReset).toBe(true)
    expect(config.test.restoreMocks).toBe(true)
  })

  it('applies the 80% coverage floor by default', () => {
    const config = fridayTest({ name: 'memory' })
    const coverage = config.test.coverage as { thresholds: unknown }

    expect(coverage.thresholds).toEqual(DEFAULT_COVERAGE_THRESHOLDS)
    expect(DEFAULT_COVERAGE_THRESHOLDS.branches).toBe(80)
  })

  it('lets the load-bearing packages demand 100%', () => {
    const full = { statements: 100, branches: 100, functions: 100, lines: 100 }
    const config = fridayTest({ name: 'guardian', coverageThresholds: full })
    const coverage = config.test.coverage as { thresholds: unknown }

    // Chapter 28: an unexercised branch in the component that decides whether
    // actions are permitted is a branch nobody has verified.
    expect(coverage.thresholds).toEqual(full)
  })

  it('measures coverage of index.ts along with everything else', () => {
    const config = fridayTest({ name: 'contracts' })
    const coverage = config.test.coverage as { exclude: readonly string[] }

    expect(coverage.exclude).not.toContain('src/**/index.ts')
  })

  it('defaults to the node environment', () => {
    expect(fridayTest({ name: 'cli' }).test.environment).toBe('node')
    expect(fridayTest({ name: 'ui-kit', environment: 'jsdom' }).test.environment).toBe('jsdom')
  })
})

/** The repository root, from this package's own location. */
const ROOT = resolve(process.cwd(), '../..')
const HERE = process.cwd()

interface Aliased {
  resolve: { alias: ReadonlyArray<{ find: string; replacement: string }> }
}

afterEach(() => {
  process.chdir(HERE)
})

describe('the self-alias cannot drift from the package it names', () => {
  it('reads the name rather than guessing it from the short name', () => {
    // ★ The regression this exists for. `@friday/connector-open-meteo` has the
    // short name `open-meteo`, so the old guess produced `@friday/open-meteo`
    // — an alias matching nothing. Its tests then resolved through
    // node_modules to a stale dist/, and every deliberate break to its source
    // still passed. The suite was green throughout.
    process.chdir(join(ROOT, 'connectors/open-meteo'))

    const config = fridayTest({ name: 'open-meteo' }) as unknown as Aliased

    expect(config.resolve.alias[0]?.find).toBe('@friday/connector-open-meteo')
  })

  it('points the alias at the package source', () => {
    process.chdir(join(ROOT, 'packages/contracts'))

    const config = fridayTest({ name: 'contracts' }) as unknown as Aliased

    expect(config.resolve.alias[0]?.find).toBe('@friday/contracts')
    expect(config.resolve.alias[0]?.replacement).toContain('packages/contracts/src/index.ts')
  })

  it('refuses an explicit name that disagrees with the package', () => {
    // Overriding it wrongly is the same silent failure by another route.
    process.chdir(join(ROOT, 'packages/contracts'))

    expect(() => fridayTest({ name: 'contracts', packageName: '@friday/nope' })).toThrow(
      /does not match/,
    )
  })

  it('accepts an explicit name that agrees', () => {
    process.chdir(join(ROOT, 'packages/contracts'))

    expect(() => fridayTest({ name: 'contracts', packageName: '@friday/contracts' })).not.toThrow()
  })

  it('refuses to configure a directory with no package.json', () => {
    process.chdir(mkdtempSync(join(tmpdir(), 'friday-preset-')))

    expect(() => fridayTest({ name: 'nowhere' })).toThrow(/no package.json/)
  })

  it('refuses a package.json with no name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'friday-preset-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    process.chdir(dir)

    expect(() => fridayTest({ name: 'nameless' })).toThrow(/has no name/)
  })

  it('creates no alias when there is no source to alias to', () => {
    // The Vite app and this preset have no `src/index.ts`. Aliasing to a file
    // that does not exist would be the same lie in a different shape.
    const dir = mkdtempSync(join(tmpdir(), 'friday-preset-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@friday/no-src' }))
    process.chdir(dir)

    const config = fridayTest({ name: 'no-src' }) as unknown as Aliased

    expect(config.resolve.alias).toEqual([])
  })
})
