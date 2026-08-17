#!/usr/bin/env node

/**
 * Starts FRIDAY's face.
 *
 *     pnpm hud
 *
 * Two processes: `apps/core` serves the API, Vite serves the HUD and proxies
 * `/trpc` to it so the two share an origin.
 *
 * It waits for core to be listening before starting anything else, because the
 * failure the owner will actually hit is an unprovisioned machine — and two
 * processes started in parallel would interleave their output and leave a
 * browser open on a HUD saying LINK OFFLINE with the real reason scrolled away.
 *
 * Reference: docs/guides/how-to/hud.md
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const children = []

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}

/** Prints a problem with its next step, then leaves with the CLI's exit code. */
function fail(problem, remedy) {
  process.stderr.write(`\n  ${problem}\n\n  ${remedy}\n\n`)
  stopAll()
  process.exit(1)
}

/**
 * Turns core's own message into one with a next step in it.
 *
 * Missing rules and a missing key are the same problem wearing two faces:
 * FRIDAY has never been set up here. `init` is creation-only (ADR-0035), so it
 * is safe to recommend even when only one of the two is actually missing.
 */
function remedyFor(output) {
  if (/EADDRINUSE|address already in use/.test(output)) {
    return 'Something already holds port 7420 — probably a core she is already running. Check:   lsof -i :7420'
  }

  if (/No key named|[Kk]eychain|polic(y|ies)/i.test(output)) {
    return 'FRIDAY has not been set up on this Mac yet. Run this once:   pnpm friday init'
  }

  return 'Its own explanation is above.'
}

function run(command, args, what) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' })
    child.on('error', () => fail(`Could not run ${command}.`, `Needed for: ${what}`))
    child.on('exit', (code) =>
      code === 0 ? resolve() : fail(`${what} failed.`, 'The output above says why.'),
    )
  })
}

/** Starts a child, resolving when its output matches `ready`. */
function start(command, args, cwd, ready, whenGone) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd })
    children.push(child)

    let output = ''
    let settled = false

    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        const text = String(chunk)
        output += text
        process.stdout.write(`  ${text}`)

        const found = ready.exec(text)
        if (!settled && found !== null) {
          settled = true
          resolve(found[1] ?? '')
        }
      })
    }

    child.on('exit', (code) => {
      if (settled) return
      settled = true
      fail(whenGone(output, code), remedyFor(output))
    })
  })
}

process.on('SIGINT', () => {
  process.stdout.write('\n  Stopping FRIDAY.\n')
  stopAll()
  process.exit(0)
})

process.on('SIGTERM', stopAll)

if (!existsSync(join(ROOT, 'node_modules'))) {
  fail('Dependencies are not installed.', 'Run:   pnpm install')
}

process.stdout.write('\n  Building…\n')
await run(join(ROOT, 'node_modules', '.bin', 'turbo'), ['run', 'build'], 'The workspace build')

process.stdout.write('\n  Starting friday-core…\n')
await start(
  process.execPath,
  [join(ROOT, 'apps', 'core', 'dist', 'index.js')],
  ROOT,
  /listening on/,
  (_output, code) => `friday-core exited with code ${code} instead of starting.`,
)

process.stdout.write('\n  Starting the HUD…\n')
const url = await start(
  join(ROOT, 'node_modules', '.bin', 'vite'),
  [],
  join(ROOT, 'apps', 'web'),
  /(http:\/\/localhost:\d+)/,
  (_output, code) => `The HUD's dev server exited with code ${code}.`,
)

process.stdout.write(`\n  FRIDAY's face is at ${url}\n  Ctrl-C to stop.\n\n`)

// Best effort: the URL is printed either way, and a machine without `open` is
// not a reason to refuse to run.
spawn('open', [url], { stdio: 'ignore' }).on('error', () => undefined)
