# @friday/tsconfig — Shared TypeScript Configuration

Every package extends a base from here. Settings are defined once so they cannot drift between
packages.

## The configurations

| File | Extends | For |
|---|---|---|
| `library.json` | `tsconfig.base.json` | Everything in `packages/`, and Node applications in `apps/` |
| `react-app.json` | `library.json` | Anything that runs in a browser — `apps/web`, `packages/ui-kit` |

**There is deliberately no separate `node-app.json`.** A Node application compiles under exactly the
same settings as a library, and a second file that merely repeats `library.json` would be a lie
waiting to drift. When applications genuinely need different settings, that is the moment to add it.

`react-app.json` is the only configuration that grants the DOM library. Whether a package can reach
`window` is therefore visible from the one line that says which config it extends, rather than
buried in a compiler option.

## How a package uses it

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@friday/tsconfig/library.json",
  "references": [{ "path": "../contracts" }] // one entry per workspace dependency
}
```

and in its `package.json`:

```jsonc
"devDependencies": { "@friday/tsconfig": "workspace:*" }
```

Every package must also appear in the root `tsconfig.json` `references` list. A package missing from
that list is a package that silently never gets typechecked, so `tools/scripts/check-types.mjs`
fails the build when the two drift apart.

## Test files

Test files are **not** compiled by `tsc --build`. Emitting declarations for tests would put them in
`dist/`, and excluding them from the package build is what keeps the published surface honest.

They are typechecked instead by `tsconfig.tests.json` at the repository root, which covers every
`test/` folder in the workspace in one pass with the same strict settings. `pnpm check:types` runs
both, so a type error in a test fails CI exactly like a type error in `src/`.

## Non-negotiable settings

```
strict                      noUncheckedIndexedAccess
noImplicitAny               exactOptionalPropertyTypes
strictNullChecks            noImplicitOverride
noImplicitReturns           noFallthroughCasesInSwitch
noUnusedLocals              verbatimModuleSyntax
noUnusedParameters          isolatedModules
```

**`noUncheckedIndexedAccess` is the one people disable first and should not.** It types `array[0]` as
possibly undefined, which is *true*, and it catches a genuinely common class of crash.

Maximum strictness is what catches an AI assistant's mistakes before the owner ever sees them. That
is the highest-value property of the type system in this project — relaxing these settings for
velocity trades away the main safety net.

Reference: [Chapter 30](../../docs/01-bible/30-coding-standards.md)
