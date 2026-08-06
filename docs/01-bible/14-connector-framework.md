# 14 — Connector Framework

> **Governing provisions:** Constitution Article IV (Privacy — minimize data, minimum necessary
> disclosure), Article V (Security — least privilege), Article VI (Modularity), Article VII
> (Reliability); Manifesto Principle 4 (Privacy Is Fundamental), Principle 5 (Modularity).

---

## In plain language

A connector is a translator between FRIDAY and one external service. There is a Google Calendar
connector, a GitHub connector, a Home Assistant connector, and so on.

Connectors are the **only** part of FRIDAY that talks to the outside world. Nothing else has network
access. That is deliberate and it is the point of this chapter: if all outbound traffic passes
through a small number of components that follow identical rules, then privacy and security become
enforceable at one boundary rather than scattered across the system.

Your Manifesto says: *"External services should only receive the minimum information required."*
That sentence is the hardest requirement in the founding documents to actually honor, because the
natural way to build an integration is to hand it everything it might need and let it sort things
out. A connector framework is how you make minimum-disclosure the default rather than the
exception.

Connectors are also the dumbest components in FRIDAY, on purpose. A connector has no judgment. It
does not decide when to send an email — it only knows *how*. All judgment lives in departments. This
keeps the risky component simple enough to review completely.

---

## Recommendation

Connectors implement a single interface from `packages/connector-sdk`, declare everything they do
in a manifest, hold no credentials themselves, and are the only components permitted to make
outbound network requests.

### The manifest — a privacy contract with teeth

```
{
  "id": "google-calendar",
  "service": "Google Calendar",
  "version": "1.0.0",

  "auth": {
    "type": "oauth2",
    "scopes": ["calendar.readonly", "calendar.events"],
    "scopeJustification": {
      "calendar.readonly": "Read events to detect conflicts and prepare briefings",
      "calendar.events":   "Create and modify events you have approved"
    }
  },

  "egress": {
    "hosts": ["www.googleapis.com", "oauth2.googleapis.com"],   ← ENFORCED allowlist
    "dataCategories": ["calendar_events", "contact_emails"],    ← what actually leaves
    "transmitsPersonalData": true,
    "dataRetentionByProvider": "Per Google's terms; not controlled by FRIDAY"
  },

  "operations": [
    { "id": "list-events",   "riskClass": "low",    "idempotent": true,
      "reads": ["calendar_events"], "writes": [] },
    { "id": "create-event",  "riskClass": "medium", "idempotent": false,
      "irreversible": false, "reads": [], "writes": ["calendar_events"] },
    { "id": "delete-event",  "riskClass": "high",   "idempotent": true,
      "irreversible": true,  "reads": [], "writes": ["calendar_events"] }
  ],

  "rateLimits":  { "requestsPerMinute": 60, "burstSize": 10 },
  "healthCheck": { "operation": "list-events", "intervalSeconds": 300 },
  "supportsDryRun": true
}
```

Three declarations here are load-bearing rather than documentary.

**`egress.hosts` is enforced at the network layer.** The connector runtime installs an HTTP agent
that refuses any request to a host not on this list. A connector that tries to reach an
undeclared domain gets a connection error and a `security.egress.blocked` event that raises a
diagnostic. This defends against a compromised dependency, a manipulated agent, and simple
mistakes. It is one of the highest-value controls in the entire security model, and it costs
almost nothing.

**`dataCategories` powers the privacy dashboard.** You can ask "what has left my machine this
week?" and get a truthful, itemized answer, because every outbound call is tagged with the
categories its connector declared. Article IV becomes something you can *audit* rather than
something you are told.

**`scopeJustification` must be written per scope.** This exists to prevent the most common privacy
failure in integrations: requesting broad permissions because it is convenient. If you cannot write
a sentence explaining why FRIDAY needs full mailbox access, you request read-only instead. This is
reviewed when a connector is added.

### The interface

```
interface Connector {
  readonly manifest: ConnectorManifest

  initialize(ctx: ConnectorContext): Promise<Result<void, ConnectorError>>
  health(): Promise<HealthStatus>
  execute<Op>(op: Op, input: InputOf<Op>, ctx: OperationContext)
    : Promise<Result<OutputOf<Op>, ConnectorError>>
  dryRun<Op>(op: Op, input: InputOf<Op>): Promise<DryRunResult>
  shutdown(): Promise<void>
}
```

