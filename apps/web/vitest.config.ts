import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

/**
 * `jsdom`, because these tests assert what the owner sees rather than what the
 * component returns. Queries go through roles and text for the same reason —
 * a test that breaks when the markup is rearranged is a test that discourages
 * rearranging markup, and one that breaks when the screen stops being readable
 * is the one worth having.
 */
export default defineConfig(fridayTest({ name: 'web', environment: 'jsdom' }))
