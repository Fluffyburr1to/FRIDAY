# RFC 0001 — A `tools/vitest-config` package

- **Status:** ✅ **closed — accepted 2026-08-07.** Option 1. Chapter 03's `tools/` listing is
  amended to include `vitest-config/` and to state that `tools/<tool>-config` is a pattern rather
  than a closed list. Recorded in
  [ADR-0017](../adr/0017-shared-tool-configuration-packages.md), which is the permanent record —
  this document is kept only for the reasoning that led there.
- **Date:** 2026-08-07
- **Author:** Milestone 2 implementation
- **Affects:** [Chapter 03 — Repository Structure](../01-bible/03-repository-structure.md),
  [Chapter 28 — Testing Strategy](../01-bible/28-testing-strategy.md)

---

## The problem

Chapter 03 fixes the contents of `tools/`:

```
tools/
├── tsconfig/       Shared TypeScript configurations
├── lint-config/    Shared Biome configuration
├── scripts/        Setup, migration, release, maintenance scripts
└── evals/          Agent evaluation harness
```

Milestone 2 set up Vitest, and Vitest needs configuration that every package shares — the two test
tiers, their timeouts, mock-reset behaviour, coverage provider and thresholds. Chapter 03 names a
home for shared TypeScript configuration and a home for shared lint configuration. It names no home
for shared test configuration, because it was written before the test harness existed.

This matters more than it sounds. There will be twenty-odd packages. If each writes its own Vitest
config, they drift — and the drift is invisible, because a package whose coverage threshold quietly
sits at 50% still shows a green tick. Chapter 30 is explicit about why this class of inconsistency
is worse here than elsewhere: *"If there are three different ways to handle errors in the codebase,
the assistant picks one arbitrarily, and within a year there are seven."* Test configuration behaves
exactly the same way.

## What was done, provisionally

`tools/vitest-config/` — package `@friday/vitest-config`, exporting one function. A package's entire
test configuration is then:

```ts
import { defineConfig } from 'vitest/config'
import { fridayTest } from '@friday/vitest-config'

export default defineConfig(fridayTest({ name: 'contracts' }))
```

It follows the pattern Chapter 03 already established — `tools/<tool>-config` for shared tool
configuration — rather than inventing a new one. It is plain JavaScript with a hand-written
`index.d.ts`, so nothing needs compiling before anything can be tested.

**It is implemented rather than merely proposed** because Milestone 2's objective was a working test
harness and a proposal does not run tests. If this RFC is declined, the preset moves and the
three-line configs change with it; nothing else does.

## Why not the obvious alternatives

**Put it in `tools/tsconfig` or `tools/lint-config`.** Wrong charter, and both READMEs say so. A
future reader looking for test configuration would not find it, which is the exact failure Chapter 03
exists to prevent.

**One root `vitest.config.ts` using Vitest's `projects` feature.** No new directory, and genuinely
simpler. Rejected because Chapter 27 requires "unit tests, affected packages only" in the pull
request pipeline, and Turborepo can only run and cache a per-package `test` task if each package
owns its configuration. This trades the incremental test loop — which Chapter 02 calls the primary
determinant of whether an evenings-and-weekends project makes progress — for one fewer folder.

**Duplicate the config in each package.** The drift problem above. It is also precisely the thing
`departments/_template/` and `connectors/_template/` exist to prevent elsewhere.

## What I do not know

- Whether the owner reads Chapter 03's `tools/` listing as **exhaustive** (this needs the chapter
  amended) or as **illustrative of a pattern** (this needs nothing).
- Whether shared configuration for Playwright, Vite, and Tailwind should each get their own
  `tools/*-config` package at Milestones 4 and 7, or whether one `tools/build-config` should hold
  all of them. Deciding now would be deciding without the information that only building them
  provides — but the answer affects whether this folder's name is right.

## What I am asking for

One of:

1. **Accept** — amend Chapter 03's `tools/` listing to include `vitest-config`, and note that
   `tools/<tool>-config` is a pattern rather than a closed list. Write the ADR, close this RFC.
2. **Accept with a different shape** — e.g. a single `tools/build-config` package that will also
   hold Playwright and Vite configuration later. Cheap to change now; expensive at Milestone 4.
3. **Decline** — the root-config approach is taken instead, and the cost is per-package test
   caching.

Reference: [Chapter 37 — ADR Process](../01-bible/37-adr-process.md)
