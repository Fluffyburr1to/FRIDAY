# Shared Lint Configuration

**Biome** — formatting and linting in one tool, roughly 10–20× faster than ESLint + Prettier.

## Where the configuration actually lives

**`biome.jsonc` at the repository root, and nowhere else.** Unlike TypeScript and Vitest, which need
a config file per package, Biome lints and formats the entire tree in a single pass from one file —
so a shared fragment here would be indirection with nothing on the other end.

This folder holds shared configuration for the case where a package genuinely needs an override.
That case has not arisen, and it should stay rare: the root config's per-directory `overrides` block
is the better place for a narrow exception, because it keeps every rule and every exception readable
in one file.

## Rules

1. **Formatting is never discussed.** Biome decides, the pre-commit hook applies it, and neither a
   human nor an AI assistant spends attention on it.
2. **`any` requires a written justification** in an inline disable comment explaining why it is
   unavoidable and what guarantees safety.
3. **No floating promises.** Every promise awaited or explicitly `void`ed.
4. **No `console.log`** — use the logger, which redacts.
5. **No `process.env` outside `packages/config`.**

Architectural rules that Biome cannot express — module boundaries, vendor SDK restrictions,
database access restrictions — live in `.dependency-cruiser.cjs` at the repository root.

Reference: [Chapter 30](../../docs/01-bible/30-coding-standards.md)
