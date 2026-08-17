import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { RuntimeVitalsSchema, type Vital } from '@friday/contracts'
import { createVitalsReader } from '@friday/diagnostics'
import { describe, expect, it } from 'vitest'

/**
 * The vitals reader, and the semantics of what it measures.
 *
 * ── What these are really guarding ───────────────────────────────────────────
 *
 * Not "does a number render". The failure this suite exists to catch is a
 * **host metric substituted for a FRIDAY metric** — the mistake the first
 * implementation made, which produced a plausible, prominent, wrong 98.9%
 * memory reading. Chapter 29 scopes these to the process; several assertions
 * below check the scope rather than the value.
 *
 * They run against the real process rather than a mocked `node:os`, because a
 * mock would assert only that the fixture matches itself.
 *
 * Reference: docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
 */

const reader = () => createVitalsReader({ dataDir: tmpdir() })

const SOURCE = new URL('../../src/vitals.ts', import.meta.url).pathname

function vital(vitals: readonly Vital[], id: Vital['id']): Vital {
  const found = vitals.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no vital with id ${id}`)
  return found
}

describe('createVitalsReader', () => {
  it('produces a reading that satisfies the wire contract', async () => {
    const reading = await reader().read()
    expect(() => RuntimeVitalsSchema.parse(reading)).not.toThrow()
  })

  it('reports every declared vital, including the ones it cannot measure', async () => {
    const reading = await reader().read()

    // A metric the owner asked for and cannot have is answered with a reason,
    // never by dropping the row.
    expect(reading.vitals.map((entry) => entry.id).sort()).toEqual([
      'cpu',
      'disk',
      'memory',
      'network',
      'temperature',
      'uptime',
    ])
  })

  it('derives CPU from this process, as a bounded share of the machine', async () => {
    const vitals = reader()
    await vitals.read()

    // Burn a little CPU so the second sample has something to measure.
    const until = Date.now() + 60
    while (Date.now() < until) {
      /* deliberate busy wait */
    }

    const reading = await vitals.read()
    const cpu = vital(reading.vitals, 'cpu')

    expect(cpu.reading.status).toBe('measured')
    if (cpu.reading.status !== 'measured') return

    // Bounded because the figure is divided by the core count. A per-core
    // reading would exceed 100 and the panel's bar would be meaningless.
    expect(cpu.reading.value).toBeGreaterThanOrEqual(0)
    expect(cpu.reading.value).toBeLessThanOrEqual(100)
    expect(cpu.reading.qualifier).toMatch(/her share of \d+ cores/)
    expect(reading.sampleIntervalMs).toBeGreaterThan(0)
  })

  it('averages the second read over the gap since the first', async () => {
    const vitals = reader()
    await vitals.read()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect((await vitals.read()).sampleIntervalMs).toBeGreaterThanOrEqual(150)
  })

  it('reports memory as this process resident set size, in megabytes', async () => {
    const reading = await reader().read()
    const memory = vital(reading.vitals, 'memory')

    expect(memory.reading.status).toBe('measured')
    if (memory.reading.status !== 'measured') return

    expect(memory.unit).toBe('MB')
    expect(memory.reading.qualifier).toBe('resident, this process')

    // ★ Scope check. RSS of a Node test process is tens to hundreds of MB. A
    // host-memory figure would be a percentage or many thousands of MB, so this
    // range is what distinguishes `friday_memory_bytes` from the substitution.
    expect(memory.reading.value).toBeGreaterThan(0)
    expect(memory.reading.value).toBeLessThan(4096)
    expect(memory.reading.value).toBeCloseTo(process.memoryUsage().rss / 1024 ** 2, -1)
  })

  it('reports uptime as this process uptime, with no verdict', async () => {
    const reading = await reader().read()
    const uptime = vital(reading.vitals, 'uptime')

    expect(uptime.reading.status).toBe('measured')
    if (uptime.reading.status !== 'measured') return

    // ★ Scope check. A fresh test process has been up for seconds; the host has
    // been up for hours or days, so `os.uptime()` could not produce this.
    expect(uptime.reading.value).toBeLessThan(process.uptime() + 5)
    expect(uptime.reading.qualifier).toBe('since she started')

    // No duration makes uptime a problem, so it carries no state. Absent state
    // is not the same as healthy. ADR-0042 §4.
    expect(uptime.reading.state).toBeUndefined()
  })

  it('measures disk on the volume it was pointed at', async () => {
    const reading = await reader().read()
    const disk = vital(reading.vitals, 'disk')

    expect(disk.reading.status).toBe('measured')
    if (disk.reading.status !== 'measured') return

    expect(disk.reading.value).toBeGreaterThan(0)
    expect(disk.reading.value).toBeLessThanOrEqual(100)
    expect(disk.reading.qualifier).toMatch(/GB free for her data$/)
  })

  it('degrades only the disk row when the data directory cannot be read', async () => {
    const reading = await createVitalsReader({ dataDir: '/nonexistent-path-for-this-test' }).read()

    expect(vital(reading.vitals, 'disk').reading.status).toBe('absent')

    // One unreadable source degrades one row; the rest still report.
    expect(vital(reading.vitals, 'memory').reading.status).toBe('measured')
    expect(vital(reading.vitals, 'uptime').reading.status).toBe('measured')
  })

  it('marks temperature and network absent, each with an actionable reason', async () => {
    const reading = await reader().read()

    for (const id of ['temperature', 'network'] as const) {
      const entry = vital(reading.vitals, id)
      expect(entry.reading.status, id).toBe('absent')
      if (entry.reading.status !== 'absent') continue

      expect(entry.reading.reason.trim(), `${id} reason`).not.toBe('')
      expect(entry.reading.needs.trim(), `${id} needs`).not.toBe('')

      // Never a fabricated value alongside the absence.
      expect(entry.reading).not.toHaveProperty('value')
    }
  })

  it('classifies only the vitals with a defensible threshold', async () => {
    const reading = await reader().read()
    const rated = reading.vitals.filter(
      (entry) => entry.reading.status === 'measured' && entry.reading.state !== undefined,
    )

    // Uptime is deliberately excluded. A change that starts rating it should
    // fail here and be argued for.
    expect(rated.map((entry) => entry.id).sort()).toEqual(['cpu', 'disk', 'memory'])
  })

  it('never reaches for a host metric', () => {
    // Comments stripped first: the ban in ADR-0042 §2 is on *calling* these,
    // not on naming them, and the module's own header explains why they are
    // forbidden. Scanning raw source would make documenting the rule break it.
    const code = readFileSync(SOURCE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // ★ Asserted against the source because the failure these cause is silent:
    // a host number under a FRIDAY-scoped label looks exactly like a correct
    // reading. That is the mistake this whole ADR was written after.
    expect(code).not.toMatch(/\bfreemem\b/)
    expect(code).not.toMatch(/\bloadavg\b/)
    expect(code).not.toMatch(/os\.uptime\b/)

    // The one permitted `os` call is the core count, used as a divisor.
    expect(code).toMatch(/cpus\(\)\.length/)
  })

  it('has no unrated state anywhere in the contract', async () => {
    const reading = await reader().read()

    for (const entry of reading.vitals) {
      if (entry.reading.status !== 'measured') continue
      expect(entry.reading.state).not.toBe('unrated')
    }
  })
})
