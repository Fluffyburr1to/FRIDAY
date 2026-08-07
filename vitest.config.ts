import { defineConfig } from 'vitest/config'

/**
 * Configuration for the CROSS-CUTTING tests in `tests/` — the ones that span
 * packages and therefore belong to no package.
 *
 * Tests that belong to a single package live in that package's `test/` folder
 * and are configured by `@friday/vitest-config`. This file governs only the
 * suites that are about the system as a whole.
 *
 * `tests/e2e/` is deliberately absent: it is Playwright, not Vitest, and it
 * arrives at Milestone 4 with a dashboard to click.
 *
 * Reference: docs/01-bible/28-testing-strategy.md
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,

    // Scaffolded tiers have no tests until their milestone. See the note in
    // tools/vitest-config/README.md — this is a scaffolding convenience, not a
    // standard, and it should go once every tier has content.
    passWithNoTests: true,

    projects: [
      {
        test: {
          // ★ The founding guarantees. Protected by CODEOWNERS; FRIDAY may
          // never propose changes to them. When one fails, the answer is never
          // to adjust the test. Arrives at Milestone 2 (Conscience).
          name: 'constitutional',
          include: ['tests/constitutional/**/*.test.ts'],
          testTimeout: 30_000,
          passWithNoTests: true,
        },
      },
      {
        test: {
          // The conformance suite every connector must pass, run against
          // recorded fixtures. Arrives at Milestone 4 with the first connector.
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
          testTimeout: 30_000,
          passWithNoTests: true,
        },
      },
      {
        test: {
          // Asserts that the rules in .dependency-cruiser.cjs can actually
          // fire. See tests/architecture/README.md for why this tier exists.
          name: 'architecture',
          include: ['tests/architecture/**/*.test.ts'],
          testTimeout: 10_000,
          passWithNoTests: false,
        },
      },
    ],
  },
})
