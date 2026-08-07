import { defineConfig } from 'vitest/config'
import { fridayTest } from './index.js'

// The preset configures its own tests. If it is broken, this package's suite
// is the first thing that fails — which is the correct blast radius.
export default defineConfig(fridayTest({ name: 'vitest-config' }))
