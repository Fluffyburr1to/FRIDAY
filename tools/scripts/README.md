# Scripts

Setup, maintenance, and release automation. Nothing here ships.

## Planned

| Script | Purpose | Milestone |
|---|---|---|
| `setup.sh` | First-run: dependencies, database, keychain entries, config | M0 |
| `check.sh` | Everything CI runs, locally — **`pnpm check`** | M0 |
| `new-package.ts` | Scaffold a package with the standard anatomy | M1 |
| `new-department.ts` | Copy and initialize the department template | M3 |
| `new-connector.ts` | Copy and initialize the connector template | M4 |
| `scrub-fixtures.ts` | Redact real data before fixtures are committed | M4 |
| `staging-refresh.ts` | Copy production data to staging, **anonymizing on the way** | M4 |
| `release.ts` | Version, changelog, tag — signing stays manual | M4 |
| `recovery-card.ts` | Generate the printable recovery card | M5 |

## Rules

1. **`check.sh` must run everything CI runs.** If a check only exists in CI, you find out about
   failures fifteen minutes later instead of immediately.
2. **`staging-refresh` cannot be run without anonymization.** A bug in an experimental connector
   must never be able to email your actual contacts.
3. **Release signing is never scripted.** The signing key is the most dangerous key in the system
   ([Chapter 18](../../docs/01-bible/18-security-model.md)).
