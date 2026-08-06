# @friday/contracts

**The single source of truth for every data shape in FRIDAY.**

Milestone: **M1** · Load-bearing: **yes** (owner review required)

## Charter

Every data shape that crosses a boundary is defined here, once, as a Zod schema. From that single
definition we derive: the TypeScript type, the runtime validator, the database column types, the
JSON Schema given to AI models, the API documentation, and the form validation in the dashboard.

They cannot drift, because there is only one of them.

## What lives here

- Event schemas, with `payloadVersion` and upcasters for older versions
- Plan, step, approval, and standing-grant shapes
- Memory, actor, and principal shapes
- Risk classes, sensitivity levels, error codes (closed enumerations)
- Manifest schemas for departments, connectors, agents, and plugins

## What does NOT

- Any business logic — this package is declarations only
- Anything importing another FRIDAY package. **`contracts` imports nothing internal.** It is the
  root of the dependency graph; if it ever imports from FRIDAY, the architecture has inverted.

## Rules

1. **Every schema declares a `sensitivity`.** Required, not optional — it drives encryption,
   logging redaction, and whether the data may reach a cloud model.
2. **Event payloads are versioned and never rewritten.** Add `v2` and an upcaster; historical events
   keep their original shape forever.
3. **Error codes are a closed enum**, so every client is compile-checked against the complete set.
4. Changes here ripple everywhere. That is the feature — the compiler lists every place that must
   be updated.

Reference: [Chapter 20](../../docs/01-bible/20-api-standards.md)
