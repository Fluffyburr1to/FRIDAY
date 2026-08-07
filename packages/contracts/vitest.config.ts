import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(
  fridayTest({
    name: 'contracts',

    // Chapter 28 requires 100% here and on packages/guardian. Not a vanity
    // metric: an unexercised branch in the single source of truth for every
    // data shape in the system is a branch nobody has verified, and it will
    // eventually execute.
    coverageThresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
  }),
)
