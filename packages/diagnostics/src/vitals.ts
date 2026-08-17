import { statfs } from 'node:fs/promises'
import { cpus } from 'node:os'
import type { RuntimeVitals, Vital, VitalState } from '@friday/contracts'

/**
 * Reading what the FRIDAY runtime is doing.
 *
 * ★ Every number here describes **this process**, not the machine — Chapter
 * 29's `friday_cpu_percent`, `friday_memory_bytes`, `friday_uptime_seconds`,
 * `friday_disk_free_bytes`. Host equivalents are banned by ADR-0042 §2, and a
 * test asserts their absence, because substituting one is a silent failure: a
 * host number under a FRIDAY label looks exactly like a correct reading.
 *
 * The single `node:os` call is the core count, used as a divisor. That is
 * machine shape, not a host utilisation reading.
 *
 * No `Result`: a vital that cannot be read is already representable as an
 * absent reading with a reason, so one dead metric degrades one row instead of
 * failing a panel showing three good ones.
 *
 * Reference: docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
 */

/** Past this age a stored CPU sample is too old to average against. */
const STALE_SAMPLE_MS = 10_000

/** The window a first-ever read averages over, having nothing to diff against. */
const COLD_SAMPLE_MS = 120

const MICROSECONDS_PER_MS = 1000
const BYTES_PER_MB = 1024 ** 2
const BYTES_PER_GB = 1024 ** 3

/** Cumulative CPU time consumed by this process, in microseconds. */
interface CpuSample {
  readonly used: number
  readonly at: number
}

export interface VitalsReader {
  /** @returns Every vital, each either measured or absent with a reason. */
  read(): Promise<RuntimeVitals>
}

function sampleCpu(): CpuSample {
  const usage = process.cpuUsage()
  return { used: usage.user + usage.system, at: Date.now() }
}

/** Thresholds are judgements, held here so the HUD renders one. ADR-0042 §5. */
function classify(value: number, warning: number, critical: number): VitalState {
  if (value >= critical) return 'critical'
  if (value >= warning) return 'warning'
  return 'healthy'
}

function measured(input: {
  id: Vital['id']
  label: string
  unit: Vital['unit']
  value: number
  state?: VitalState
  qualifier?: string
}): Vital {
  const { id, label, unit, value, state, qualifier } = input

  return {
    id,
    label,
    unit,
    reading: {
      status: 'measured',
      // One decimal is all these carry honestly, and it stops the digits
      // jittering on a screen that stays open all day.
      value: Math.round(value * 10) / 10,
      // Omitted rather than defaulted: no verdict is not the same as healthy.
      ...(state === undefined ? {} : { state }),
      ...(qualifier === undefined ? {} : { qualifier }),
    },
  }
}

function absent(input: { id: Vital['id']; label: string; reason: string; needs: string }): Vital {
  const { id, label, reason, needs } = input
  return { id, label, unit: '', reading: { status: 'absent', reason, needs } }
}

/**
 * `friday_disk_free_bytes` — headroom on the volume holding her databases.
 *
 * Uses the `df` convention, used over used-plus-available, because that is what
 * every other tool will tell the owner.
 *
 * @param path - FRIDAY's data directory.
 * @returns The disk vital, absent if the filesystem could not be queried.
 */
async function readDisk(path: string): Promise<Vital> {
  try {
    const fs = await statfs(path)
    const blockSize = Number(fs.bsize)
    const used = (Number(fs.blocks) - Number(fs.bfree)) * blockSize
    const available = Number(fs.bavail) * blockSize
    const capacity = used + available

    if (capacity <= 0) {
      return absent({
        id: 'disk',
        label: 'Disk',
        reason: 'The filesystem reported no usable capacity.',
        needs: `A readable filesystem at ${path}`,
      })
    }

    const percent = (used / capacity) * 100

    return measured({
      id: 'disk',
      label: 'Disk',
      unit: '%',
      value: percent,
      // Chapter 29's alerting sets free < 5% as critical — "this is what stops
      // the audit trail". The warning level is a judgement.
      state: classify(percent, 85, 95),
      qualifier: `${(available / BYTES_PER_GB).toFixed(0)} GB free for her data`,
    })
  } catch (cause) {
    return absent({
      id: 'disk',
      label: 'Disk',
      reason: `FRIDAY's data directory could not be read: ${(cause as Error).message}`,
      needs: `A readable path at ${path}`,
    })
  }
}

