/**
 * Types for the shared Vitest preset.
 *
 * Hand-written rather than generated, because `index.js` is deliberately not
 * compiled — see the comment at the top of that file.
 *
 * These describe only the surface FRIDAY's packages actually use. It is not an
 * attempt to restate Vitest's own configuration type: the return value is
 * handed straight to `defineConfig`, which validates the rest.
 */

export interface CoverageThresholds {
  readonly statements: number
  readonly branches: number
  readonly functions: number
  readonly lines: number
}

export interface FridayTestOptions {
  /**
   * Short name for this package's test projects, normally the folder name.
   * Appears in Vitest output as `<name>:unit` and `<name>:integration`.
   */
  readonly name: string

  /** Files run before each test file. Rarely needed; prefer explicit setup. */
  readonly setupFiles?: readonly string[]

  /**
   * Overrides the 80% default. Chapter 28 requires 100% on `packages/guardian`
   * and `packages/contracts`; every other package uses the default.
   */
  readonly coverageThresholds?: CoverageThresholds

  /** `node` everywhere except browser-facing packages, which use `jsdom`. */
  readonly environment?: 'node' | 'jsdom'

  /**
   * The package's own import name.
   *
   * ★ Almost never needed: the name is read from the package's own
   * `package.json`, so it cannot drift from reality. Supplying it is only a
   * way to be explicit, and a value that disagrees with `package.json` is
   * refused rather than honoured — an alias that matches nothing sends a
   * package's tests to a stale `dist/` while every one of them passes.
   */
  readonly packageName?: string
}

/**
 * A Vitest configuration object. Typed loosely on purpose: this preset owns
 * the settings that must not vary, and Vitest validates the whole object when
 * it is passed to `defineConfig`.
 */
export interface FridayTestConfig {
  readonly test: Record<string, unknown>
  readonly resolve: Record<string, unknown>
}

/**
 * Builds the standard FRIDAY test configuration for one package.
 *
 * @param options - Per-package settings; everything else is fixed.
 * @returns A configuration object to pass to Vitest's `defineConfig`.
 */
export function fridayTest(options: FridayTestOptions): FridayTestConfig

export declare const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds
export declare const UNIT_TIMEOUT_MS: number
export declare const INTEGRATION_TIMEOUT_MS: number
