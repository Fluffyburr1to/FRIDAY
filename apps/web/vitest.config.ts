import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

/**
 * NOTE: there are no tests here yet, and that is a gap rather than a
 * statement that this app does not need them.
 *
 * Testing a React component needs a DOM environment and a rendering library —
 * `@friday/vitest-config` already accepts `environment: 'jsdom'`, so the seam
 * exists — and both are dependencies, which rule 4 says to ask about rather
 * than add in passing. Until that is decided, this app's behavior is covered
 * only by `apps/core`'s tests up to the wire, which is weaker than the rest of
 * the repository and should not stay true for long.
 */
export default defineConfig(fridayTest({ name: 'web' }))
