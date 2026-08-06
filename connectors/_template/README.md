# _template — Copy this to create a connector

**Do not modify this folder to build something.** Copy it.

```bash
cp -r connectors/_template connectors/<service>
```

Then, in order:

1. **Write the README first**, and state **exactly what data leaves the machine.** That sentence is
   the connector's real contract with the user.
2. **Fill in `connector.json`:**
   - `egress.hosts` — **enforced.** Undeclared hosts are blocked at the network layer.
   - `egress.dataCategories` — powers the privacy dashboard.
   - `auth.scopes` with **`scopeJustification`** — one sentence per scope. If you cannot write it,
     request a narrower scope.
   - `operations` — each with `riskClass`, `idempotent`, `irreversible`, `reads`, `writes`
   - `rateLimits`, `healthCheck`, `supportsDryRun`
3. **Implement the interface**: `initialize` · `health` · `execute` · `dryRun` · `shutdown`
4. **Implement `dryRun` for every write operation.** Not optional. Approving a description is much
   weaker consent than approving the actual artifact.
5. **Record HTTP fixtures**, then run the automatic scrubber before committing. A fixture containing
   a real email body puts personal data in git history forever.
6. **Pass the contract test suite** in `tests/contract/` before opening a PR.

## Reminders

- Import **only** `@friday/connector-sdk` and `@friday/contracts`. The most restrictive rule in the
  repository.
- **Never store or see a long-lived credential.** Request a short-lived scoped token from the
  Credential Broker.
- **Never retry a non-idempotent operation** without an idempotency key.
- Return `Result`, never throw, for expected failures.
- One connector per **service**, not per provider — separate scopes, separate risk, separate
  revocation.

**This template will be written at Milestone 4**, alongside the Google Calendar connector, so it
reflects working code.

Reference: [Chapter 14](../../docs/01-bible/14-connector-framework.md)
