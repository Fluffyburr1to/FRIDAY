import { type ConnectorObserver, createConnectorRuntime } from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  isErr,
  isOk,
} from '@friday/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'example-notes',
  service: 'Example Notes',
  version: '1.0.0',
  auth: { type: 'none', scopes: [], scopeJustification: {} },
  egress: {
    hosts: ['api.example-notes.test'],
    dataCategories: ['note_contents'],
    transmitsPersonalData: true,
    dataRetentionByProvider: 'Per the provider terms',
  },
  operations: [
    {
      id: 'list-notes',
      description: 'List notes',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['note_contents'],
      writes: [],
      timeoutMs: 30_000,
    },
    {
      id: 'create-note',
      description: 'Add a note',
      riskClass: 'medium',
      idempotent: false,
      irreversible: false,
      reads: [],
      writes: ['note_contents'],
      timeoutMs: 30_000,
    },
  ],
  rateLimits: { requestsPerMinute: 60, burstSize: 3 },
  healthCheck: { operation: 'list-notes', intervalSeconds: 300 },
  supportsDryRun: true,
})

const READ = MANIFEST.operations[0] as ConnectorOperation
const WRITE = MANIFEST.operations[1] as ConnectorOperation
const URL_OK = 'https://api.example-notes.test/notes'

type Observed<K extends keyof ConnectorObserver> = Parameters<NonNullable<ConnectorObserver[K]>>[0]

let clock: number
let slept: number[]
let seen: {
  blocked: Observed<'onBlocked'>[]
  called: Observed<'onCalled'>[]
  degraded: Observed<'onDegraded'>[]
  recovered: Observed<'onRecovered'>[]
}
let observer: ConnectorObserver

/** The one entry a test expects, or a failure that says which list was empty. */
function only<T>(items: T[], what: string): T {
  const [first] = items
  if (first === undefined) throw new Error(`expected one ${what}, got none`)
  return first
}

beforeEach(() => {
  clock = 0
  slept = []
  seen = { blocked: [], called: [], degraded: [], recovered: [] }
  observer = {
    onBlocked: (e) => seen.blocked.push(e),
    onCalled: (e) => seen.called.push(e),
    onDegraded: (e) => seen.degraded.push(e),
    onRecovered: (e) => seen.recovered.push(e),
  }
})

function runtime(fetchImpl: typeof globalThis.fetch, overrides = {}) {
  return createConnectorRuntime({
    manifest: MANIFEST,
    fetch: fetchImpl,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms)
      clock += ms
      return Promise.resolve()
    },
    random: () => 0.5,
    observer,
    ...overrides,
  })
}

const respond = (status: number, headers: Record<string, string> = {}) =>
  vi.fn(() => Promise.resolve(new Response('{}', { status, headers })))

describe('ADR-0049 invariant 3: every allowed call resolves its probe', () => {
  /**
   * Every distinct way a call can end, driven to a half-open circuit.
   *
   * ★ Enumerated as data rather than written out one by one, so that a new
   * exit path added to the runtime without a matching entry here is a visible
   * omission rather than a silent one. A held probe and a returned one leave
   * the circuit in the same state, so nothing else in these tests would catch
   * it — the wedge bug survived exactly that blind spot.
   */
  const ENDINGS: ReadonlyArray<{
    readonly name: string
    readonly respond: () => typeof globalThis.fetch
    readonly url?: string
  }> = [
    { name: 'the provider answers', respond: () => respond(200) as never },
    { name: 'the provider fails', respond: () => respond(500) as never },
    { name: 'the provider throttles', respond: () => respond(429) as never },
    { name: 'the provider refuses outright', respond: () => respond(404) as never },
    {
      name: 'the boundary blocks the host',
      respond: () => respond(200) as never,
      url: 'https://evil.test/x',
    },
    {
      name: 'the boundary refuses plain http',
      respond: () => respond(200) as never,
      url: 'http://api.example-notes.test/notes',
    },
    {
      name: 'the url is not a url',
      respond: () => respond(200) as never,
      url: 'not a url',
    },
    {
      name: 'the transport rejects',
      respond: () => vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as never,
    },
  ]

  it.each(ENDINGS)('hands the probe back when $name', async ({ respond: build, url }) => {
    const runner = runtime(build())

    // Open the circuit, then step into half-open so a probe is reserved.
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    clock += 60_000

    await runner.fetch(READ, url ?? URL_OK)

    expect(runner.state().probeOutstanding, 'a probe was reserved and never resolved').toBe(false)
  })

  it('holds nothing outstanding on a circuit that was never opened', async () => {
    const runner = runtime(respond(200) as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, URL_OK)

    expect(runner.state().probeOutstanding).toBe(false)
  })

  it('holds nothing outstanding after the circuit refuses a call outright', async () => {
    const runner = runtime(respond(500) as unknown as typeof globalThis.fetch)
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    // Circuit open, no time passed: refused before any probe is reserved.
    await runner.fetch(READ, URL_OK)

    expect(runner.state().probeOutstanding).toBe(false)
  })
})

