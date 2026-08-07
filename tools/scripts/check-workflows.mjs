#!/usr/bin/env node
/**
 * Validate the CI configuration.
 *
 * The pipeline is not developer convenience — it is the verification layer of
 * the approval system, applied to code. A workflow with a YAML error does not
 * fail loudly; GitHub simply does not run it, and the pull request shows a
 * green tick because nothing objected. That is the worst possible failure mode
 * for a gate, and it is why this check exists.
 *
 * Three rules, all mechanical:
 *
 *   1. Every YAML file under .github/ parses.
 *   2. Every workflow declares top-level `permissions`. GitHub's default token
 *      is broadly privileged; least privilege has to be written down
 *      (docs/01-bible/18-security-model.md).
 *   3. Every `uses:` is pinned to a major version or a commit SHA. An
 *      unpinned action is arbitrary third-party code running with repository
 *      credentials, re-fetched on every run.
 *
 * Reference: docs/01-bible/27-cicd-pipeline.md
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GITHUB_DIR = join(ROOT, '.github')
const WORKFLOWS_DIR = join(GITHUB_DIR, 'workflows')

/** Actions published by GitHub itself still get pinned; no exceptions. */
const PINNED = /@(v\d+(\.\d+)*|[0-9a-f]{40})$/

const problems = []

function yamlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yamlFiles(full, out)
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function collectUses(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectUses(item, found)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses' && typeof value === 'string') found.push(value)
      else collectUses(value, found)
    }
  }
  return found
}

if (!existsSync(GITHUB_DIR)) {
  console.log('workflows — no .github directory, nothing to check.')
  process.exit(0)
}

const files = yamlFiles(GITHUB_DIR)

for (const file of files) {
  const where = relative(ROOT, file)
  let parsed

  // ── Rule 1: it parses ──────────────────────────────────────────────────
  try {
    parsed = loadYaml(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push({ where, detail: `does not parse — ${error.message.split('\n')[0]}` })
    continue
  }

  if (!parsed || typeof parsed !== 'object') {
    problems.push({ where, detail: 'is empty or is not a mapping' })
    continue
  }

  const isWorkflow = file.startsWith(WORKFLOWS_DIR)

  if (isWorkflow) {
    // Under YAML 1.1 the key `on` parses as the boolean true. js-yaml's
    // default schema is 1.2 core, where it stays a string — but other YAML
    // readers, GitHub's included, have historically differed, so accept both
    // rather than depend on which one is doing the parsing.
    const hasTrigger = 'on' in parsed || 'true' in parsed
    if (!hasTrigger) problems.push({ where, detail: 'has no `on:` trigger' })
    if (!parsed.name) problems.push({ where, detail: 'has no `name:`' })

    // ── Rule 2: least privilege is written down ─────────────────────────
    if (!('permissions' in parsed)) {
      problems.push({
        where,
        detail:
          "declares no top-level `permissions:`. GitHub's default token is broadly " +
          'privileged; least privilege has to be stated.',
      })
    }
  }

  // ── Rule 3: every action is pinned ───────────────────────────────────────
  for (const uses of collectUses(parsed)) {
    if (uses.startsWith('./')) continue // a local composite action
    if (!PINNED.test(uses)) {
      problems.push({
        where,
        detail: `uses \`${uses}\`, which is not pinned to a major version or a SHA`,
      })
    }
  }
}

if (problems.length === 0) {
  console.log(`workflows ok — ${files.length} file(s) parse, permissions declared, actions pinned`)
  process.exit(0)
}

console.error(`\nworkflow check failed — ${problems.length} problem(s)\n`)
for (const p of problems) console.error(`    ${p.where}  ${p.detail}`)
console.error('\nSee docs/01-bible/27-cicd-pipeline.md\n')
process.exit(1)
