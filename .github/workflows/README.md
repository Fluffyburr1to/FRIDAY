# Workflows

**Owner-only. FRIDAY may never modify this folder.**

To be written at Milestone 0, before FRIDAY can propose anything. See
[.github/README.md](../README.md) for the list and
[Chapter 27](../../docs/01-bible/27-cicd-pipeline.md) for the full pipeline design.

## Two standing rules

**1. Nothing may depend on GitHub-specific behavior beyond triggering.** Every stage runs standard
`pnpm` scripts, so `pnpm check` reproduces CI locally and migrating to another CI provider is a
configuration change rather than a rewrite. GitHub is a development-time dependency, and Principle 5
says it must stay replaceable.

**2. CI is never skipped — including for hotfixes.** This is the rule most tempting to break at 2am
and the one that most needs to hold. Hotfixes are written under pressure, which is exactly when a
change breaks something unrelated. **Safe Mode is the pressure valve**: it stops the harm
immediately so the fix can go through the normal process.
