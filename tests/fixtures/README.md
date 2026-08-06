# Test Fixtures

Shared test data: recorded HTTP responses, sample events, sample plans, synthetic memories.

## The rule that matters

**Fixtures are scrubbed of real data automatically before commit.**

A fixture containing a real email body, a real name, or a real token puts personal data in git
history **permanently** — and git history cannot be meaningfully redacted after the fact.

The scrubber runs as a pre-commit hook and in CI. It redacts message bodies, replaces names and
addresses with synthetic equivalents, and strips anything credential-shaped.

If you are unsure whether a fixture is clean, it is not. Regenerate it.
