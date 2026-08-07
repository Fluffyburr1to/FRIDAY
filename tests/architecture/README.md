# Architecture Tests

**Tests that the architectural boundary rules can actually fire.**

Not tests of the architecture — `dependency-cruiser` does that, on every commit, over the real
module graph. These test **the rules themselves**.

## Why this tier exists

At Milestone 0 the boundary rules in `.dependency-cruiser.cjs` were written before any code existed.
Two of them — the ones enforcing the most load-bearing guarantees in the system — were written like
this:

```js
to: { dependencyTypes: ['npm'], path: '^(better-sqlite3|drizzle-orm|…)' }
```

That is the obvious way to write it and it is wrong. dependency-cruiser matches `to.path` against
the **resolved** path, and under pnpm importing `better-sqlite3` resolves to:

```
node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js
```

A pattern anchored with `^better-sqlite3` can never match that. So from Milestone 0 until Milestone 2:

| Rule | Guarantee it was believed to enforce | What it actually did |
|---|---|---|
| `no-ai-vendor-sdk-outside-model-router` | Principle 5 — no vendor lock-in, one chokepoint | nothing |
| `no-database-access-outside-storage` | One place enforces encryption and `principal_id` isolation | nothing |

Neither had ever been tested, because until Milestone 2 there was no dependency installed that could
have triggered them. CI was green, and the green meant nothing.

**A rule that cannot fire is worse than no rule at all**, because the pipeline reports success and
everyone — the owner, and every AI assistant reading the config — believes the guarantee holds. That
is the failure mode this folder exists to prevent from recurring.

## What is covered, and what is not

**Covered:** that each rule's pattern matches the resolved paths a forbidden import actually
produces, under both pnpm's virtual store and a flat `node_modules` tree, and that it does not match
innocent paths.

**Not covered:** dependency-cruiser's own matching engine. These tests exercise the patterns, which
is precisely where the defect was — not the tool that consumes them.

The genuinely end-to-end check is the one performed by hand when a rule changes: add the forbidden
import to a package that should not have it, run `pnpm check:boundaries`, and confirm it fails. The
transcript of doing exactly that is recorded in
[ADR-0018](../../docs/adr/0018-better-sqlite3-as-the-sqlite-driver.md).

## Rules

1. **When you add a boundary rule, add its test here.** A rule with no test is a rule nobody has
   confirmed can fire.
2. **Test the negative too.** A pattern that matches everything passes the positive test and blocks
   legitimate work.
3. **These are not constitutional tests.** [`tests/constitutional/`](../constitutional/README.md)
   asserts the founding guarantees hold at runtime; this folder asserts that one enforcement
   mechanism is wired up. Different tier, different protection.

Reference: [Chapter 03](../../docs/01-bible/03-repository-structure.md) ·
[Chapter 28](../../docs/01-bible/28-testing-strategy.md)
