import { describe, expect, it } from 'vitest'
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

    expect(unit?.test.include).toEqual(['test/unit/**/*.test.ts'])
    expect(integration?.test.include).toEqual(['test/integration/**/*.test.ts'])
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
