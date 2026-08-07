# @friday/vitest-config — Shared Test Configuration

**Vitest**, configured once so that twenty packages cannot end up with twenty subtly different test
harnesses.

Part of the `tools/<tool>-config` pattern — shared configuration for one tool, named after that
tool. Accepted in [ADR-0017](../../docs/adr/0017-shared-tool-configuration-packages.md), which
amended [Chapter 03](../../docs/01-bible/03-repository-structure.md) to state the pattern rather
than list its members.

## How a package uses it

```ts
// packages/<name>/vitest.config.ts
import { defineConfig } from 'vitest/config'
import { fridayTest } from '@friday/vitest-config'

export default defineConfig(fridayTest({ name: 'contracts' }))
```

## What it fixes, and why

| Setting | Value | Reason |
|---|---|---|
| `globals` | `false` | `describe` and `it` are imported explicitly. The extra line tells a reader — and an AI assistant reading one file cold — where they came from. |
| `clearMocks`, `mockReset`, `restoreMocks` | `true` | A test that passes only because a previous test left a mock behind fails later, for a reason unrelated to the change that broke it. |
| Unit timeout | 5s | A unit test that needs longer is doing I/O and belongs in `test/integration/`. |
| Integration timeout | 30s | Real SQLite, real event bus, recorded connector fixtures. |
| `fileParallelism` (integration) | `false` | Integration tests share a real database. Lock contention is noise, not signal. |
| Coverage provider | `v8` | No instrumentation step, and it measures the code that actually ran. |
| Coverage thresholds | 80% | Chapter 28. `packages/guardian` and `packages/contracts` override to 100%. |

## The two tiers

```
packages/<name>/test/
├── unit/           fast, no I/O          → vitest --project <name>:unit
└── integration/    real DB, real bus     → vitest --project <name>:integration
```

They are separate Vitest projects rather than one glob so that the inner loop stays fast and so an
integration timeout never silently applies to a unit test.

**End-to-end tests are not here.** They are Playwright, they live in
[`tests/e2e/`](../../tests/e2e/README.md), and they arrive at Milestone 4 with something to click.

## Known compromises

**`passWithNoTests` is `true`.** Packages scaffolded ahead of their milestone have no tests yet, and
a permanently red suite is one everybody learns to ignore. The cost is real: a broken `include` glob
passes silently instead of failing.

**Revisit this the moment Milestone 1 lands code that has tests.** The setting is a scaffolding
convenience, not a standard — and it is exactly the kind of thing that stays in a repository for
three years because nobody wrote down that it was temporary.

Reference: [Chapter 28 — Testing Strategy](../../docs/01-bible/28-testing-strategy.md)
