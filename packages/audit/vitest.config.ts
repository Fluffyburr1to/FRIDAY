import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(
  fridayTest({
    name: 'audit',

    // Not the 100% the Guardian and contracts carry — this package decides
    // nothing. But an explanation is a claim about the past, and a wrong one
    // is worse than none, so it is held well above the default.
    coverageThresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
  }),
)
