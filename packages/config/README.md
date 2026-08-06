# @friday/config

**The only package that reads `process.env`.**

Milestone: **M1**

## Charter

One validated place for configuration. Precedence, lowest to highest: built-in defaults →
`config.toml` → environment variables → runtime overrides.

## What lives here

- Zod-validated configuration schema
- Precedence resolution
- Keychain references for anything secret

## What does NOT

- **Secret values.** Configuration holds Keychain *references*, never credentials.
- Any consumer-specific logic

## Rules

1. **Validated at startup.** Invalid configuration → Safe Mode with a clear message, not a
   mysterious failure three hours later.
2. **`.env.example` documents every variable** with no real values.
3. **Configuration changes are audited events**, and some require approval — budgets, retention,
   Guardian settings.
4. **No other package reads `process.env`.** Enforced by lint.

Reference: [Chapter 33](../../docs/01-bible/33-deployment-strategy.md)