describe('the order the controls run in', () => {
  it('does not spend a token on a call the circuit refuses', async () => {
    // ★ A service that is down should cost nothing — not a token, not a DNS
    // lookup. If the limiter ran first, an outage would drain the bucket and
    // slow FRIDAY down once the service came back.
    const fetchImpl = respond(500)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000 // refill the bucket between calls
      await runner.fetch(READ, URL_OK)
    }

    // The clock deliberately does not move here: any refill would mask
    // whether a token was spent, which is the whole assertion.
    const tokensWhileOpen = runner.state().tokens
    await runner.fetch(READ, URL_OK)

    expect(runner.state().breaker).toBe('open')
    expect(runner.state().tokens).toBe(tokensWhileOpen)
  })

  it('refuses immediately once the circuit is open, without calling out', async () => {
    const fetchImpl = respond(500)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    const callsBefore = fetchImpl.mock.calls.length

    const result = await runner.fetch(READ, URL_OK)

    expect(isErr(result)).toBe(true)
    expect(fetchImpl.mock.calls.length).toBe(callsBefore)
  })
})

describe('what the owner is told', () => {
  it('reports every call, however it ended', async () => {
    const runner = runtime(respond(200) as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, URL_OK, { correlationId: 'cor_1' })

    expect(seen.called).toHaveLength(1)
    expect(only(seen.called, 'call')).toMatchObject({
      connectorId: 'example-notes',
      operationId: 'list-notes',
      outcome: 'succeeded',
      status: 200,
      attempts: 1,
      correlationId: 'cor_1',
    })
  })

  it('reports a blocked host, and calls it a refusal rather than a failure', async () => {
    // ★ FRIDAY declining to make a call is not the same event as a call that
    // went out and did not work. A dashboard that merged them would report
    // our own safety controls as provider outages.
    const fetchImpl = respond(200)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, 'https://evil.test/collect')

    expect(only(seen.blocked, 'block')).toMatchObject({
      host: 'evil.test',
      reason: 'undeclared_host',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('says when it has stopped calling a service, and when it may try again', async () => {
    const runner = runtime(respond(500) as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    expect(seen.degraded).toHaveLength(1)
    expect(only(seen.degraded, 'degraded')).toMatchObject({ connectorId: 'example-notes' })
    expect(only(seen.degraded, 'degraded').retryAt).toBeGreaterThan(clock)
  })

  it('says only once, not on every refused call afterwards', async () => {
    const runner = runtime(respond(500) as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 8; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    expect(seen.degraded).toHaveLength(1)
  })
})

describe('recovering, which the circuit must actually be able to do', () => {
  /** Drives the circuit open and returns the runtime. */
  async function opened(fetchImpl: typeof globalThis.fetch) {
    const runner = runtime(fetchImpl)
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    expect(runner.state().breaker).toBe('open')
    return runner
  }

  it('does not wedge itself half-open when a probe also fails', async () => {
    // ★ The bug this test exists for: the breaker used to be consulted once
    // per retry ATTEMPT. In half-open the first attempt reserves the single
    // probe, and the retry immediately after was refused by that same
    // reservation — so no outcome was ever recorded, the probe was never
    // released, and the circuit stayed half-open forever. One outage wedged a
    // connector permanently, and nothing said so.
    const runner = await opened(respond(500) as unknown as typeof globalThis.fetch)

    for (let round = 0; round < 4; round++) {
      clock += 120_000
      await runner.fetch(READ, URL_OK)
      expect(runner.state().breaker, `after probe ${round + 1}`).toBe('open')
    }
  })

  it('closes again once the service answers', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    const runner = await opened(fetchImpl as unknown as typeof globalThis.fetch)

    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 120_000
    const result = await runner.fetch(READ, URL_OK)

    expect(isOk(result)).toBe(true)
    expect(runner.state().breaker).toBe('closed')
  })

  it('says when it is working again, and for how long it was not', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    const runner = await opened(fetchImpl as unknown as typeof globalThis.fetch)

    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 120_000
    await runner.fetch(READ, URL_OK)

    expect(seen.recovered).toHaveLength(1)
    expect(only(seen.recovered, 'recovery').degradedForMs).toBeGreaterThan(0)
  })

  it('reports becoming degraded once per outage, not once per probe', async () => {
    // A service down for a day must not write 1,440 identical events into a
    // log that is also the audit trail.
    const runner = await opened(respond(500) as unknown as typeof globalThis.fetch)

    for (let round = 0; round < 5; round++) {
      clock += 120_000
      await runner.fetch(READ, URL_OK)
    }

    expect(seen.degraded).toHaveLength(1)
  })

  it('reports degrading again after a genuine recovery in between', async () => {
    // The counterpart: two separate outages are two events, not one.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    const runner = await opened(fetchImpl as unknown as typeof globalThis.fetch)

    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 120_000
    await runner.fetch(READ, URL_OK)

    fetchImpl.mockResolvedValue(new Response('', { status: 500 }))
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    expect(seen.degraded).toHaveLength(2)
  })
})

describe('a call allowed through but never sent', () => {
  /**
   * A bucket that refills far more slowly than the circuit re-probes.
   *
   * That gap is the point: it produces the one state the probe-release path
   * exists for — the circuit is willing to try, and our own limiter is not.
   */
  const TRICKLE = ConnectorManifestSchema.parse({
    ...MANIFEST,
    rateLimits: { requestsPerMinute: 1, burstSize: 1 },
  })

  function trickleRuntime(fetchImpl: typeof globalThis.fetch) {
    return createConnectorRuntime({
      manifest: TRICKLE,
      fetch: fetchImpl,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms)
        clock += ms
        return Promise.resolve()
      },
      breaker: { failureThreshold: 5, openMs: 1_000 },
      observer,
    })
  }

  it('hands the probe back rather than wedging or closing the circuit', async () => {
    // ★ Two opposite failures avoided at once. Keeping the probe would leave
    // the circuit unable to ever try again; recording a success would close it
    // on the strength of a request that was never made.
    const runner = trickleRuntime(respond(500) as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    expect(runner.state().breaker).toBe('open')

    // The circuit is willing to probe after a second; the bucket needs a
    // minute. So this call is allowed through and then never sent.
    clock += 1_001
    const result = await runner.fetch(READ, URL_OK)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.detail).toMatchObject({ throttled: true })

    // Not closed — nothing proved the service works. Not stuck — the probe
    // came back, so the next attempt is allowed.
    expect(runner.state().breaker).toBe('half_open')
  })

  it('leaves the next probe available, rather than consuming it', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    const runner = trickleRuntime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    clock += 1_001
    await runner.fetch(READ, URL_OK)

    // Now the bucket has refilled too, so the probe should actually go out.
    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 60_000
    const result = await runner.fetch(READ, URL_OK)

    expect(isOk(result)).toBe(true)
    expect(runner.state().breaker).toBe('closed')
  })
})

