# connectors/ — The Outside World

A connector translates between FRIDAY and **one** external service.

**Connectors are the only components in FRIDAY permitted to make outbound network requests.**
Nothing else has network access. That is the point of this folder: if all traffic leaving your
machine passes through a small number of components following identical rules, privacy and security
become enforceable at one boundary rather than scattered across the system.

---

## Connectors have no judgment

A connector knows *how*, never *when*. It does not decide to send an email; it knows how to send
one. All judgment lives in departments.

This keeps the riskiest component in the system — the one touching external networks and credentials
— simple enough to review completely.

---

## The manifest is a privacy contract with teeth

```
egress: {
  hosts: ["www.googleapis.com"],           ← ENFORCED at the network layer
  dataCategories: ["calendar_events"],     ← powers the privacy dashboard
  transmitsPersonalData: true
}
auth: {
  scopes: ["calendar.readonly"],
  scopeJustification: { ... }              ← one sentence per scope, REQUIRED
}
operations: [
  { id, riskClass, idempotent, irreversible, reads, writes }
]
```

| Declaration | What it actually does |
|---|---|
| **`egress.hosts`** | The HTTP agent refuses any request to a host not listed. An undeclared destination raises `security.egress.blocked` and a diagnostic. This defends against a compromised dependency, a manipulated agent, and simple mistakes — and it costs almost nothing. |
| **`dataCategories`** | Every outbound call is tagged. You can ask "what left my machine this week?" and get a truthful, itemized answer. Article IV becomes auditable rather than promised. |
| **`scopeJustification`** | If you cannot write a sentence explaining why FRIDAY needs a permission, request a narrower one. Reviewed when the connector is added. |
| **`irreversible`** | Flows into the approval screen as the "cannot be undone" line — the single most decision-relevant fact when approving on a phone. |

---

## Rules

| # | Rule | Why |
|---|---|---|
| 1 | **Import only `@friday/connector-sdk` and `@friday/contracts`.** Nothing else. | The most restrictive rule in the repository, deliberately — connectors are the component most likely to be written quickly or by a third party. |
| 2 | **Never store or see a long-lived credential.** Request a short-lived scoped token from the Credential Broker. | A compromised connector leaks a token that expires in minutes. |
| 3 | **Every write operation implements `dryRun`.** | You approve the actual artifact, not a description of it. |
| 4 | **Never retry a non-idempotent operation** without an idempotency key. | This is how you send an email three times. |
| 5 | **Return `Result`, never throw** for expected failures. | A failing external service is normal, not exceptional. |
| 6 | **One connector per service, not per provider.** | Separate connectors mean separate OAuth scopes, separate risk classes, separate revocation. |
| 7 | **Pass the contract test suite before merge.** | Keeps a hastily-written connector from becoming the weak link. |

---

## Anatomy

```
connectors/<service>/
├── README.md          including EXACTLY what data leaves the machine
├── connector.json     the manifest
├── package.json       @friday/conn-<service>
└── src/
    ├── index.ts
    ├── auth.ts        requests tokens; never stores them
    ├── operations/    one file per operation, each declaring its risk class
    └── mappers/       external shapes ↔ FRIDAY contracts
```

---

## Risk tiers

| Tier | Examples | Additional requirements |
|---|---|---|
| **Read-only** | Weather, news | Standard review |
| **Read-write, reversible** | Calendar, notes, tasks | Dry run mandatory; writes ≥ `medium` |
| **Irreversible / high-consequence** | Email send, payments, locks, code push | Dry run mandatory; ≥ `high`; **`critical` can never be satisfied by a standing grant alone**; contract tests; owner sign-off on the manifest |

---

## Testing

1. **Unit** — against recorded HTTP fixtures. Fast, deterministic, every commit.
2. **Contract** — the shared conformance suite in `tests/contract/`. Proves the connector honors
   timeouts, retries, circuit breaking, egress blocking, and dry-run semantics.
3. **Live smoke** — nightly, against the real service. **Never in the merge path** — a test that
   fails for external reasons trains you to ignore failures.

**Fixtures are scrubbed of real data automatically before commit.** A fixture containing a real
email body would put personal data in git history permanently.

---

## Roadmap

| Connector | Milestone |
|---|---|
| **google-calendar** (read-only first) | M4 — the first one |
| **github** (scoped to this repository) | M6 |
| gmail, home-assistant, others | M8+ |
| **mcp-adapter** — wraps an MCP server inside FRIDAY's controls | M8 |

Reference: [Chapter 14](../docs/01-bible/14-connector-framework.md).
