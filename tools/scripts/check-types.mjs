#!/usr/bin/env node
/**
 * Typecheck the whole workspace.
 *
 * Like check-boundaries.mjs, this exists so that "there are no packages yet"
 * is reported honestly instead of being hidden behind a `|| echo` that would
 * also hide a genuine type error.
 *
 * Maximum-strictness TypeScript is what catches an AI assistant's mistakes
 * before the owner — who does not read code — ever sees them. That makes this
 * check one of the load-bearing ones.
 *
 * See docs/01-bible/30-coding-standards.md
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCOPES = ['apps', 'packages', 'departments', 'connectors', 'tools']

/** Workspace directories that have their own tsconfig.json. */
function findProjects() {
  const found = []
  for (const scope of SCOPES) {
    const scopeDir = join(ROOT, scope)
    if (!existsSync(scopeDir)) continue
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(scopeDir, entry.name, 'tsconfig.json'))) {
        found.push(`${scope}/${entry.name}`)
      }
    }
  }
  return found
}

const projects = findProjects()

if (projects.length === 0) {
  console.log(
    'types — no packages with a tsconfig.json yet, nothing to check.\n' +
      '  Strict settings are configured in tsconfig.base.json and apply from\n' +
      '  the first package added at Milestone 1.',
  )
  process.exit(0)
}

// Warn if the solution file has drifted from what actually exists on disk —
// a package missing from "references" is a package that silently never gets
// typechecked, which is exactly the kind of quiet gap this project cannot
// afford.
// Parsed with TypeScript's own reader rather than JSON.parse, because every
// config file in this repository carries its reasoning in comments and JSONC
// is not JSON.
const solutionPath = join(ROOT, 'tsconfig.json')
const solution = ts.parseConfigFileTextToJson(
  solutionPath,
  readFileSync(solutionPath, 'utf8'),
).config

if (!solution) {
  console.error(`types — could not parse ${solutionPath}`)
  process.exit(1)
}

const referenced = new Set(
  (solution.references ?? []).map((r) => r.path.replace(/^\.\//, '').replace(/\/$/, '')),
)
const missing = projects.filter((p) => !referenced.has(p))

if (missing.length > 0) {
  console.error(
    'types — these packages exist but are not referenced in tsconfig.json,\n' +
      'so they would never be typechecked:\n' +
      missing.map((p) => `    ${p}`).join('\n') +
      '\n\nAdd them to "references" in the root tsconfig.json.\n',
  )
  process.exit(1)
}

function run(label, args) {
  const result = spawnSync('tsc', args, { cwd: ROOT, stdio: 'inherit', shell: false })
  if (result.error) {
    console.error(`types — tsc failed to run (${label}):`, result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Pass 1 — every package's src/, in dependency order, emitting declarations.
run('sources', ['--build'])

// Pass 2 — every test file in the workspace, under the same strict settings.
// Tests are deliberately outside the build graph (see tsconfig.tests.json), so
// without this they would be the one place in the repository where a type
// error could reach main.
run('tests', ['--noEmit', '--project', 'tsconfig.tests.json'])

// Pass 3 — browser test files, which need the DOM lib that pass 2 withholds.
// Separate so that granting the DOM to apps/web's tests does not grant it to
// every test in the repository. See tsconfig.tests.browser.json.
run('browser tests', ['--noEmit', '--project', 'tsconfig.tests.browser.json'])

console.log(`types ok — ${projects.length} package(s), plus test files`)
