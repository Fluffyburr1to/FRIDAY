# Working in the Monorepo

How to install, build, lint, test, and add packages. Everything here runs locally with no
credentials and no network beyond the package registry.

**Why any of it is the way it is** lives elsewhere:
[Chapter 03](../../01-bible/03-repository-structure.md) for the layout,
[Chapter 30](../../01-bible/30-coding-standards.md) for the standards,
[Chapter 28](../../01-bible/28-testing-strategy.md) for testing.

---

## Prerequisites

| | | |
|---|---|---|
| **Node** | 24 LTS | Pinned in `.nvmrc`. `nvm use` picks it up. |
| **pnpm** | 11.x | `corepack enable` — the version is pinned in `package.json`. |
| **git** | any recent | |
| gitleaks | optional | The pre-commit secret scan uses it if present; CI enforces it regardless. |

Everything else is a workspace dependency.

## Install

```bash
pnpm install
```

Then, once per clone:

```bash
pnpm run setup
```

That installs the local git hooks — a pre-commit secret scan and formatter, Conventional Commits
enforcement, and a refusal to push directly to `main`. They are a **stopgap, not branch protection**;
see [the branch protection runbook](../../runbooks/branch-protection.md) for why and what replaces
them.

## The commands

| Command | Does |
|---|---|
| `pnpm check` | **Everything the pull request gate runs.** Format, lint, types, boundaries, docs, tests. |
| `pnpm fix` | Applies every formatting and lint fix Biome can make safely. |
| `pnpm build` | Builds every package, in dependency order, cached. |
| `pnpm test` | Every package's tests, plus the cross-cutting ones in `tests/`. |
| `pnpm test:unit` | Unit tests only — the fast inner loop. |
| `pnpm test:integration` | Integration tests only. |
| `pnpm test:cross` | Only the cross-cutting tiers: constitutional, contract, architecture. |
| `pnpm test:coverage` | Tests with coverage, against each package's threshold. |
| `pnpm clean` | Removes all build output and `node_modules`. |

**Run `pnpm check` before opening a pull request.** It is the same set of checks CI runs, in the same
order, so a green local run means a green pipeline — that is deliberate, and nothing in the pipeline
may depend on GitHub-specific behaviour ([Chapter 27](../../01-bible/27-cicd-pipeline.md)).

The individual checks, when you want to run one:

```bash
pnpm check:format      # Biome — formatting only
pnpm check:lint        # Biome — lint rules
pnpm check:types       # tsc --build, then the test files
pnpm check:boundaries  # dependency-cruiser — the architecture rules
pnpm check:docs        # every folder has a README; every internal link resolves
pnpm check:workflows   # CI config parses, declares permissions, pins its actions
pnpm check:secrets     # gitleaks, if installed
```

### Working on one package

Turborepo runs tasks per package, so scope the work:

```bash
pnpm --filter @friday/kernel test
pnpm --filter @friday/kernel test:watch
pnpm --filter @friday/kernel build

# a package and everything that depends on it
pnpm --filter @friday/contracts... build
```

## How the build works

`pnpm build` calls Turborepo, which calls `tsc --build` in each package in dependency order and
caches the result. A package that has not changed is restored from cache rather than rebuilt.

Each package compiles `src/` to `dist/` with declarations. **Other packages import the built output,
not the source** — which is what makes the "only `index.ts` is importable" rule true at runtime and
not merely in lint. If an import of a workspace package fails to resolve, the usual cause is that
its dependency has not been built: `pnpm build` fixes it.

Typechecking runs in two passes, both under `pnpm check:types`:

1. `tsc --build` over the root `tsconfig.json`, which references every package.
2. `tsc --project tsconfig.tests.json`, which covers every test file and config in the workspace.

Tests are outside the build graph on purpose — compiling them would put them in `dist/` — so without
the second pass they would be the one place a type error could reach `main`.

## How tests work

```
packages/<name>/test/
├── unit/           fast, no I/O            5s timeout
└── integration/    real DB, real event bus  30s timeout, one file at a time
```

They are two Vitest projects, not one glob, so the inner loop stays fast and an integration timeout
never silently applies to a unit test. Configuration comes from `@friday/vitest-config`; a package's
whole test config is three lines.