/** `friday_memory_bytes` — this process's resident set size. */
function readMemory(): Vital {
  const rss = process.memoryUsage().rss / BYTES_PER_MB

  return measured({
    id: 'memory',
    label: 'Memory',
    unit: 'MB',
    value: rss,
    // A background Node service on a personal Mac past these is leaking.
    state: classify(rss, 512, 1024),
    qualifier: 'resident, this process',
  })
}

/** `friday_uptime_seconds` — how long this process has been running. */
function readUptime(): Vital {
  const seconds = process.uptime()

  // Adaptive unit, so a two-minute-old process does not read "0.0 h".
  const [value, unit] =
    seconds < 90
      ? [seconds, 's' as const]
      : seconds < 5400
        ? [seconds / 60, 'm' as const]
        : [seconds / 3600, 'h' as const]

  // No state: no duration makes uptime a problem, and "healthy" would be a
  // verdict nobody formed. ADR-0042 §4.
  return measured({ id: 'uptime', label: 'Uptime', unit, value, qualifier: 'since she started' })
}

/**
 * Builds a reader that remembers its last CPU sample.
 *
 * Stateful on purpose: CPU is a rate, and the cheapest correct interval on a
 * polling surface is the gap between two polls.
 *
 * @param input - Where FRIDAY's data lives, used to pick the disk volume.
 * @returns A reader safe to call on an interval.
 */
export function createVitalsReader(input: { dataDir: string }): VitalsReader {
  let previous: CpuSample | undefined

  async function readCpu(): Promise<{ vital: Vital; intervalMs: number }> {
    let earlier = previous

    // No usable history: take a real short sample rather than reporting an idle
    // process nobody measured.
    if (earlier === undefined || Date.now() - earlier.at > STALE_SAMPLE_MS) {
      earlier = sampleCpu()
      await new Promise((resolve) => setTimeout(resolve, COLD_SAMPLE_MS))
    }

    const current = sampleCpu()
    previous = current
    const intervalMs = current.at - earlier.at

    if (intervalMs <= 0) {
      return {
        intervalMs,
        vital: absent({
          id: 'cpu',
          label: 'CPU',
          reason: 'Two samples landed in the same millisecond.',
          needs: 'A longer interval between reads',
        }),
      }
    }

    // Dividing by the core count makes this a share of the whole machine and
    // bounds it at 100. A per-core figure would exceed that and the panel's bar
    // would stop meaning anything.
    const cores = cpus().length
    const usedMs = (current.used - earlier.used) / MICROSECONDS_PER_MS
    const percent = Math.min(100, Math.max(0, (usedMs / (intervalMs * cores)) * 100))

    return {
      intervalMs,
      vital: measured({
        id: 'cpu',
        label: 'CPU',
        unit: '%',
        value: percent,
        state: classify(percent, 50, 80),
        qualifier: `her share of ${cores} cores`,
      }),
    }
  }

  return {
    async read(): Promise<RuntimeVitals> {
      const [cpu, disk] = await Promise.all([readCpu(), readDisk(input.dataDir)])

      return {
        measuredAt: Date.now(),
        sampleIntervalMs: cpu.intervalMs,
        vitals: [
          cpu.vital,
          readMemory(),
          disk,
          readUptime(),

          // ★ Declared absent, not omitted. The owner asked for both; dropping
          // the rows would answer him with silence, and a host substitute is
          // forbidden. ADR-0042 §3.
          absent({
            id: 'temperature',
            label: 'Temp',
            reason:
              'No FRIDAY-scoped temperature exists, and the host sensor needs elevated privileges.',
            needs: 'A native sampler — ADR-0042 §3',
          }),
          absent({
            id: 'network',
            label: 'Network',
            reason: 'Chapter 29 defines no FRIDAY-scoped network metric.',
            needs: 'A metric contract, then a sampler — ADR-0042 §3',
          }),
        ],
      }
    },
  }
}