describe('being throttled counts against the service', () => {
  it('stops calling something that keeps refusing us', async () => {
    // A 429 is the service working correctly and telling us to back off. Our
    // own limiter should have prevented it, so persistent 429s mean something
    // is wrong and hammering harder is the wrong answer.
    const runner = runtime(respond(429) as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    expect(runner.state().breaker).toBe('open')
  })
})

describe('a refusal at our own boundary is not the provider failing', () => {
  it('does not wedge a half-open circuit when the boundary refuses', async () => {
    // A manifest mistake discovered exactly while the circuit is probing must
    // hand the probe back. Otherwise one bad URL during an outage leaves the
    // connector unable to ever recover.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    expect(runner.state().breaker).toBe('open')

    // Half-open. The probe is reserved, then the boundary refuses the call.
    clock += 60_000
    await runner.fetch(READ, 'https://evil.test/x')

    // ★ The service is healthy again — but the probe has to have come back for
    // that to be discoverable. Asserting on the state alone cannot tell a
    // returned probe from a held one; only a call that actually goes out can.
    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 1
    const result = await runner.fetch(READ, URL_OK)

    expect(isOk(result)).toBe(true)
    expect(runner.state().breaker).toBe('closed')
  })

  it('does not wipe out the record of real failures', async () => {
    // ★ A blocked host is not a success. Recording one would reset the
    // consecutive-failure count, so four genuine outages followed by one
    // manifest mistake would look like a service in perfect health.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 4; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }

    clock += 60_000
    await runner.fetch(READ, 'https://evil.test/x')

    // The fifth real failure must still be the fifth.
    clock += 60_000
    await runner.fetch(READ, URL_OK)

    expect(runner.state().breaker).toBe('open')
  })

  it('does not open the circuit when a manifest is wrong', async () => {
    // ★ Otherwise a configuration mistake presents as an outage, and the owner
    // goes to read somebody else's status page.
    const runner = runtime(respond(200) as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 10; i++) {
      clock += 60_000
      await runner.fetch(READ, 'https://evil.test/collect')
    }

    expect(runner.state().breaker).toBe('closed')
    expect(seen.degraded).toEqual([])
  })
})

describe('retrying, in the composed path', () => {
  it('tries a 503 again for an idempotent operation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    const result = await runner.fetch(READ, URL_OK)

    expect(isOk(result)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(only(seen.called, 'call')).toMatchObject({ attempts: 2, outcome: 'succeeded' })
  })

  it('does not try a 503 again for an operation that would duplicate', async () => {
    // The rule that matters: no idempotency key, no second attempt.
    const fetchImpl = respond(503)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(WRITE, URL_OK, { method: 'POST' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('tries again for a write once the provider can deduplicate it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(WRITE, URL_OK, { method: 'POST', idempotencyKey: 'idem_1' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('waits as long as the provider asked, not as long as it guessed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, URL_OK)

    expect(slept).toContain(7_000)
  })

  it('stops rather than waiting an hour it was asked to wait', async () => {
    const fetchImpl = respond(429, { 'retry-after': '3600' })
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, URL_OK)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(slept).not.toContain(3_600_000)
  })

  it('never retries a blocked host', async () => {
    const fetchImpl = respond(200)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, 'https://evil.test/x')

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(slept).toEqual([])
  })
})

describe('the rate limit, applied before the request', () => {
  it('waits for a token rather than being throttled by the provider', async () => {
    const fetchImpl = respond(200)
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 4; i++) await runner.fetch(READ, URL_OK)

    expect(slept.length).toBeGreaterThan(0)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('gives up rather than waiting without bound', async () => {
    // ★ Chapter 14 forbids unbounded waits as firmly as it requires timeouts.
    // A queue behind a slow bucket is an unbounded wait wearing a hat.
    const slow = ConnectorManifestSchema.parse({
      ...MANIFEST,
      rateLimits: { requestsPerMinute: 1, burstSize: 1 },
    })
    const fetchImpl = respond(200)
    const runner = createConnectorRuntime({
      manifest: slow,
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms)
        clock += ms
        return Promise.resolve()
      },
      observer,
    })

    await runner.fetch(READ, URL_OK)
    const result = await runner.fetch(READ, URL_OK)

    expect(isErr(result)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(seen.called[1]).toMatchObject({ outcome: 'refused' })
  })
})
