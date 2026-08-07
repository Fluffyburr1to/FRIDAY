# ADR-0022 — TOML for the configuration file

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [packages/config/README.md](../../packages/config/README.md)

---

## Context

[Chapter 33](../01-bible/33-deployment-strategy.md) and
[`packages/config/README.md`](../../packages/config/README.md) both name the configuration file
`config.toml`. Node ships no TOML parser, so reading one requires a dependency — and CLAUDE.md rule 4
says to ask rather than take that in passing.

Milestone 1 shipped the file layer reading JSON as a stopgap, with the question raised. This ADR
records the answer.

The forces, in the order they mattered:

1. **The documentation is the specification.** Two documents say `config.toml`. Changing the
   implementation to match the docs is cheaper than changing the docs to match a stopgap, and the
   docs made the better call in the first place.
2. **A config file is read by a person more often than by a program.** TOML has comments; JSON does
   not. A settings file nobody can annotate is one where the reason for every value is lost, which
   for a system whose owner does not read code is a real cost.
3. **A hand-rolled parser was never viable.** Rule 4 says prefer fifty lines over a package. A
   correct TOML 1.0 parser is an order of magnitude past that, and the failure mode of an
   approximate one is the worst kind: a file that parses to something subtly different from what it
   says.

What was not known when the stopgap shipped: whether a small, well-maintained, zero-dependency TOML
parser existed. It does.

## Decision

We will **use `smol-toml` to parse `config.toml`**, confined to `packages/config`. JSON is also
accepted, selected by file extension. `config.toml` is looked for in the data directory, so the file
layer works without anyone passing a flag.

## Constitutional review

- **Article I (The User):** the owner can read and annotate their own configuration. That is what
  the comment support is for.
- **Article IV (Privacy):** unchanged. The file holds Keychain references, never values, and a test
  asserts no secret-shaped string appears in `.env.example`.
- **Principle 10 (Simplicity Wins):** in tension, mildly. Two accepted formats is more than one. The
  tension is recorded below rather than argued away.

**The five questions:**

- [x] **Can the user see it?** It is a text file they own, with comments.
- [x] **Can the user stop it?** A malformed file stops startup with the line number, rather than
      being ignored.
- [x] **Can we replace it?** Parsing is one file with one import.
- [x] **Can we explain it?** The error names the file, the format, and the parser's position.
- [x] **Will this still be right in five years?** TOML 1.0 is a frozen specification. The parser may
      be replaced; the format will not need to be.

**Notes:** `smol-toml` is BSD-3-Clause, has no runtime dependencies, and was last published
2026-07-26. Zero dependencies mattered more than any feature — Chapter 18 treats every dependency as
attack surface running with FRIDAY's full privileges.

## Alternatives considered

### Keep JSON and change the documentation

**What it is.** Amend Chapter 33 and the README to say `config.json`, and add no dependency.

**Advantages.** No dependency at all, which is the strongest argument available under rule 4. `JSON.parse` is in the runtime, will never be unmaintained, and cannot have a supply-chain problem.

**Why rejected.** It loses comments, which is most of why the docs chose TOML. It also sets a
precedent that documentation bends to whatever was easiest to implement — and in a project whose
governing documents are meant to outrank the code, that precedent is worth more than the dependency
is worth avoiding.

### `@iarna/toml`

**What it is.** The long-standing TOML parser for Node.

**Advantages.** Widely used, battle-tested, zero dependencies.

**Why rejected.** Last published 2023, and it targets TOML 0.5 rather than 1.0. An unmaintained
parser on the file that configures budgets and key references is not where to accept staleness.

### `@ltd/j-toml`

**What it is.** A thorough, standards-focused TOML 1.0 implementation.

**Advantages.** Arguably the most rigorous of the options.

**Why rejected.** Last published 2023, and LGPL-3.0 — a copyleft licence on a dependency of a
private personal project is a complication with no upside here.

### YAML

**What it is.** Not on the table, but worth naming since it is the reflexive choice.

**Why rejected.** Significant whitespace and the Norway problem (`no` parsing as `false`) make it a
poor fit for a file where a wrong value is a misconfigured budget. TOML's grammar has no comparable
traps.

## Consequences

**Positive**

- The implementation matches the documentation, so nobody has to discover the discrepancy.
- Configuration can carry comments explaining why each value is what it is.
- `config.toml` is found in the data directory without a flag — which means the file layer is
  actually used. Before this it loaded only when something passed `--config`, so in practice never.
- Parse errors name the line and column.

**Negative**

- **A dependency where there was none.** `smol-toml` is small and clean today; it is one maintainer's
  package, and that is the risk being accepted.
- **Two accepted formats.** Someone will eventually write `config.json` and `config.toml` side by
  side and be surprised that only one is read. The default lookup only ever finds `config.toml`,
  which limits but does not remove the confusion.
- The data directory cannot be set from the config file, because the file is found inside it. This
  is inherent rather than incidental, and it is documented in the README — but it will surprise
  someone.

**Neutral**

- The stopgap's JSON path was kept rather than removed. It costs four lines and covers
  machine-generated configuration.

## Reversibility

- **Cost to reverse:** low.
- **How:** `packages/config/src/config-file.ts` is the only file that parses anything. Existing
  installations would need their `config.toml` converted, which for a single-user system is one
  file.
- **Point of no return:** none.

## Review triggers

- `smol-toml` goes unmaintained for more than a year, or a supply-chain advisory names it.
- Node gains a built-in TOML parser — remove the dependency the day it is stable.
- Anyone writes both `config.toml` and `config.json` and is confused — reconsider accepting JSON.
- Configuration grows past what a single flat file should hold.

## Notes

The JSON path is deliberately not documented as a supported format anywhere except the README's
parenthetical. `config.toml` is the answer to "where do settings go"; JSON is a courtesy to
installers.
