import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createDashboardFiles } from '@friday/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Serving the dashboard's files, and refusing everything else.
 *
 * ★ Most of these are about what is NOT served. A static handler's failure
 * mode is not "the page did not load" — it is handing out a file nobody meant
 * to publish, from a process that can read the owner's whole home directory.
 */

let root: string
let outside: string

/** A response that records what was written to it, without a socket. */
function fakeResponse() {
  const written: { status?: number; headers?: Record<string, string>; ended: boolean } = {
    ended: false,
  }

  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      written.status = status
      written.headers = headers
      return response
    },
    end() {
      written.ended = true
    },
  }

  return { response: response as unknown as ServerResponse, written }
}

function request(url: string, method = 'HEAD'): IncomingMessage {
  return { url, method } as IncomingMessage
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'friday-dash-'))
  outside = mkdtempSync(join(tmpdir(), 'friday-secret-'))

  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>FRIDAY</title>')
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(root, 'assets', 'index-abc123.css'), 'body{}')
  writeFileSync(join(outside, 'private.txt'), 'the owner would not want this served')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('what it serves', () => {
  it('serves the page at the root', () => {
    const { response, written } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/'), response)).toBe(true)
    expect(written.status).toBe(200)
    expect(written.headers?.['content-type']).toBe('text/html; charset=utf-8')
  })

  it('serves a fingerprinted asset', () => {
    const { response, written } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/assets/index-abc123.js'), response)).toBe(
      true,
    )
    expect(written.headers?.['content-type']).toBe('text/javascript; charset=utf-8')
  })

  it('ignores a query string, which the API uses and files do not', () => {
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/?x=1'), response)).toBe(true)
  })

  it('lets fingerprinted assets be cached forever, and the page never', () => {
    // index.html names the hashed assets. Caching it would serve an old page
    // pointing at assets that no longer exist after an update.
    const page = fakeResponse()
    const asset = fakeResponse()
    const files = createDashboardFiles(root)

    files.serve(request('/'), page.response)
    files.serve(request('/assets/index-abc123.css'), asset.response)

    expect(page.written.headers?.['cache-control']).toBe('no-cache')
    expect(asset.written.headers?.['cache-control']).toContain('immutable')
  })

  it('refuses to be framed, and refuses to be sniffed', () => {
    const { response, written } = fakeResponse()

    createDashboardFiles(root).serve(request('/'), response)

    expect(written.headers?.['x-frame-options']).toBe('DENY')
    expect(written.headers?.['x-content-type-options']).toBe('nosniff')
  })
})

describe('what it refuses, so the API still works', () => {
  it('does not claim a procedure call', () => {
    // ★ The collision that would break everything: procedure paths look like
    // filenames. They are not files, so the handler declines and the API
    // receives them exactly as before.
    const files = createDashboardFiles(root)

    for (const path of ['/events.list', '/approvals.pending', '/vitals.current']) {
      const { response } = fakeResponse()
      expect(files.serve(request(path), response), path).toBe(false)
    }
  })

  it('does not claim a request that writes', () => {
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/', 'POST'), response)).toBe(false)
  })

  it('does not invent a page for a path that is not a file', () => {
    // No single-page fallback. ADR-0041 gives the HUD no routes, and a
    // fallback would swallow every unknown API path into an HTML page.
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/settings'), response)).toBe(false)
  })

  it('serves nothing at all when the directory does not exist', () => {
    const { response } = fakeResponse()

    expect(createDashboardFiles(join(root, 'nope')).serve(request('/'), response)).toBe(false)
  })
})

describe('what it must never serve', () => {
  it('refuses to climb out of the directory', () => {
    // ★ The guard is on the RESOLVED path, not on spotting `..` in the input
    // — a check on the input is a check on one encoding of the attack.
    const files = createDashboardFiles(root)
    const escapes = [
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/....//....//etc/passwd',
    ]

    for (const path of escapes) {
      const { response } = fakeResponse()
      expect(files.serve(request(path), response), path).toBe(false)
    }
  })

  it('normalises a path that walks back inside, rather than refusing it', () => {
    // `/assets/../../index.html` IS `/index.html` by URL semantics — the
    // parser collapses it before this code sees it, and it never leaves the
    // directory. Refusing it would be refusing a legitimate request; the
    // guard is for encoded forms that survive normalisation.
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/assets/../../index.html'), response)).toBe(
      true,
    )
  })

  it('refuses an escape that lands on a real file', () => {
    // ★ The escape cases above all point at paths that do not exist, so
    // 'no such file' answers them and the containment check is never
    // exercised. This one resolves to a real, servable file outside the
    // bundle — and only the containment check can refuse it.
    writeFileSync(join(outside, 'leak.html'), '<p>not mine to serve</p>')
    // ★ `..%2f` specifically: the URL parser cannot normalise it away,
    // because the slash is encoded and the segment is not recognised as a
    // dot-segment. Decoding afterwards re-creates the traversal, so this is
    // the one shape that actually reaches the containment check.
    const escapePath = `/..%2f${basename(outside)}%2fleak.html`
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request(escapePath), response)).toBe(false)
  })

  it('refuses a directory that is named like a file it would serve', () => {
    // A bare directory is already refused for having no servable extension,
    // so only a directory named `something.css` reaches the is-it-a-file
    // check.
    mkdirSync(join(root, 'styles.css'))
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/styles.css'), response)).toBe(false)
  })

  it('refuses an absolute path to somewhere else', () => {
    const { response } = fakeResponse()

    expect(
      createDashboardFiles(root).serve(request(`/${join(outside, 'private.txt')}`), response),
    ).toBe(false)
  })

  it('refuses a file type the bundle should not contain', () => {
    // Serving bytes without knowing what they are is how a directory becomes
    // an exfiltration path.
    writeFileSync(join(root, 'notes.txt'), 'private')
    writeFileSync(join(root, 'id_rsa'), 'private')
    const files = createDashboardFiles(root)

    for (const path of ['/notes.txt', '/id_rsa']) {
      const { response } = fakeResponse()
      expect(files.serve(request(path), response), path).toBe(false)
    }
  })

  it('refuses a directory', () => {
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/assets'), response)).toBe(false)
  })

  it('refuses a symlink pointing out of the directory', () => {
    symlinkSync(join(outside, 'private.txt'), join(root, 'leak.html'))
    const { response } = fakeResponse()

    expect(createDashboardFiles(root).serve(request('/leak.html'), response)).toBe(false)
  })
})
