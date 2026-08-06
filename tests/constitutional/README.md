# Constitutional Tests

**Protected. FRIDAY may never propose changes to this folder. Owner review required.**

These tests do not assert that features work. They assert that **the Constitution is enforced by the
code**.

Full list and rationale: [Chapter 27](../../docs/01-bible/27-cicd-pipeline.md) ·
[Chapter 28](../../docs/01-bible/28-testing-strategy.md) · [tests/README.md](../README.md)

## When one fails

**Never adjust the test.**

Either the code has violated a founding guarantee — fix the code — or the guarantee itself needs
amending, which requires an ADR and the owner's deliberate decision. Not a quiet edit to an
assertion.

A failure here is a stop-the-line event.
