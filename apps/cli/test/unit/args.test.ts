import { formatBytes, formatTime, numberFlag, parseArgs, stringFlag } from '@friday/cli'
import { describe, expect, it } from 'vitest'

describe('parseArgs', () => {
  it('separates the command path from the flags', () => {
    const parsed = parseArgs(['events', 'tail', '--json'])

    expect(parsed.command).toEqual(['events', 'tail'])
    expect(parsed.flags).toEqual({ json: true })
  })

  it('accepts a flag value as the next token', () => {
    expect(parseArgs(['--since', '12']).flags).toEqual({ since: '12' })
  })

  it('accepts a flag value after an equals sign', () => {
    // Both forms exist in the wild and both get typed, so both work.
    expect(parseArgs(['--since=12']).flags).toEqual({ since: '12' })
  })

  it('keeps an equals sign inside a value', () => {
    expect(parseArgs(['--note=a=b']).flags).toEqual({ note: 'a=b' })
  })

  it('treats a flag followed by another flag as a bare flag', () => {
    expect(parseArgs(['--json', '--once']).flags).toEqual({ json: true, once: true })
  })

  it('treats a trailing flag as a bare flag', () => {
    expect(parseArgs(['status', '--json']).flags).toEqual({ json: true })
  })

  it('accepts single-dash short flags', () => {
    expect(parseArgs(['-n', '5']).flags).toEqual({ n: '5' })
  })

  it('returns an empty command for no arguments', () => {
    expect(parseArgs([]).command).toEqual([])
  })
})

describe('numberFlag', () => {
  it('falls back when the flag is absent', () => {
    expect(numberFlag({}, 'n', 20)).toBe(20)
  })

  it('reads a number', () => {
    expect(numberFlag({ n: '5' }, 'n', 20)).toBe(5)
  })

  it('returns undefined for a value that is not a number', () => {
    // Not the fallback: silently defaulting a mistyped --since would print the
    // whole log instead of the tail, which looks like a different bug.
    expect(numberFlag({ since: 'yesterday' }, 'since', 0)).toBeUndefined()
  })

  it('returns undefined for a flag given without a value', () => {
    expect(numberFlag({ n: true }, 'n', 20)).toBeUndefined()
  })
})

describe('stringFlag', () => {
  it('reads a value', () => {
    expect(stringFlag({ note: 'hello' }, 'note')).toBe('hello')
  })

  it('returns undefined for an absent or bare flag', () => {
    expect(stringFlag({}, 'note')).toBeUndefined()
    expect(stringFlag({ note: true }, 'note')).toBeUndefined()
  })
})

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB')
  })
})

describe('formatTime', () => {
  it('renders a 24-hour local time', () => {
    expect(formatTime(Date.now())).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})
