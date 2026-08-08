import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The dashboard's build and dev server.
 *
 * ── Why the API is proxied rather than called cross-origin ───────────────────
 *
 * In production `apps/core` serves this bundle itself, so the dashboard and
 * the API share an origin. Proxying `/trpc` in development reproduces that
 * exactly, which means no CORS configuration exists on the server — and a
 * server with no CORS surface cannot have it misconfigured later. The
 * alternative, permissive headers in development only, is a difference between
 * the two environments living in the security-relevant part of the stack.
 *
 * Reference: docs/01-bible/06-frontend-architecture.md
 */

/** Matches `server.port` in @friday/config's defaults. */
const CORE_ORIGIN = 'http://127.0.0.1:7420'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/trpc': {
        target: CORE_ORIGIN,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/trpc/, ''),
      },
    },
  },
})