Small on purpose. A connector is a thin, boring adapter, and a small interface is a small surface to
review and a small thing to reimplement when a service changes its API.

**`Result` rather than exceptions.** A failing external service is an expected, ordinary outcome,
not an exceptional one. Returning a typed failure forces every caller to handle it — Article VII's
"failures should be predictable" enforced by the compiler.

**`dryRun` is mandatory for every write operation.** Before FRIDAY asks you to approve sending an
email, she runs the dry run and shows you exactly what would happen: the recipient, the subject, the
body, the account it sends from. Approving an abstract description ("send an email to Sarah") is
much weaker consent than approving the actual artifact. Principle 7 requires the user have context;
dry run is how the approval screen gets it.

---

## Credentials

**Connectors never store, and never see, long-lived credentials.**

```
Connector needs to call Google
        │
        ▼
Requests a token from the Credential Broker (in the kernel)
        │
        ├─ Broker checks: does this connector's manifest permit this scope?
        ├─ Broker fetches the refresh token from the macOS Keychain
        ├─ Broker exchanges it for a short-lived access token
        ├─ Broker records credential.issued
        ▼
Connector receives a scoped token valid for ~15 minutes, in memory only
```

What this buys:

- A compromised connector leaks a token that expires in minutes, not a refresh token that lasts
  forever.
- Every credential use is audited — the dashboard shows which connector used which credential when.
- Revocation is instant and central: revoke in the broker and every connector loses access at once.
- The database contains no secrets (see [Chapter 09](09-database-design.md)), so a stolen backup is
  not a breach of your accounts.

**Scope minimization is enforced at issuance.** A connector declaring `calendar.readonly` receives a
token with only that scope, even if the underlying OAuth grant is broader. If Google issues a
broad token, the broker restricts what it hands out. Article V's least privilege, applied at the
narrowest point in the system.

---

## Reliability

External services fail constantly. The framework handles it uniformly so no connector reinvents it
(usually badly).

| Mechanism | Behavior |
|---|---|
| **Timeouts** | Every call bounded (default 30s, per-operation override). No unbounded waits. |
| **Retries** | Exponential backoff with jitter, on transient errors only. **Never on non-idempotent operations** unless an idempotency key is supported. |
| **Circuit breaker** | 5 consecutive failures → open for 60s → half-open probe → closed. |
| **Rate limiting** | Token bucket per the manifest, enforced *before* the request. FRIDAY does not discover limits by being throttled. |
| **Health checks** | Periodic cheap probe; result drives the dashboard's service status. |
| **Graceful degradation** | An unhealthy connector marks dependent departments degraded, per their `degradedMode`. |

The retry rule deserves emphasis. **Retrying a non-idempotent operation is how you send an email
three times.** The framework refuses to retry any operation not marked `idempotent: true` unless the
connector supports idempotency keys and one was supplied. This is enforced by the runtime, not left
to each connector's judgment.

---

## Connector risk tiers

Not all connectors deserve the same trust. Three tiers with different requirements:

| Tier | Examples | Requirements |
|---|---|---|
| **Read-only** | Weather, news, public data | Standard review |
| **Read-write, reversible** | Calendar, notes, tasks | Dry run mandatory; write ops ≥ `medium` risk |
| **Irreversible or high-consequence** | Email send, payments, door locks, code push | Dry run mandatory; ≥ `high` risk; **approval can never be granted by a standing grant alone without explicit per-action confirmation for `critical`**; contract tests required; owner sign-off on the manifest |

The third tier is where Article III does its real work, and the framework enforces it structurally
rather than depending on each connector author to be careful.

---

## Testing connectors

Connectors are the hardest thing in FRIDAY to test, because testing means calling someone else's
service. Three layers:

1. **Unit tests** against recorded HTTP fixtures. Fast, deterministic, run on every commit.
2. **Contract tests** (`tests/contract/`) — every connector runs the same conformance suite proving
   it honors the interface: respects timeouts, retries correctly, opens its circuit breaker, blocks
   undeclared egress, and honors dry-run semantics. **New connectors pass this before merge.** This
   is what keeps a hastily-written connector from becoming the weak link.
