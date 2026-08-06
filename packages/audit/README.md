# @friday/audit

**Answers "why did you do that?" from recorded fact.**

Milestone: **M2** · Load-bearing: **yes**

## Charter

Reconstructs the causal chain from the event log and composes it into a plain-language explanation.

**Never by asking a model to recall its own reasoning.** Models confabulate about their past
behavior fluently and falsely. Principle 7 requires explanations that are *true*, and the only
reliable source of truth about the past is a record made at the time.

## What lives here

- Causal chain traversal via `causationId` / `correlationId`
- Explanation composition at three depths: summary, standard, full
- Audit chain integrity verification (hash chain, end to end)
- Redaction with tombstones — content removed, chain preserved

## What does NOT

- Writing events (that is `kernel`)
- Any inference not backed by a recorded event

## The rule

**Every claim in an explanation must map to a recorded event.** A model may be used to *phrase* an
explanation more naturally, but only over facts read from the audit trail — and the generator
validates that no unsupported sentence survives.

That is the difference between an explanation and a story.

Reference: [Chapter 10](../../docs/01-bible/10-event-bus.md)
