import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { openContext, type RunningServer, startServer } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createInMemoryKeyProvider, KEY_LENGTH_BYTES, type KeyProvider } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The dashboard and the API, over one real socket.
 *
 * ★ Everything here goes over HTTP to a listening server rather than through
 * a router caller. The thing being proved is that a browser — and the desktop
 * window, which loads the same address — gets the page AND its data from one
 * origin. A test through the caller would prove the procedures work and say
 * nothing about the property that matters.
 *
 * Reference: docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md §10
 */

const FIELD_KEY_REF = 'friday-field-key'
const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname

describe('serving the dashboard beside the API', () => {
  let directory: string
  let bundle: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider
  let running: RunningServer | undefined
  let close: (() => void) | undefined

  /** Starts core on a free port, optionally serving a dashboard build. */
  async function start(dashboardDir?: string): Promise<string> {
    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)
    close = opened.value.close

    running = await startServer({
      config: { ...config, server: { ...config.server, port: 0 } },
      context: opened.value.context,
      ...(dashboardDir === undefined ? {} : { dashboardDir }),
    })

    return `http://${config.server.host}:${running.port}`
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-core-'))
    bundle = mkdtempSync(join(tmpdir(), 'friday-bundle-'))

    // Shaped like a real Vite build: a page that names a fingerprinted asset.
    mkdirSync(join(bundle, 'assets'))
    writeFileSync(
      join(bundle, 'index.html'),
      '<!doctype html><html><head><script type="module" src="/assets/index-a1b2c3.js"></script></head><body><div id="root"></div></body></html>',
    )
    writeFileSync(join(bundle, 'assets', 'index-a1b2c3.js'), 'export const hud = true')

    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_POLICIES_DIR = POLICY_DIR

    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(`test setup could not load config: ${loaded.error.message}`)
    config = loaded.value

    keys = createInMemoryKeyProvider({
      [FIELD_KEY_REF]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
    })
  })

  afterEach(async () => {
    await running?.close()
    close?.()
    running = undefined
    close = undefined

    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
    rmSync(bundle, { recursive: true, force: true })
  })

  it('serves the page and its data from the same origin', async () => {
    // ★ The property the desktop shell depends on. If these came from two
    // origins, core would need CORS — and the window would need its own copy
    // of the interface rather than being a window.
    const origin = await start(bundle)

    const page = await fetch(`${origin}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('id="root"')

    const input = encodeURIComponent(JSON.stringify({ limit: 1 }))
    const api = await fetch(`${origin}/events.list?input=${input}`)
    expect(api.status).toBe(200)
  })

  it('serves the fingerprinted asset the page asks for', async () => {
    const origin = await start(bundle)

    const asset = await fetch(`${origin}/assets/index-a1b2c3.js`)

    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')
  })

  it('does not let the page be cached, so an update is never half-applied', async () => {
    const origin = await start(bundle)

    const page = await fetch(`${origin}/`)

    expect(page.headers.get('cache-control')).toBe('no-cache')
  })

  it('leaves every procedure reachable', async () => {
    // The collision that would break everything: a procedure path could have
    // been swallowed by the file handler.
    const origin = await start(bundle)

    for (const procedure of ['events.list', 'approvals.pending', 'vitals.current']) {
      const input = encodeURIComponent(JSON.stringify({ limit: 1 }))
      const response = await fetch(`${origin}/${procedure}?input=${input}`)

      expect(response.status, procedure).toBe(200)
    }
  })

  it('is the API and nothing else when no dashboard is configured', async () => {
    // Every existing caller passes no dashboard, and must be unaffected.
    const origin = await start()

    const page = await fetch(`${origin}/`)
    expect(page.status).not.toBe(200)

    const input = encodeURIComponent(JSON.stringify({ limit: 1 }))
    expect((await fetch(`${origin}/events.list?input=${input}`)).status).toBe(200)
  })

  it('refuses to serve a file from outside the build', async () => {
    // ★ Over a real socket, because the traversal that matters is the one an
    // HTTP client can actually send.
    const origin = await start(bundle)
    writeFileSync(join(directory, 'private.html'), '<p>not mine to serve</p>')

    const escaped = await fetch(`${origin}/..%2f..%2fprivate.html`)

    expect(escaped.status).not.toBe(200)
  })
})