3. **Live smoke tests** against real services, run manually or nightly, never in the merge path.
   They fail for reasons that have nothing to do with your code, and a test that fails for external
   reasons trains you to ignore failures.

Fixtures are **scrubbed of real data** by an automated redaction step before being committed.
Committing a fixture containing a real email body would put personal data in git history forever.

---

## Alternatives considered

### Direct API calls from departments (no connector layer)

**Advantages:** less code, fewer abstractions, more direct.

**Rejected** because it scatters network access, credential handling, retry logic, and rate limiting
across every department that touches a service. Article IV's minimum-disclosure requirement would
have to be honored independently in a dozen places, which means it would be honored in most of
them. The egress allowlist — arguably the single best security control here — would be impossible.

### A third-party integration platform (Zapier, Make, Pipedream, Nango)

**Advantages:** hundreds of integrations immediately; someone else maintains them.

**Rejected** because every piece of data would flow through a third party's servers, which is a
direct and unambiguous conflict with Article IV. It also makes that platform a load-bearing vendor
dependency in the exact place Principle 5 warns about, and their outage becomes FRIDAY's outage.

**Nango** deserves a specific note: it is a strong open-source option for OAuth token management
specifically, and it is **self-hostable**, which removes the privacy objection. If OAuth
management across many services becomes a maintenance burden around M8, a self-hosted Nango behind
our own Credential Broker interface is a reasonable evolution. Flagged rather than adopted.

### Model Context Protocol (MCP) servers as connectors

**Advantages:** a growing standard for exposing tools to AI systems, with a real ecosystem
appearing, and it would let FRIDAY use community-built integrations.

**Rejected as the primary mechanism** because MCP is designed around exposing tools *to a model*,
whereas FRIDAY needs connectors that are governed by policy, rate-limited, egress-restricted, and
dry-runnable — properties MCP does not specify and cannot enforce.

**Adopted as an adapter.** A generic MCP connector that wraps an MCP server as a FRIDAY connector
gives access to the ecosystem *inside* our controls, where the egress allowlist and Guardian still
apply. That is the right relationship: their ecosystem, our boundary. Planned for M8.

### One giant connector per provider (a single "Google" connector)

**Rejected** because it forces over-broad OAuth scopes — Calendar, Gmail, and Drive in one grant.
Separate connectors per service means separate scopes, separate risk classification, and separate
revocation. Article V.

### Generated connectors from OpenAPI specifications

**Advantages:** fast to create; automatically current with the provider's spec.

**Rejected as the default** because generated code is generic — it has no idea which operations are
irreversible, what data categories it transmits, or what risk class applies. Those judgments are
exactly what the manifest exists to record. **Generation is used as a starting point** for the
mechanical mapping code, with the manifest always hand-written and reviewed.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Every integration requires writing a connector.** Slower than calling an API directly. | Accepted — the template makes it a few hours, and the uniformity is what makes privacy and reliability enforceable. |
| **The interface is lowest-common-denominator.** A service's unique features may not fit. | Accepted — connectors may expose service-specific operations; only the *shape* is uniform. |
| **The Credential Broker adds a hop** to every authenticated call. | Accepted — a few milliseconds for central revocation, auditing, and scope minimization. |
| **Fixture-based tests drift** from the real API. Providers change without telling you. | Accepted — mitigated by nightly live smoke tests that detect drift outside the merge path. |
| **Egress allowlists break when providers add CDN domains.** Real operational friction. | Accepted — a blocked egress produces a clear diagnostic naming the host, so the fix is a one-line manifest change with a visible audit record. |
| **Dry run must be implemented per connector** and is not always straightforward. | Accepted — mandatory for write operations because approval without a preview is weak consent. |

---

## Review triggers

- More than ~20 connectors → evaluate self-hosted Nango for credential management
- MCP ecosystem matures → build the MCP adapter connector
- Fixture drift causes repeated production failures → increase live smoke test frequency
- A connector requires an architectural exception → the interface may be too narrow
- Any egress block occurs that was not a mistake → review whether the allowlist model is right for
  that provider

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
