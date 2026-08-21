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

/**
 * Matches an npm package by NAME in a resolved path.
 *
 * ── Why this helper exists ──────────────────────────────────────────────────
 *
 * dependency-cruiser matches `to.path` against the RESOLVED path, not the
 * module specifier. Under pnpm, importing `better-sqlite3` resolves to:
 *
 *     node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js
 *
 * so a rule written as `path: '^better-sqlite3'` — the obvious way to write
 * it — can never match anything. Rules 4 and 5 were written that way at
 * Milestone 0 and were silently inert until Milestone 2 tested them with a
 * real dependency installed. A rule that cannot fire is worse than no rule,
 * because the pipeline reports success and everyone believes the guarantee
 * holds.
 *
 * Anchoring on the final `node_modules/<name>` segment matches every layout —
 * pnpm's virtual store, npm's flat tree, and nested installs alike.
 *
 * @param {string[]} packages Package names; scoped names are fine.
 * @returns {string} A regular expression source string.
 */
function npmPackages(packages) {
  const alternatives = packages.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return `(^|/)node_modules/(${alternatives.join('|')})(/|$)`
}

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
        path: npmPackages([
          '@anthropic-ai/sdk',
          '@anthropic-ai/bedrock-sdk',
          '@anthropic-ai/vertex-sdk',
          'openai',
          '@google/generative-ai',
          '@google/genai',
          'cohere-ai',
          '@mistralai/mistralai',
          'replicate',
          'groq-sdk',
          'ollama',
          '@aws-sdk/client-bedrock-runtime',
          'ai',
          '@ai-sdk/anthropic',
          '@ai-sdk/openai',
        ]),
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
        path: npmPackages([
          'better-sqlite3',
          'drizzle-orm',
          'drizzle-kit',
          'sqlite3',
          'libsql',
          '@libsql/client',
          'sqlite-vec',
        ]),
      },
    },
    {
      name: 'no-node-sqlite-outside-storage',
      severity: 'error',
      comment:
        'Node 24 ships SQLite in core, so the database can be opened with no dependency at ' +
        'all — which would route straight around the rule above. Core modules resolve by ' +
        'name rather than to a path, so they need their own clause.',
      from: { pathNot: '^packages/storage/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?sqlite$',
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
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '(^|/)tsconfig\\.json$',
          // A test file is an entry point — the runner loads it, nothing
          // imports it. Without this, every test written from Milestone 1
          // onwards adds a warning, and a warning list nobody can act on is a
          // warning list everybody learns to scroll past.
          '\\.test\\.ts$',
          // ★ A test fixture is loaded BY PATH at runtime — the agent runtime
          // hands one to a worker thread, which requires it inside a scope
          // that has already been stripped. Nothing imports it statically, and
          // nothing should: importing it here would pull agent code into
          // FRIDAY's own module graph, which is the thing isolation exists to
          // prevent. Same reasoning as the test-file exemption above.
          '(^|/)test/fixtures/',
          '(^|/)vitest\\.config\\.ts$',
        ],
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
      to: { dependencyTypes: ['undetermined', 'npm-no-pkg', 'npm-unknown', 'unknown'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'An import that does not resolve is either a typo or a dependency the package uses ' +
        "without declaring. The rule above was written against dependency-cruiser's named " +
        'types and missed this case, because an unresolvable module is reported as plain ' +
        '"unknown" — so it is stated here the way dependency-cruiser means it to be. ' +
        'TypeScript would also catch it; two mechanisms is correct for the rule that keeps ' +
        'the module graph honest.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '(^|/)(dist|coverage|\\.turbo)/',
        // Build and tool configuration — vitest.config.ts, and later
        // vite/playwright/tailwind. These rules enforce the architecture of
        // code that runs as part of FRIDAY; configuration that runs as part of
        // BUILDING her was never in that graph. Amended deliberately rather
        // than exempted file by file — see docs/adr/0016-build-configuration-
        // is-outside-the-boundary-graph.md
        '(^|/)[^/]*\\.config\\.(ts|mts|cts|js|mjs|cjs)$',
      ].join('|'),
    },
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