Cross-cutting tests live outside the packages, in [`tests/`](../../../tests/README.md) — they belong
to no package, so they are configured by `vitest.config.ts` at the repository root, one project per
tier: constitutional guarantees, connector contract conformance, architecture-rule enforcement, and
(Playwright, separately) end-to-end journeys.

**If you add or change a boundary rule in `.dependency-cruiser.cjs`, add a test in
`tests/architecture/`, and confirm it by hand:** add the forbidden import, run
`pnpm check:boundaries`, watch it fail, then revert. Rules 4 and 5 were silently inert from Milestone
0 to Milestone 2 because they matched module specifiers while dependency-cruiser matches resolved
paths — a rule that cannot fire is worse than no rule, because the pipeline stays green and everyone
believes the guarantee holds.

**Coverage is 80% by default and 100% on `packages/guardian` and `packages/contracts`** — not a
vanity number, but because an unexercised branch in the component deciding whether actions are
permitted is a branch nobody has verified. Coverage is measured and never optimized for; a test
written to raise a number is worse than no test.

## Adding a package

1. Create `packages/<name>/` with a `README.md` stating its charter, its boundaries, and **what does
   not belong in it**. CI fails without one.
2. Copy `package.json`, `tsconfig.json`, and `vitest.config.ts` from the nearest existing package —
   matching the surrounding code is the rule that keeps this codebase coherent across contributors
   who all start cold.
3. Name it `@friday/<folder-name>`. Departments are `@friday/dept-<name>`; connectors are
   `@friday/conn-<service>`.
4. **Add it to `references` in the root `tsconfig.json`.** A package missing from that list is a
   package that silently never gets typechecked — `pnpm check:types` fails when the two drift apart.
5. `pnpm install`, then `pnpm check`.

Shared dependency versions come from the **catalog** in `pnpm-workspace.yaml`. Write
`"vitest": "catalog:"` rather than a version range, so twenty packages cannot end up on four
versions of one library.

**Ask before adding a third-party dependency.** Every one is attack surface running with FRIDAY's
full privileges; prefer writing fifty lines. If it is genuinely needed, say so and wait — do not add
it and mention it afterward.

## Conventions worth knowing before you write anything

| | |
|---|---|
| Folders and files | `kebab-case` |
| Package names | `@friday/<folder-name>` |
| Types, classes | `PascalCase` · functions and variables `camelCase` |
| Test files | `<subject>.test.ts` |
| Events | `dot.separated.past.tense` — `plan.step.completed` |
| Environment variables | `FRIDAY_SCREAMING_SNAKE` |
| Public surface | Exactly one entry point per package: `src/index.ts` |
| Errors | `Result<T, E>` for expected failures; `throw` only for genuine bugs |
| Comments | Explain **why**, never what |

Past-tense event names are not a style preference. An event records something that already happened
and cannot be undone; naming them as facts keeps people from treating the event log as a work queue,
which is how event-sourced systems get corrupted.

Formatting is never discussed. Biome decides, the pre-commit hook applies it, and nobody — human or
AI — spends attention on it.

## Commits

```
<type>(<scope>): <subject in the imperative>

<body — WHY, not what>

Refs: ADR-NNNN
```

Types: `feat` `fix` `docs` `refactor` `test` `chore` `perf` `build` `ci` `revert`. Subject under 72
characters. Enforced by the `commit-msg` hook and again in CI, so a bad message fails the gate
rather than the reviewer.

Branch from `main` — `feat/` `fix/` `docs/` `refactor/` `chore/`, or `friday/` for FRIDAY's own
Engineering department. **Never push to `main`.**

## When something fails

| Symptom | Usually |
|---|---|
| A wall of errors inside `node_modules` | The root `tsconfig.json` lost its `"files": []`, so `tsc` compiled the whole tree with ES5-era defaults. |
| `Cannot find module '@friday/...'` | The dependency has not been built. `pnpm build`. |
| `check:types` says a package is not referenced | Add it to `references` in the root `tsconfig.json`. |
| A boundary rule fired | Fix the design, or amend the rule with an ADR. **Never add a silent exception** — the friction is the point. |
| `check:docs` reports a missing README | Every directory needs one. It is how an assistant starting cold discovers where a new file goes instead of guessing. |
| A test fails | Determine whether the code or the test is wrong, and say which. **Never weaken a test to make it pass.** |
