import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(
  fridayTest({
    name: 'guardian',

    // Chapter 28 requires 100% here and on packages/contracts. An untested
    // branch in the component that decides whether actions are permitted is a
    // branch nobody has verified — and it will eventually execute.
    coverageThresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
  }),
)
