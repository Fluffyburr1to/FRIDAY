import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(
  fridayTest({
    name: 'clerk',

    // The seam between deciding and recording. An untested branch here is a
    // path where an approval could be answered without being recorded, or
    // recorded without being answered — which is the pair of failures this
    // package exists to make impossible.
    coverageThresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
  }),
)
