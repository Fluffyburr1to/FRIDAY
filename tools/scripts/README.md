# Scripts

Setup, maintenance, and release automation. Nothing here ships.

## Present

| Script | Purpose | Run by |
|---|---|---|
| `check-types.mjs` | `tsc --build` over every package, then every test file | `pnpm check:types` |
| `check-boundaries.mjs` | dependency-cruiser — the architectural boundary rules | `pnpm check:boundaries` |
| `check-docs.mjs` | Every directory has a README; every internal link resolves | `pnpm check:docs` |
| `check-workflows.mjs` | Every workflow parses, declares `permissions`, and pins its actions | `pnpm check:workflows` |
| `install-git-hooks.sh` | Local pre-commit, commit-msg, and pre-push hooks | `pnpm run setup` |
| `setup-branch-protection.sh` | Applies branch protection via `gh` | manually, once |

Each `check-*` script reports **"there is nothing to check yet"** distinctly from **"the check
passed"**. That distinction is the whole reason they exist rather than a `|| echo` in `package.json`:
a check that cannot tell an empty repository from a broken one is not a check.

`check-workflows.mjs` exists because a workflow with a YAML error does not fail loudly — GitHub
simply does not run it, and the pull request shows a green tick because nothing objected. For a
pipeline that is the verification layer of the approval system, that is the worst available failure
mode.

## Planned

| Script | Purpose | Milestone |
|---|---|---|
| `new-package.ts` | Scaffold a package with the standard anatomy | M1 |
| `new-department.ts` | Copy and initialize the department template | M3 |
| `new-connector.ts` | Copy and initialize the connector template | M4 |
| `scrub-fixtures.ts` | Redact real data before fixtures are committed | M4 |
| `staging-refresh.ts` | Copy production data to staging, **anonymizing on the way** | M4 |
| `release.ts` | Version, changelog, tag — signing stays manual | M4 |
| `recovery-card.ts` | Generate the printable recovery card | M5 |

## Rules

1. **`pnpm check` must run everything CI runs.** If a check only exists in CI, you find out about
   failures fifteen minutes later instead of immediately. Nothing in the pipeline may depend on
   GitHub-specific behaviour beyond triggering.
2. **`staging-refresh` cannot be run without anonymization.** A bug in an experimental connector
   must never be able to email your actual contacts.
3. **Release signing is never scripted.** The signing key is the most dangerous key in the system
   ([Chapter 18](../../docs/01-bible/18-security-model.md)).

## release.ts — building the installable artifact

`node tools/scripts/release.ts`

Runs **build → deploy → audit → extract → run**, and refuses to hand over an artifact that would
only work on the machine that made it.

It never runs pnpm in this checkout. `pnpm deploy --prod` leaves the workspace it ran in marked
production-only, and the next ordinary `pnpm` command there offers to delete every development
dependency — which has already happened once. The script clones to a fixed staging directory and
works only there.

`release-audit.ts` holds the gate: no build-machine path anywhere in the tree, no symlink that
dangles or escapes, and the four things that have gone missing before — the CLI, the core, the
shipped rules, and the macOS driver prebuild. Its logic is tested in
[`tests/architecture/release-audit.test.ts`](../../tests/architecture/release-audit.test.ts) against
planted fixtures, which run on any platform.
