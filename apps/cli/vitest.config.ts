import { fridayTest } from '@friday/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig(fridayTest({ name: 'cli' }))
