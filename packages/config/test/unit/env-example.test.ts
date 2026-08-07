import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV_VARIABLES, readEnvironment } from '@friday/config'
import { describe, expect, it } from 'vitest'

/**
 * Keeps `.env.example` and the loader in agreement.
 *
 * Chapter 33's rule is that `.env.example` documents every variable. That rule
 * decays the moment it depends on someone remembering it: a variable added to
 * the loader and not to the example is a setting nobody knows exists, and a
 * variable left in the example after the loader stopped reading it is worse —
 * someone sets it, nothing happens, and there is no way to tell why.
 *
 * So the rule is checked instead.
 */

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Every `FRIDAY_*` name assigned in `.env.example`, ignoring comments. */
function documentedVariables(): string[] {
  const contents = readFileSync(join(REPOSITORY_ROOT, '.env.example'), 'utf8')

  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .flatMap((line) => {
      const match = /^(FRIDAY_[A-Z0-9_]+)=/.exec(line)
      return match?.[1] === undefined ? [] : [match[1]]
    })
}

describe('.env.example', () => {
  it('documents every variable the loader reads', () => {
    const documented = new Set(documentedVariables())
    const undocumented = ENV_VARIABLES.filter((name) => !documented.has(name))

    expect(undocumented).toEqual([])
  })

  it('documents no variable the loader ignores', () => {
    const known = new Set<string>(ENV_VARIABLES)
    const orphaned = documentedVariables().filter((name) => !known.has(name))

    expect(orphaned).toEqual([])
  })

  it('contains no value that looks like a real secret', () => {
    // ★ The file is committed. A real key in it is a security incident, and
    // the header says so in capital letters — which is not enforcement.
    const contents = readFileSync(join(REPOSITORY_ROOT, '.env.example'), 'utf8')

    for (const pattern of [/sk-[A-Za-z0-9-]{16,}/, /ghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/]) {
      expect(contents).not.toMatch(pattern)
    }
  })
})

describe('readEnvironment', () => {
  it('returns nothing for an empty environment', () => {
    expect(readEnvironment({})).toEqual({})
  })

  it('reads only what is set', () => {
    expect(readEnvironment({ FRIDAY_HOST: 'localhost' })).toEqual({ server: { host: 'localhost' } })
  })

  it('ignores variables that are not FRIDAY’s', () => {
    expect(readEnvironment({ PATH: '/usr/bin', HOME: '/Users/someone' })).toEqual({})
  })
})
