# @friday/config

**The only package that reads `process.env`.**

Milestone: **M1**

## Charter

One validated place for configuration. Precedence, lowest to highest: built-in defaults →
`config.toml` → environment variables → runtime overrides.

`config.toml` is looked for in the data directory, so it is found without anyone passing a flag.
That is also the one ordering constraint in the chain: the data directory itself can only be set by
the environment or a flag, because a settings file cannot say where to look for the settings file.

## What lives here

- Zod-validated configuration schema
- Precedence resolution
- TOML parsing ([ADR-0022](../../docs/adr/0022-toml-for-the-configuration-file.md)). JSON is also
  accepted, by file extension, for config written by a script rather than by a person.
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
