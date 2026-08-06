/**
 * Architectural boundary enforcement.
 *
 * These rules are the architecture, made mechanical. A monorepo where a
 * boundary violation fails the build is more genuinely modular than nine
 * repositories held together by good intentions — because the rule is
 * checked on every commit rather than remembered on good days.
 *
 * When one of these fires, the correct response is to fix the design or
 * amend the rule with an ADR. Never to add a silent exception.
 *
 * Reference: docs/01-bible/03-repository-structure.md
 *            docs/01-bible/04-monorepo-vs-multirepo.md
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ───────────────────────────────────────────────────────────────────
    // Rule 1 — Dependencies flow one direction
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'packages-may-not-import-apps',
      severity: 'error',
      comment:
        'A package that knows about a specific app has stopped being shared code. ' +
        'Packages are the foundation; apps compose them.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-may-not-import-departments',
      severity: 'error',
      comment:
        'The kernel must remain independent of everything built on top of it. ' +
        'Article VI — subsystems must be replaceable.',
      from: { path: '^packages/' },
      to: { path: '^departments/' },
    },
    {
      name: 'packages-may-not-import-connectors',
      severity: 'error',
      comment: 'Same reason. Connectors are consumed via the SDK interface, never directly.',
      from: { path: '^packages/' },
      to: { path: '^connectors/' },
    },
    {
      name: 'contracts-imports-nothing-internal',
      severity: 'error',
      comment:
        'packages/contracts is the root of the dependency graph. If it ever imports ' +
        'from FRIDAY, the architecture has inverted.',
      from: { path: '^packages/contracts/' },
      to: { path: '^(apps|packages|departments|connectors)/', pathNot: '^packages/contracts/' },
    },

    // ───────────────────────────────────────────────────────────────────
    // Rule 2 — Departments never call each other
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'departments-may-not-import-departments',
      severity: 'error',
      comment:
        'THE KEYSTONE RULE. Departments communicate only through the event bus. This is ' +
        'what makes a department removable, replaceable, and addable without touching ' +
        'anything else — Article VI implemented as a communication rule. ' +
        'Need a result from another department? Publish capability.requested and subscribe ' +
        'for the response. See docs/01-bible/13-department-architecture.md',
      from: { path: '^departments/([^/]+)/' },
      to: {
        path: '^departments/([^/]+)/',
        pathNot: '^departments/$1/',
      },
    },
    {
      name: 'departments-may-not-import-apps',
      severity: 'error',
      comment: 'Departments are consumed by apps, never the reverse.',
      from: { path: '^departments/' },
      to: { path: '^apps/' },
    },

    // ───────────────────────────────────────────────────────────────────
    // Rule 3 — Only the Guardian authorizes
    // ───────────────────────────────────────────────────────────────────
    // Enforced primarily by the constitutional test suite, since "implements
    // authorization" is semantic rather than structural. This rule catches the
    // structural half: nobody reaches into the Guardian's internals to
    // reimplement or bypass its decisions.
    {
      name: 'guardian-internals-are-private',
      severity: 'error',
      comment:
        'Only packages/guardian/src/index.ts is importable. Reaching into its internals ' +
        'is how a second, disagreeing authorization path gets built.',
      from: { pathNot: '^packages/guardian/' },
      to: {
        path: '^packages/guardian/src/',
        pathNot: '^packages/guardian/src/index\\.ts$',
      },
    },

    // ───────────────────────────────────────────────────────────────────
    // Rule 4 — Only the Model Router may name an AI vendor
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'no-ai-vendor-sdk-outside-model-router',
      severity: 'error',
      comment:
        'Principle 5: "FRIDAY should never depend on one vendor, one technology, or one ' +
        'AI provider." The Model Router is the single chokepoint where a vendor name may ' +
        'appear. This rule is what stops that principle being an aspiration.',
      from: { pathNot: '^packages/model-router/' },
      to: {
        dependencyTypes: ['npm'],
        path: '^(@anthropic-ai/|openai|@google/generative-ai|@google/genai|cohere-ai|@mistralai/|replicate|groq-sdk|ollama)',
      },
    },

    // ───────────────────────────────────────────────────────────────────
    // Rule 5 — Only storage opens the database
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'no-database-access-outside-storage',
      severity: 'error',
      comment:
        'All persistence goes through packages/storage repositories. One place enforces ' +
        'encryption, one place enforces principal_id isolation, one place changes when ' +
        'SQLite is eventually replaced.',
      from: { pathNot: '^packages/storage/' },
      to: {
        dependencyTypes: ['npm'],
        path: '^(better-sqlite3|node:sqlite|drizzle-orm|libsql|@libsql/)',
      },
    },
    {
      name: 'storage-internals-are-private',
      severity: 'error',
      comment: 'Repositories are the API. Raw query builders are not.',
      from: { pathNot: '^packages/storage/' },
      to: {
        path: '^packages/storage/src/',
        pathNot: '^packages/storage/src/index\\.ts$',
      },
    },

    // ───────────────────────────────────────────────────────────────────
    // Connectors — the most restrictive rule in the repository
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'connectors-import-only-sdk-and-contracts',
      severity: 'error',
      comment:
        'Connectors are the component most likely to be written quickly, by an AI, or by ' +
        'a third party — and they are the only ones with network access. They may import ' +
        '@friday/connector-sdk and @friday/contracts. Nothing else.',
      from: { path: '^connectors/' },
      to: {
        path: '^(apps|packages|departments|connectors)/',
        pathNot: '^packages/(connector-sdk|contracts)/',
      },
    },

    // ───────────────────────────────────────────────────────────────────
    // Package encapsulation — what makes packages replaceable
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'only-index-is-importable',
      severity: 'error',
      comment:
        'Every package exposes exactly one entry point: src/index.ts. This is what makes ' +
        'a package genuinely replaceable — consumers depend on a small declared surface, ' +
        'not on internal structure that shifts.',
      from: { path: '^(apps|packages|departments|connectors)/([^/]+)/' },
      to: {
        path: '^packages/([^/]+)/src/(?!index\\.ts$)',
        pathNot: '^packages/$2/src/',
      },
    },

    // ───────────────────────────────────────────────────────────────────
    // General hygiene
    // ───────────────────────────────────────────────────────────────────
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or extract.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphan-modules',
      severity: 'warn',
      comment: 'A module nothing imports is usually dead code.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', '(^|/)tsconfig\\.json$'],
      },
      to: {},
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'A devDependency imported by shipping code will be missing in production.',
      from: { path: '^(apps|packages|departments|connectors)/', pathNot: '\\.(test|spec)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core modules will eventually be removed.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|constants)$' },
    },
    {
      name: 'no-non-package-json-deps',
      severity: 'error',
      comment:
        'pnpm strictness: if a package uses a library, it must declare it. This is the ' +
        'phantom-dependency problem that npm hides and that breaks mysteriously later.',
      from: {},
      to: { dependencyTypes: ['undetermined', 'npm-no-pkg', 'npm-unknown'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.turbo)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
