import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(
  fridayTest({
    name: 'open-meteo',

    // ★ Required because this package is `@friday/connector-open-meteo`, not
    // `@friday/open-meteo`. Without it the self-alias never matches, the tests
    // resolve through node_modules to a stale `dist/`, and — as this config's
    // own comment warns — coverage reads 0% while everything passes. Found by
    // mutation testing: every mutation to `src/` survived, because `src/` was
    // not what was running.
    packageName: '@friday/connector-open-meteo',
  }),
)
