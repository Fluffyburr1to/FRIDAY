# ADR-0026 — Capability tokens are signed handles to kernel state

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [ADR-0006 — Capability tokens rather than RBAC](0006-capability-based-authorization.md),
  [ADR-0020 — Key material comes from an injected key provider](0020-key-material-comes-from-an-injected-key-provider.md)

---

## Context

[Chapter 17](../01-bible/17-authentication-authorization.md) specifies what a capability token
*contains* — who it was issued to, the plan step it belongs to, one action, one resource,
constraints, an expiry of minutes, and an `HMAC, kernel key` signature. It does not specify what a
token *is* as a value passed between components, and the chapter says two things that pull in
opposite directions.

The token diagram shows the claims and a signature, which describes a **self-contained** token: the
claims travel inside the value, and a holder of the key can verify it without consulting anything.

The rejection of JWTs a few paragraphs later says the opposite: *"Capability tokens are checked
against kernel state and can be revoked instantly."* A self-contained token cannot be revoked
instantly — that is the entire reason JWT revocation is a known weak point, and it is the reason
Chapter 17 gives for rejecting them.

Two constraints the design has to satisfy simultaneously, then. Plus a third that only shows up in
implementation: `constraints: { maxCalls: 5 }` requires counting uses, and a count is state by
definition. A token that carries its own claims cannot enforce its own call budget.

## Decision

A capability token is an **opaque, signed handle**. The value passed around is:

```
fct_v1.<id>.<signature>
```

- `id` — a UUIDv7, the primary key of a row in the capability store.
- `signature` — HMAC-SHA256 over `fct_v1.<id>`, keyed by a capability key obtained from the injected
  key provider ([ADR-0020](0020-key-material-comes-from-an-injected-key-provider.md)), compared in
  constant time.
- **Every claim — actor, plan step, action, resource, constraints, expiry — lives in the store, not
  in the token.** The token carries no information.

Verification, in order, and all of it must pass:

1. The value parses as `fct_v1.<id>.<signature>` and the signature is valid.
2. A record exists for `id`.
3. The record is not revoked.
4. `now` is within `[issuedAt, expiresAt)`.
5. The requested action and resource match the record's action and resource **exactly** — a
   capability is not a pattern.
6. Uses remaining is greater than zero; a successful verification consumes one.

Failing any check returns a typed error naming which one, and never the token value.

## Constitutional review

- **Article V (Security — least privilege):** the token grants nothing by itself. Stealing one gets
  an attacker a string that is useless the moment the record expires, is revoked, or its call budget
  is spent — and useless immediately for any action other than the single one it names.
- **Article I (The User):** instant revocation is the mechanism behind "the user is the highest
  authority." A stop button that takes fifteen minutes to take effect is not a stop button.
- **Article II (Transparency):** because every use is a store write, every use is observable.
  A self-contained token used offline would leave no record at all, which would make the audit trail
  quietly incomplete in exactly the place it matters most.
- **Principle 4:** the signature is defence in depth, not the primary control. It is recorded here
  that the store lookup is the real gate, so nobody later "optimises" the lookup away and leaves
  the signature holding the whole system up.

**The five questions:**

- [x] **Can the user see it?** Issuance and every use are recorded as events; the dashboard's
      forensic layer lists live capabilities.
- [x] **Can the user stop it?** Revocation is a single row update and takes effect on the next
      verification, with no window.
- [x] **Can we replace it?** The token format is versioned in its own prefix (`fct_v1`), so a second
      format can coexist with the first during a migration.
- [x] **Can we explain it?** "A ticket number the kernel looks up, signed so it cannot be guessed."
- [x] **Will this still be right in five years?** Yes for a single-process system. If FRIDAY ever
      spans processes that cannot share the store, this is the decision to revisit — see the review
      triggers.

## Alternatives considered

### Self-contained signed tokens (JWT, PASETO, or a hand-rolled equivalent)

**What it is.** The claims are serialised into the token and signed. Verification is a signature
check and an expiry comparison; nothing is looked up.

**Advantages.** Verification is pure and fast. No storage. No I/O on the hot path. The claims are
inspectable from the token alone, which is genuinely useful when debugging. It is what the Chapter 17
diagram most literally describes.

