# @friday/connector-sdk

**The contract every connector implements.**

Milestone: **M4**

## Charter

Connectors are the only components with network access. This SDK is what makes them uniform enough
that privacy and reliability can be enforced at one boundary.

## What lives here

- The `Connector` interface: `initialize` · `health` · `execute` · `dryRun` · `shutdown`
- The manifest schema, including `egress.hosts` and `dataCategories`
- **The egress-enforcing HTTP agent** — refuses any host not in the manifest
- Retry, backoff, circuit breaker, and rate limiting, implemented once
- Credential Broker client (requests short-lived scoped tokens; never stores them)
- The contract test suite every connector must pass

## What does NOT

- Any specific service's logic
- Credential storage of any kind

## Rules the SDK enforces

1. **Undeclared egress is blocked** and raises a diagnostic.
2. **Non-idempotent operations are never retried** without an idempotency key.
3. **Every call is bounded by a timeout.** No unbounded waits.
4. **`dryRun` is mandatory for write operations** — you approve the actual artifact, not a
   description of it.

Reference: [Chapter 14](../../docs/01-bible/14-connector-framework.md)
