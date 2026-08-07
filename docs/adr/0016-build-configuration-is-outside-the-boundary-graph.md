# ADR-0016 — Build configuration files are outside the architectural boundary graph

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 03 — Repository Structure](../01-bible/03-repository-structure.md),
  [Chapter 28 — Testing Strategy](../01-bible/28-testing-strategy.md),
  [ADR-0002 — Monorepo](0002-monorepo.md), `.dependency-cruiser.cjs`

---

## Context

The boundary rules in `.dependency-cruiser.cjs` were written at Milestone 0, before any package
existed. They describe how **shipping code** may depend on other shipping code: packages may not
import apps, connectors may import only the SDK and contracts, nothing outside `storage` opens the
database, and so on. Two of them are hygiene rules rather than architecture rules:

- `no-dev-deps-in-src` — "a devDependency imported by shipping code will be missing in production"
- `no-non-package-json-deps` — "if a package uses a library, it must declare it"

Both scope themselves to `^(apps|packages|departments|connectors)/` and exempt exactly one thing:
files matching `\.(test|spec)\.ts$`.

Milestone 2 added the first per-package build configuration — `packages/<name>/vitest.config.ts`,
three lines that import `defineConfig` from `vitest` and the shared preset from
`@friday/vitest-config`. Every one of them fails both rules, eight errors in total. The exemption
list anticipated test *files* and not the *configuration that runs them*, because at the time the
rules were written there were neither.

Nothing is actually wrong. `vitest` and `@friday/vitest-config` are correctly declared as
devDependencies of each package. The rules are firing because a config file looks structurally
identical to source code and is not source code.

What was not known when the rules were written: how many non-source TypeScript files would end up
inside package directories. The answer, over the life of this project, is several per package —
`vitest.config.ts` now, and `vite.config.ts`, `playwright.config.ts`, `tailwind.config.ts`, and
`tauri.conf` variants as the applications arrive.

## Decision

We will **exclude build and tool configuration files from the dependency-cruiser graph entirely**,
by adding `(^|/)[^/]*\.config\.(ts|mts|cts|js|mjs|cjs)$` to `options.exclude` in
`.dependency-cruiser.cjs`.

dependency-cruiser enforces the architecture of code that runs as part of FRIDAY. Configuration that
runs as part of *building* FRIDAY is not in that architecture and never was.

## Constitutional review

- **Article VI (Modularity):** unaffected. Every rule that expresses a module boundary — the
  connector restriction, the Guardian and storage encapsulation rules, the vendor-SDK chokepoint,
  the departments-never-import-departments keystone — applies to `src/` and is untouched.
- **Principle 6 (Architecture Is Sacred):** honored by amending the rule deliberately, in writing,
  rather than adding a per-file exception or an inline ignore comment. The rule file itself says the
  correct response is "to fix the design, or to amend the rule with an ADR — never to add a silent
  exception." This is that ADR.

**The five questions:**

- [x] **Can the user see it?** — The exclusion is one commented line in `.dependency-cruiser.cjs`,
      and this record.
- [x] **Can the user stop it?** — Normal pull request flow; `.dependency-cruiser.cjs` is an
      owner-reviewed path.
- [x] **Can we replace it?** — The exclusion is a regular expression in one file.
- [x] **Can we explain it?** — Yes; that is what this document is for.
- [x] **Will this still be right in five years?** — Yes. The category "configuration that builds the
      system" is stable, and it grows rather than shrinks.

**Notes:** the tension worth naming is that this makes the boundary checker blind to a real, if
unlikely, thing: a `vite.config.ts` that imports an AI vendor SDK would no longer be caught by Rule
4. That is accepted below.

## Alternatives considered

### Add `vitest.config.ts` to the existing `pathNot` exemptions

**What it is.** Extend the two rules' `pathNot` from `\.(test|spec)\.ts$` to also match
`vitest\.config\.ts$`.

**Advantages.** The smallest possible change. Keeps config files in the graph, so `only-index-is-
importable` and the vendor-SDK rule still apply to them.

**Why rejected.** It solves this week and not the problem. The next config file — `vite.config.ts`
at Milestone 4, `playwright.config.ts` alongside it — fails again, and the exemption list grows one
regex at a time with no stated principle behind it. A list nobody can state the rule for is a list
that eventually gets something wrong. Naming the whole category once is the more honest fix.

### Move every config file out of the package directory

**What it is.** Keep `packages/<name>/` free of anything but `src/` and `test/`, and drive Vitest
from a single root configuration using its `projects` feature.

**Advantages.** No exclusion needed at all. One place to look for test configuration.

**Why rejected.** It breaks the property Chapter 27 depends on — "unit tests, affected packages
only." Turborepo can only run and cache a `test` task per package if each package owns its test
configuration. Trading the incremental test loop for a lint-rule tidiness is the wrong trade for a
project where feedback-loop length is the main determinant of progress (Chapter 02).

### Declare `vitest` as a real dependency rather than a devDependency

**What it is.** Move `vitest` from `devDependencies` to `dependencies` in each package, satisfying
`no-dev-deps-in-src` on its own terms.

**Advantages.** No configuration change anywhere.

**Why rejected.** It is a lie told to a linter. Vitest genuinely is a development dependency, and
declaring otherwise would ship the test runner in any future production install and would make the
rule useless for catching the case it exists to catch.

## Consequences

**Positive**

- The eight errors are resolved by a stated principle rather than by an exemption list.
- Configuration files that arrive later — Vite, Playwright, Tailwind, Tauri — need no further
  amendment.
- The rule file now says what it enforces: the architecture of shipping code.

**Negative**

- **dependency-cruiser no longer sees imports in config files at all.** If a `vite.config.ts` were
  to import `@anthropic-ai/sdk`, Rule 4's vendor chokepoint would not catch it. This is accepted:
  build configuration does not execute inside FRIDAY, so a vendor SDK there is not vendor lock-in in
  the sense Principle 5 is about — and Biome plus code review still read the file.
- The exclusion is broad by filename convention. A source file someone names `retry.config.ts` would
  silently leave the graph. Mitigation: the convention throughout this repository is that
  `*.config.*` at a package root is tooling, and configuration *values* live in `packages/config`.

**Neutral**

- Config files remain fully linted by Biome, formatted, and typechecked by `tsconfig.tests.json`.
  Only the boundary graph excludes them.

## Reversibility

- **Cost to reverse:** low
- **How:** delete the one line from `options.exclude` in `.dependency-cruiser.cjs` and add whatever
  narrower exemptions are wanted to the individual rules.
- **Point of no return:** none.

## Review triggers

- A source file — not tooling — is legitimately named `*.config.ts` inside `src/`. The convention has
  then collided with real code and the exclusion needs narrowing to package-root config files only.
- dependency-cruiser gains a first-class notion of "tooling file," making the manual exclusion
  unnecessary.
- A config file is found importing something it should not, and review did not catch it. That is
  evidence the negative consequence above is real rather than theoretical.

## Notes

Found by implementation at Milestone 2, not by design review — which is the ordinary way a rule
written before any code exists meets the first code. The rule was not wrong; it was written against
a repository that had no configuration files in it yet.

The four `no-orphan-modules` **warnings** on the scaffolded `src/index.ts` files were left alone
deliberately. They are correct — nothing imports those packages yet — and they resolve on their own
at Milestone 1 when the packages start depending on each other. Silencing a warning that is telling
the truth would be the mistake.
