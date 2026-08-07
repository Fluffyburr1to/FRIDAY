import { homedir } from 'node:os'
import { join } from 'node:path'
import { expandPath } from '@friday/config'
import { describe, expect, it } from 'vitest'

describe('expandPath', () => {
  it('expands a bare tilde to the home directory', () => {
    expect(expandPath('~')).toBe(homedir())
  })

  it('expands a leading tilde in a path', () => {
    // Nothing in Node expands `~` — it is a shell convention — so a path
    // copied out of .env.example would otherwise create a literal `~` folder.
    expect(expandPath('~/Library/Logs/FRIDAY')).toBe(join(homedir(), 'Library/Logs/FRIDAY'))
  })

  it('leaves an absolute path alone', () => {
    expect(expandPath('/var/friday')).toBe('/var/friday')
  })

  it('resolves a relative path', () => {
    expect(expandPath('data')).toBe(join(process.cwd(), 'data'))
  })
})