**Why rejected.** Revocation and call budgets both require state, and both are load-bearing here.
Chapter 17 explicitly rejects JWTs for the revocation reason, so adopting a hand-rolled equivalent
would be taking the rejected trade-off while avoiding the well-audited library — the worst of both.
The performance argument does not apply: Chapter 17 budgets ~1ms for issuance, and a local SQLite
read is far inside that.

### Opaque handle with no signature

**What it is.** The token is just the UUID. Security rests entirely on the store lookup and on the
ID being unguessable.

**Advantages.** Simpler. One less key to manage and rotate. Arguably no weaker — a 128-bit random ID
is not brute-forceable, and an attacker who can read the store already has everything.

**Seriously considered, and close.** Rejected on two grounds. First, Chapter 17 specifies a
signature, and dropping it silently would be exactly the kind of undocumented divergence between the
Bible and the code that [ADR-0024](0024-compaction-and-archival-are-milestone-2.md) was written
about. Second, the signature makes *forgery* and *theft* distinguishable in the audit trail: a
verification failing at the signature check means someone constructed a value, which is a different
incident from someone replaying a real token, and the Guardian records them as different reasons.
That distinction is worth one HMAC.

### Capabilities as in-memory object references, never serialised

**What it is.** The classic object-capability model — a capability is a reference, and holding it
*is* the permission. No strings, no signatures, no store.

**Advantages.** Theoretically the cleanest form of the idea, and unforgeable by construction.

**Why rejected.** It does not survive a process restart, which makes it incompatible with plans that
wait days in `awaiting_approval` ([ADR-0011](0011-plan-engine-state-machine.md)). It also cannot
cross the worker-thread boundary the agent runtime uses at M3 without being serialised — at which
point it is a token again, but one with no revocation story.

## Consequences

**Positive**

- Revocation is immediate and total, including revoking every capability issued to one agent or one
  plan at once.
- `maxCalls` and any future constraint that requires counting are enforceable, because the
  authoritative record is the one being read.
- Every capability use produces a record, so "what did this agent actually do with its permission"
  is answerable from data rather than inference.
- A leaked token in a log line is a dead string once expired, and reveals nothing about what it was
  for even before then.

**Negative**

- **Verification touches storage**, so it can fail for reasons unrelated to authorization — a
  locked database returns an error, not a decision. Callers must treat a verification *error* as a
  denial, and this is easy to get wrong. It is enforced by returning `Result` rather than a boolean,
  so the failure branch cannot be ignored silently.
- **The capability store grows**, one row per issuance, and issuance is per plan step. Expired rows
  need pruning; that lands with the compaction work in this same milestone.
- **A second key to manage.** The capability key comes from the same provider as the field
  encryption key, but rotating it invalidates every live capability. Acceptable — live capabilities
  last minutes — but it must be a deliberate operation rather than a side effect of key rotation.
- Debugging is harder: a token in a log tells you nothing without a store query.

**Neutral**

- The `fct_v1` prefix costs four bytes and buys a versioned migration path.

## Reversibility

- **Cost to reverse:** low. The token is opaque by design, so nothing outside the Guardian depends
  on its structure. Changing the format means changing issuance, verification, and the prefix.
- **Point of no return:** none. Live tokens expire in minutes, so any migration window is minutes
  long.

## Review triggers

- FRIDAY is ever split across processes that cannot share the capability store — the self-contained
  alternative becomes genuinely necessary, not merely faster.
- Capability verification appears in a performance profile as a meaningful cost. It should not; if
  it does, the cause is probably a missing index rather than the design.
- A capability is ever issued to an actor outside FRIDAY's trust boundary, such as a third-party
  plugin at M8. The threat model changes and this decision should be re-examined against it.
- Any capability escalation incident, however minor — already a review trigger in Chapter 17.

## Notes

The tell that settled this was `constraints: { maxCalls: 5 }` in Chapter 17's own diagram. A token
that carries its claims cannot count its own uses, so the chapter's example constraint is only
implementable with state. Once state is required for constraints, it is free for revocation, and the
self-contained design loses its only real advantage.
