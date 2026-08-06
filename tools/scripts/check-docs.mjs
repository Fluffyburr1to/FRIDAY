#!/usr/bin/env node
/**
 * Documentation integrity checks. Runs in `pnpm check` and in CI.
 *
 * Enforces two rules from docs/01-bible/38-documentation-standards.md:
 *
 *   1. Every directory has a README.md.
 *      This is the highest-return rule in the project. When an AI assistant is
 *      asked to add a capability, its first question is "where does this file
 *      go?" If every folder states its charter and its boundaries, the answer
 *      is discoverable. If not, the assistant guesses — plausibly, differently
 *      each time — and after twenty guesses the structure is incoherent.
 *
 *   2. Every internal markdown link resolves.
 *      Renamed and deleted files silently break the cross-references that make
 *      the Bible navigable.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.changeset',
  'src',
  'test',
  'scenarios',
  'suites',
])

/** Directories exempt from the README rule, with the reason. */
const README_EXEMPT = new Set([
  '.github/ISSUE_TEMPLATE', // has one, but keep the exemption documented
])

const problems = []

// ── Rule 1: every directory has a README ──────────────────────────────────

function walkDirs(dir) {
  const rel = relative(ROOT, dir)
  const entries = readdirSync(dir, { withFileTypes: true })

  if (rel && !README_EXEMPT.has(rel)) {
    const hasReadme = entries.some((e) => e.isFile() && e.name === 'README.md')
    if (!hasReadme) {
      problems.push({
        rule: 'missing-readme',
        where: rel,
        detail:
          'Every directory needs a README.md stating its charter, its boundaries, ' +
          'and what does NOT belong in it.',
      })
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name)) continue
    walkDirs(join(dir, entry.name))
  }
}

// ── Rule 2: every internal link resolves ──────────────────────────────────

function collectMarkdown(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectMarkdown(join(dir, entry.name), out)
    } else if (entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const LINK = /\[[^\]]*\]\(([^)]+)\)/g

function checkLinks(file) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(LINK)) {
    const target = match[1].trim()
    if (/^(https?:|mailto:|#)/.test(target)) continue

    const path = target.split('#')[0]
    if (!path) continue

    const resolved = resolve(dirname(file), path)
    try {
      statSync(resolved)
    } catch {
      problems.push({
        rule: 'broken-link',
        where: relative(ROOT, file),
        detail: `-> ${target}`,
      })
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

walkDirs(ROOT)
const files = collectMarkdown(ROOT)
for (const file of files) checkLinks(file)

const dirCount = (function count(dir) {
  let n = 1
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) n += count(join(dir, e.name))
  }
  return n
})(ROOT)

if (problems.length === 0) {
  console.log(`docs ok — ${dirCount} directories, ${files.length} markdown files, links resolve`)
  process.exit(0)
}

const byRule = new Map()
for (const p of problems) {
  if (!byRule.has(p.rule)) byRule.set(p.rule, [])
  byRule.get(p.rule).push(p)
}

console.error(`\ndocs check failed — ${problems.length} problem(s)\n`)
for (const [rule, items] of byRule) {
  console.error(`  ${rule} (${items.length})`)
  for (const item of items) {
    console.error(`    ${item.where}  ${item.detail}`)
  }
  console.error('')
}
console.error('See docs/01-bible/38-documentation-standards.md\n')
process.exit(1)
