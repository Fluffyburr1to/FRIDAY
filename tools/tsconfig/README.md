# Shared TypeScript Configuration

Every package extends a base from here. Settings are defined once so they cannot drift between
packages.

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
