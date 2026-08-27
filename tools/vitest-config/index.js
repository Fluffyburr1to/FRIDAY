/**
 * Shared Vitest configuration.
 *
 * Every package's `vitest.config.ts` is three lines that call `fridayTest()`.
 * The harness is therefore configured once, and a package cannot quietly opt
 * out of a setting — the same reason `tsconfig.base.json` exists.
 *
 * This file is plain JavaScript with a hand-written `index.d.ts` rather than
 * TypeScript, because a config package that needs compiling before anything
 * can be tested is a bootstrap problem waiting to happen.
 *
 * Reference: docs/01-bible/28-testing-strategy.md
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Unit tests do no I/O. A unit test that needs longer than this is not one. */
const UNIT_TIMEOUT_MS = 5_000

/** Integration tests open a real SQLite database and a real event bus. */
const INTEGRATION_TIMEOUT_MS = 30_000

/**
 * Chapter 28 sets 80% overall, and 100% on the Guardian and on contracts —
 * where an unexercised branch is a branch nobody has verified in the component
 * that decides whether actions are permitted.
 *
 * Coverage is measured but never optimized for. A test written to raise a
 * number is worse than no test.
 */
const DEFAULT_COVERAGE_THRESHOLDS = {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
}

/**
 * Every test imports through a package's public name — `@friday/contracts`,
 * never `../../src/event.js`. That is what keeps the "only index.ts is
 * importable" rule true of the tests as well as of the code, and it means a
 * test breaks when the public surface changes, which is the point.
 *
 * For a package's own tests, that name is aliased back to its `src/index.ts`
 * rather than resolved through node_modules to `dist/`. Two reasons, and the
 * second is the one that matters:
 *
 *   1. The inner loop needs no build step.
 *   2. Vitest externalises anything under node_modules, and an externalised
 *      module is never instrumented — so coverage would read 0% while every
 *      test passed. A measurement that fails silently is worse than one that
 *      fails loudly, and this one failed silently for a whole milestone.
 *
 * Imports of OTHER packages still resolve to their built output, so the
 * cross-package contract remains what it always was: one entry point, built.
 * `tsc --build` in `pnpm check:types` is what proves the shipped `dist` still
 * compiles.
 */
function selfAlias(packageName) {
  return [{ find: packageName, replacement: `${process.cwd()}/src/index.ts` }]
}

/**
 * The package's real name, read rather than guessed.
 *
 * ★ This used to be guessed as `@friday/${name}`, and a package whose name did
 * not fit that shape — `@friday/connector-open-meteo`, whose short name is
 * `open-meteo` — got an alias that matched nothing. Its tests then resolved
 * through `node_modules` to a stale `dist/`, and **every deliberate break to
 * its source still passed.** The suite was green the entire time.
 *
 * That is the second time this exact failure has happened here; the comment
 * above records the first. Reading the name removes the guess, so the two
 * cannot disagree.
 *
 * @param {string} cwd
 * @returns {string}
 */
function packageNameAt(cwd) {
  const manifest = join(cwd, 'package.json')

  if (!existsSync(manifest)) {
    throw new Error(
      `fridayTest: no package.json beside the Vitest config in ${cwd}. ` +
        'The package name cannot be read, so its tests would silently resolve ' +
        'to a built dist/ instead of to src/.',
    )
  }

  const { name } = JSON.parse(readFileSync(manifest, 'utf8'))

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`fridayTest: package.json in ${cwd} has no name.`)
  }

  return name
}

/**
 * @param {import('./index.js').FridayTestOptions} options
 * @returns {import('./index.js').FridayTestConfig}
 */
export function fridayTest(options) {
  const { name, setupFiles = [], coverageThresholds, environment = 'node', packageName } = options

  const cwd = process.cwd()
  const actualName = packageNameAt(cwd)

  // ★ An explicit override that disagrees with the package is the same silent
  // failure by another route, so it is refused rather than honoured.
  if (packageName !== undefined && packageName !== actualName) {
    throw new Error(
      `fridayTest: packageName "${packageName}" does not match "${actualName}" in ${cwd}/package.json. ` +
        "The self-alias would match nothing and this package's tests would run " +
        'against a built dist/ rather than its source.',
    )
  }

  // Packages with no `src/index.ts` — the Vite app, and this preset itself —
  // have nothing to alias TO. Aliasing to a file that does not exist would be
  // the same lie in a different shape, so no alias is created. Neither imports
  // itself by name; a package that did would fail loudly on the missing file.
  const resolve = existsSync(join(cwd, 'src', 'index.ts'))
    ? { alias: selfAlias(actualName) }
    : { alias: [] }

  /** @type {import('./index.js').FridayTestConfig} */
  const config = {
    resolve,
    test: {
      // Explicit imports from 'vitest' rather than ambient globals. The extra
      // line at the top of each test file is what tells a reader — and an AI
      // assistant reading one file in isolation — where `describe` came from.
      globals: false,
      environment,
      setupFiles,

      // Mock state never leaks between tests. A test that passes only because
      // a previous test left a mock behind is worse than no test, because it
      // fails later for a reason unrelated to the change that broke it.
      clearMocks: true,
      mockReset: true,
      restoreMocks: true,

      // Foundation-only. Packages scaffolded ahead of their milestone have no
      // tests yet, and a red suite that everyone learns to ignore is worse
      // than a green one. This must be revisited when Milestone 1 lands real
      // code — see tools/vitest-config/README.md.
      passWithNoTests: true,

      // The two tiers are separate projects rather than one glob so that
      // `vitest --project unit` is a fast inner loop, and so integration
      // timeouts never silently apply to unit tests.
      projects: [
        {
          // Repeated per project on purpose: a Vitest project builds its own
          // Vite config and does not inherit `resolve` from the root.
          resolve,
          test: {
            name: `${name}:unit`,
            environment,
            setupFiles,
            // `?(x)` so a React component test can be written as JSX. Node
            // packages never match it, so nothing changes for them.
            include: ['test/unit/**/*.test.ts?(x)'],
            testTimeout: UNIT_TIMEOUT_MS,
            passWithNoTests: true,
          },
        },
        {
          resolve,
          test: {
            name: `${name}:integration`,
            environment,
            setupFiles,
            include: ['test/integration/**/*.test.ts?(x)'],
            testTimeout: INTEGRATION_TIMEOUT_MS,
            passWithNoTests: true,

            // Integration tests share a real database file per worker. Running
            // them single-file keeps SQLite lock contention out of the failure
            // modes we are trying to observe.
            fileParallelism: false,
          },
        },
      ],

      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage',
        reporter: ['text-summary', 'json-summary', 'lcov'],
        // index.ts is deliberately NOT excluded. It is usually re-exports, but
        // "usually" is exactly where an untested line hides.
        include: ['src/**/*.ts?(x)'],
        exclude: ['src/**/*.test.ts?(x)'],
        thresholds: coverageThresholds ?? DEFAULT_COVERAGE_THRESHOLDS,
      },
    },
  }

  return config
}

export { DEFAULT_COVERAGE_THRESHOLDS, INTEGRATION_TIMEOUT_MS, UNIT_TIMEOUT_MS }
