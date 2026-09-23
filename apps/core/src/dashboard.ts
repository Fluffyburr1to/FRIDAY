import { createReadStream, realpathSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

/**
 * Serving the dashboard's files from the same origin as the API.
 *
 * ★ **Why core serves the bundle rather than the shell embedding it.**
 * [Chapter 06](../../../docs/01-bible/06-frontend-architecture.md) already
 * says the browser surface is *"served directly by friday-core"*, and
 * `apps/web/vite.config.ts` already says *"in production `apps/core` serves
 * this bundle itself"* — neither was true, and the dashboard reached the API
 * at a same-origin path that nothing served. This makes the claim true.
 *
 * ★★ **It is also what keeps the desktop shell honest.** The window and the
 * browser load the *same bytes from the same origin*, so
 * [ADR-0052](../../../docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md)
 * §10 — "the shell has exactly the browser's authority" — is a structural
 * fact rather than a promise. The alternative, bundling the UI into the app
 * and letting it call `127.0.0.1` cross-origin, would require CORS on core;
 * the vite config's own comment explains why not having a CORS surface is
 * worth keeping: *"a server with no CORS surface cannot have it misconfigured
 * later."*
 *
 * What this deliberately is not: a general web server. No directory listing,
 * no single-page fallback, no range requests, no upload. It serves files that
 * exist and refuses everything else, which is all the HUD needs — ADR-0041
 * gives it no routes.
 *
 * Reference: docs/01-bible/06-frontend-architecture.md · Chapter 26 · ADR-0052
 */

/** The only types the dashboard bundle contains. Anything else is refused. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export interface DashboardFiles {
  /**
   * Handles the request if it is for a dashboard file.
   *
   * @param request - The incoming request.
   * @param response - The response to write to.
   * @returns True when this handled it, false to let the API have it.
   */
  serve(request: IncomingMessage, response: ServerResponse): boolean
}

/**
 * Serves a built dashboard from one directory.
 *
 * @param directory - Where `apps/web`'s build output lives.
 * @returns A handler that claims only requests matching a real file.
 */
export function createDashboardFiles(directory: string): DashboardFiles {
  // ★ Resolved through symlinks once, here, so containment is compared
  // like with like. On macOS the temporary directory is itself a symlink, so
  // a root that was not resolved would fail to contain its own files.
  const root = realOrNull(resolve(directory))

  return {
    serve(request, response): boolean {
      const file = locate(root, request)
      if (file === null) return false

      response.writeHead(200, headersFor(file))

      if (request.method === 'HEAD') {
        response.end()
        return true
      }

      createReadStream(file.path).pipe(response)
      return true
    },
  }
}

/** A file this handler is willing to serve, once everything has been checked. */
interface ServableFile {
  readonly path: string
  readonly size: number
  readonly type: string
}

/**
 * Finds the file a request asks for, or decides this is not ours.
 *
 * Every refusal is a `null`, and each one matters: only reads, only inside
 * the root, only real files, and only types the bundle should contain.
 * Serving bytes without knowing what they are is how a directory becomes an
 * exfiltration path.
 */
function locate(root: string | null, request: IncomingMessage): ServableFile | null {
  if (root === null) return null

  // A method this does not recognise belongs to the API rather than being
  // refused here. A dashboard file cannot be written.
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const path = resolveWithin(root, request.url ?? '/')
  if (path === null) return null

  const size = sizeOfFile(path)
  if (size === null) return null

  const type = CONTENT_TYPES[extname(path)]
  if (type === undefined) return null

  return { path, size, type }
}

/** The headers every served file carries. */
function headersFor(file: ServableFile): Record<string, string | number> {
  return {
    'content-type': file.type,
    'content-length': file.size,

    // Vite fingerprints asset filenames, so those may be cached forever.
    // `index.html` names them and must not be, or an update would load an old
    // page pointing at assets that no longer exist.
    'cache-control': file.path.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',

    // The dashboard is never framed, and never sniffed into another type.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
}

/**
 * Turns a request path into a real file path inside the root, or nothing.
 *
 * ★ The traversal guard. The resolved path must sit under the root, checked
 * after resolution rather than by inspecting the input for `..` — a check on
 * the input is a check on one encoding of the attack.
 */
function resolveWithin(root: string, url: string): string | null {
  let pathname: string

  try {
    // The base is irrelevant and never used; it exists so a path-only URL
    // parses at all.
    pathname = decodeURIComponent(new URL(url, 'http://dashboard.invalid').pathname)
  } catch {
    return null
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  if (relative.length === 0) return null

  const candidate = realOrNull(resolve(join(root, relative)))
  if (candidate === null) return null

  return candidate.startsWith(`${root}${sep}`) ? candidate : null
}

/**
 * The path with every symlink resolved, or `null` if it does not exist.
 *
 * ★ Without this a symlink inside the bundle pointing anywhere on the disk
 * would be served: `statSync` follows links, so the file it lands on looks
 * like an ordinary file under the root. Resolving first means containment is
 * checked against where the bytes actually come from.
 */
function realOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** The file's size, or `null` when it is not a readable regular file. */
function sizeOfFile(path: string): number | null {
  try {
    const stats = statSync(path)
    return stats.isFile() ? stats.size : null
  } catch {
    return null
  }
}
