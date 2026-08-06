#!/usr/bin/env node
/**
 * Architectural boundary enforcement.
 *
 * Wraps dependency-cruiser so that "there is no source code yet" is reported
 * honestly rather than being swallowed by a `|| echo` that would also swallow
 * a real violation. A check that cannot distinguish "nothing to check" from
 * "the check crashed" is not a check.
 *
 * The rules live in .dependency-cruiser.cjs. They are the architecture, made
 * mechanical — see docs/01-bible/03-repository-structure.md
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCOPES = ['apps', 'packages', 'departments', 'connectors']

/** Does this scope contain any TypeScript source yet? */
function hasSource(scope) {
  const dir = join(ROOT, scope)
  if (!existsSync(dir)) return false

  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
        return true
      }
    }
  }
  return false
}

const populated = SCOPES.filter(hasSource)

if (populated.length === 0) {
  console.log(
    'boundaries — no TypeScript source yet, nothing to check.\n' +
      '  Rules are configured and will apply from the first source file.\n' +
      '  See .dependency-cruiser.cjs',
  )
  process.exit(0)
}

const result = spawnSync(
  'depcruise',
  ['--config', '.dependency-cruiser.cjs', '--output-type', 'err-long', ...populated],
  { cwd: ROOT, stdio: 'inherit', shell: false },
)

if (result.error) {
  console.error('boundaries — dependency-cruiser failed to run:', result.error.message)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(
    '\nA boundary rule was violated.\n\n' +
      'These rules ARE the architecture. The correct response is to fix the\n' +
      'design, or to amend the rule with an ADR — never to add a silent\n' +
      'exception. See docs/01-bible/03-repository-structure.md\n',
  )
  process.exit(result.status ?? 1)
}

console.log(`boundaries ok — checked ${populated.join(', ')}`)
