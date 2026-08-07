# ADR-0017 — `tools/<tool>-config` is a pattern, not a closed list

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [RFC 0001](../rfc/0001-shared-test-configuration.md),
  [Chapter 03 — Repository Structure](../01-bible/03-repository-structure.md),
  [Chapter 28 — Testing Strategy](../01-bible/28-testing-strategy.md)

---

## Context

[Chapter 03](../01-bible/03-repository-structure.md) enumerates the contents of `tools/`:
`tsconfig/`, `lint-config/`, `scripts/`, and `evals/`. It was written before any tooling existed, so
the list describes what was foreseen rather than what the project turned out to need.

Milestone 2 set up Vitest. Every package shares the same test settings — the two tiers, their
timeouts, mock-reset behaviour, coverage provider and thresholds — and there was no stated home for
them. Chapter 03 names a home for shared TypeScript configuration and one for shared lint
configuration, and both exist for the same reason that applies here: with twenty packages ahead,
configuration that is copied rather than shared drifts, and the drift is invisible, because a
package whose coverage threshold has quietly slipped to 50% still shows a green tick.

[RFC 0001](../rfc/0001-shared-test-configuration.md) raised this and asked whether the `tools/`
listing is exhaustive or illustrative. What was not known at the time: whether later tools —
Playwright at M4, Vite at M4, Tailwind alongside it — should each get a sibling folder or share one.

## Decision

We will **read Chapter 03's `tools/` listing as illustrative of a pattern rather than as a closed
list**, and keep `tools/vitest-config/` as `@friday/vitest-config`.

Shared configuration for a tool lives in `tools/<tool>-config/`, named after the tool it configures.
Chapter 03's listing is amended to include `vitest-config/` and to say so explicitly, so the next
contributor adding one does not have to re-open this question.

## Constitutional review

- **Principle 6 (Architecture Is Sacred):** honored. The Bible chapter is amended in writing rather
  than quietly diverged from, and the amendment states the rule so the next case is decided by the
  rule instead of by precedent.
- **Principle 10 (Simplicity Wins):** in mild tension, and worth naming. One folder per tool is more
  folders than one folder for all tooling. Accepted, because the alternative names a folder after
  nothing in particular — see below.
- **Core Value 9 (Document Everything):** the pattern is now stated rather than inferred.

**The five questions:**

- [x] **Can the user see it?** — `ls tools/` shows exactly which tools have shared configuration.
- [x] **Can the user stop it?** — Normal pull request flow; `tools/vitest-config/` is a CODEOWNERS
      path because the test harness decides what "the tests passed" means.
- [x] **Can we replace it?** — Each package's test config is three lines. Moving the preset is a
      rename and four one-line edits.
- [x] **Can we explain it?** — The folder name is the explanation.
- [x] **Will this still be right in five years?** — Yes. Tools come and go; each one's configuration
      having an obvious home does not.

## Alternatives considered

### One `tools/build-config` package holding every tool's shared configuration

**What it is.** A single package exporting a Vitest preset now, and Playwright, Vite, and Tailwind
presets later.

**Advantages.** Fewer folders. One place to look for "shared configuration." Avoids the situation
where `tools/` has six `*-config` entries and the interesting ones — `scripts/` and `evals/` — are
buried among them.

**Why rejected.** The name describes nothing a reader can check. A package's test configuration
importing from something called `build-config` is a small lie that has to be re-explained every time
someone reads it, and the package would accumulate dependencies on four unrelated tools so that
touching the Tailwind preset invalidates the test cache. `tools/tsconfig` and `tools/lint-config`
already establish the one-tool-per-folder shape; a third form would be a third convention.

### Treat Chapter 03's list as exhaustive and put the preset in `tools/lint-config`

**What it is.** No new folder; the nearest existing one absorbs it.

**Advantages.** Chapter 03 needs no amendment.

**Why rejected.** Wrong charter, and `tools/lint-config/README.md` says what belongs there. A future
reader looking for test configuration would not find it — the exact failure Chapter 03's "every
folder has a README stating what does *not* belong in it" rule exists to prevent. Preserving the
letter of a chapter by violating its purpose is not preserving the chapter.

### A single root `vitest.config.ts` using Vitest's `projects` feature

**What it is.** One file at the repository root defining a project per package. No shared package at
all.

**Advantages.** Genuinely the simplest option, and no amendment to Chapter 03.

**Why rejected.** [Chapter 27](../01-bible/27-cicd-pipeline.md) requires "unit tests, affected
packages only" in the pull request pipeline, and Turborepo can only run and cache a per-package
`test` task if each package owns its configuration. This trades the incremental test loop — which
[Chapter 02](../01-bible/02-technology-stack.md) calls the primary determinant of whether an
evenings-and-weekends project makes progress — for one fewer folder. A root config is still used for
the *cross-cutting* tests in `tests/`, which genuinely are one suite.

## Consequences

**Positive**

- Shared test configuration has an obvious home, and so will Playwright and Vite when they arrive.
- The rule is stated in Chapter 03, so the next tool does not need an ADR.
- Per-package Vitest configuration stays three lines, which is what keeps it from drifting.

**Negative**

- **`tools/` will grow.** By M4 it plausibly holds `tsconfig`, `lint-config`, `vitest-config`,
  `playwright-config`, `vite-config`, `scripts`, and `evals` — and the two that matter most,
  `scripts/` and `evals/`, become harder to spot in the listing. Mitigated by `tools/README.md`
  grouping them; revisit if the count passes roughly eight.
- Each config package is another `package.json` and another workspace member for pnpm to resolve.
  Small, but not zero.

**Neutral**

- Chapter 03's document history gains an amendment entry. That is the process working, not a defect.

## Reversibility

- **Cost to reverse:** low
- **How:** move `index.js` and `index.d.ts` into whichever package should own them, update the four
  three-line `vitest.config.ts` files and the `devDependencies` entry naming it, revert the
  Chapter 03 amendment.
- **Point of no return:** none. The cost grows only with the number of packages importing it, and
  each import is one line.

## Review triggers

- `tools/` exceeds roughly eight entries → reconsider grouping, the same way
  [Chapter 03](../01-bible/03-repository-structure.md) anticipates splitting `packages/` past thirty.
- Two tools' presets turn out to need to share logic → that is evidence for the single-package
  alternative, and this ADR should be revisited rather than worked around.
- A contributor puts shared configuration somewhere else because this pattern was not discoverable →
  the amendment did not do its job; fix Chapter 03 rather than the contributor.

## Notes

RFC 0001 is closed by this decision.

The preset was implemented before the decision was taken, which is the wrong order and is worth
recording as such. It happened because Milestone 2's objective was a *working* test harness and a
proposal does not run tests. The mitigation used — flagging the folder as provisional in its own
README and in `tools/README.md`, so it could not become permanent by default — is the right one when
this recurs, but the ordering in [Chapter 37](../01-bible/37-adr-process.md) is the standard.
