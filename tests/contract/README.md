# Connector Contract Tests

**The shared conformance suite every connector must pass before merge.**

This is what keeps a hastily-written connector — or one written by an AI assistant at 11pm — from
becoming the weak link in the component that has network access and credentials.

## What it proves

Every connector:

- Honors its declared timeouts
- Retries correctly, and **never retries a non-idempotent operation** without an idempotency key
- Opens its circuit breaker after repeated failures
- **Blocks requests to hosts not in its `egress.hosts` allowlist**
- Implements `dryRun` for every write operation, with output matching what `execute` would do
- Returns `Result` rather than throwing for expected failures
- Respects its declared rate limits *before* sending, not after being throttled
- Reports health accurately, including `unknown`

Adding a connector means passing this suite. No exceptions.
