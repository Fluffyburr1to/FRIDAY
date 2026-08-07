import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Asserts that the architectural boundary rules can actually fire.
 *
 * See README.md in this folder for why — briefly: two of these rules were
 * inert from Milestone 0 to Milestone 2 because they matched module
 * specifiers, while dependency-cruiser matches resolved paths.
 */

const require = createRequire(import.meta.url)
const config = require('../../.dependency-cruiser.cjs') as {
  forbidden: Array<{
    name: string
    severity: string
    comment?: string
    from: Record<string, unknown>
    to: Record<string, unknown>
  }>
}

function rule(name: string) {
  const found = config.forbidden.find((r) => r.name === name)
  if (!found) throw new Error(`No forbidden rule named "${name}"`)
  return found
}

/** The two module layouts a resolved path can take in this repository. */
function resolvedPaths(pkg: string, version = '1.0.0', entry = 'dist/index.js'): string[] {
  return [
    // pnpm's virtual store — what this repository actually produces
    `node_modules/.pnpm/${pkg.replace('/', '+')}@${version}/node_modules/${pkg}/${entry}`,
    // a flat tree, in case the package manager ever changes
    `node_modules/${pkg}/${entry}`,
  ]
}

function matcher(r: ReturnType<typeof rule>): RegExp {
  const path = r.to.path
  if (typeof path !== 'string') throw new Error(`Rule "${r.name}" has no string to.path`)
  return new RegExp(path)
}

describe('no-database-access-outside-storage', () => {
  const pattern = matcher(rule('no-database-access-outside-storage'))

  it.each(['better-sqlite3', 'drizzle-orm', 'sqlite3', 'libsql', 'sqlite-vec'])(
    'catches %s wherever the package manager puts it',
    (pkg) => {
      for (const resolved of resolvedPaths(pkg)) {
        expect(resolved, `${pkg} must be caught at ${resolved}`).toMatch(pattern)
      }
    },
  )

  it('catches the scoped libsql client', () => {
    for (const resolved of resolvedPaths('@libsql/client')) {
      expect(resolved).toMatch(pattern)
    }
  })

  it('is anchored on a package boundary, not a prefix', () => {
    // Without the trailing (/|$) anchor, a package merely NAMED like a
    // forbidden one would be blocked — and someone would eventually loosen
    // the whole rule to unblock it.
    expect('node_modules/drizzle-orm-helpers/dist/index.js').not.toMatch(pattern)
    expect('node_modules/better-sqlite3-session-store/index.js').not.toMatch(pattern)
  })

  it('does not match ordinary source or unrelated packages', () => {
    expect('packages/kernel/src/index.ts').not.toMatch(pattern)
    expect('node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js').not.toMatch(pattern)
  })
})

describe('no-node-sqlite-outside-storage', () => {
  const r = rule('no-node-sqlite-outside-storage')
  const pattern = matcher(r)

  it("catches Node's built-in SQLite, which needs no dependency at all", () => {
    // Node 24 ships SQLite in core. Without this clause the rule above could
    // be routed around by importing 'node:sqlite' and adding nothing to
    // package.json — a bypass that leaves no trace in a dependency diff.
    expect('node:sqlite').toMatch(pattern)
    expect('sqlite').toMatch(pattern)
  })

  it('scopes itself to core modules', () => {
    expect(r.to.dependencyTypes).toEqual(['core'])
  })

  it('does not match other core modules', () => {
    for (const core of ['node:fs', 'node:crypto', 'node:sqlite3']) {
      expect(core).not.toMatch(pattern)
    }
  })
})

describe('no-ai-vendor-sdk-outside-model-router', () => {
  const pattern = matcher(rule('no-ai-vendor-sdk-outside-model-router'))

  it.each([
    '@anthropic-ai/sdk',
    'openai',
    '@google/genai',
    'cohere-ai',
    'groq-sdk',
    'ollama',
    '@ai-sdk/anthropic',
  ])('catches %s — Principle 5 has exactly one chokepoint', (pkg) => {
    for (const resolved of resolvedPaths(pkg)) {
      expect(resolved, `${pkg} must be caught at ${resolved}`).toMatch(pattern)
    }
  })

  it('does not match packages that merely mention a vendor', () => {
    expect('node_modules/openai-tokenizer/index.js').not.toMatch(pattern)
    expect('packages/model-router/src/providers/openai.ts').not.toMatch(pattern)
  })
})

describe('the rule set as a whole', () => {
  it('explains every rule it enforces', () => {
    // A violation message without a reason gets worked around rather than
    // understood — and the reason is usually a founding provision.
    const silent = config.forbidden.filter((r) => !r.comment?.trim())
    expect(silent.map((r) => r.name)).toEqual([])
  })

  it('gives every rule a name', () => {
    const unnamed = config.forbidden.filter((r) => !r.name)
    expect(unnamed).toEqual([])
  })

  it('keeps the load-bearing rules at error severity', () => {
    // Downgrading one of these to "warn" would keep the pipeline green while
    // removing the guarantee — the same silent failure this folder exists for.
    const mustBlock = [
      'no-database-access-outside-storage',
      'no-node-sqlite-outside-storage',
      'no-ai-vendor-sdk-outside-model-router',
      'departments-may-not-import-departments',
      'connectors-import-only-sdk-and-contracts',
      'contracts-imports-nothing-internal',
      'guardian-internals-are-private',
      'only-index-is-importable',
      'not-to-unresolvable',
    ]

    for (const name of mustBlock) {
      expect(rule(name).severity, `${name} must block, not warn`).toBe('error')
    }
  })

  it('excludes build configuration from the graph, per ADR-0016', () => {
    const excluded = (config as unknown as { options: { exclude: { path: string } } }).options
      .exclude.path
    const pattern = new RegExp(excluded)

    expect('packages/kernel/vitest.config.ts').toMatch(pattern)
    expect('packages/kernel/src/index.ts').not.toMatch(pattern)
  })
})
