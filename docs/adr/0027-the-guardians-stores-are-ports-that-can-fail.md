# ADR-0027 — The Guardian's stores are ports that can fail

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 30 — Coding Standards](../01-bible/30-coding-standards.md),
  [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0026 — Capability tokens are signed handles to kernel state](0026-capability-tokens-are-signed-handles-to-kernel-state.md)

---

## Context

The Guardian holds three pieces of state — capabilities, standing grants, and approval requests —
behind interfaces it defines and does not implement. `packages/storage` provides the real
implementations, because it is the only package permitted to open the database.

Those interfaces were first written as `put(x): void` and `get(id): T | undefined`. That was wrong
in a way that only becomes visible once a real database is behind them, which is exactly now.

[Chapter 30](../01-bible/30-coding-standards.md) draws the line precisely: a network call, a
validation, a permission denial, a missing row — all ordinary outcomes, all returning `Result`. A
`throw` is reserved for genuine bugs. A disk that is full, a database locked by another process, or
a file whose permissions changed is an *operational failure*, not a bug. Under the original
signatures the only ways to report one were to throw, or to return normally and pretend it worked.

Both of those are bad here in a specific way. `packages/storage`'s existing repositories already
return `Result`, so an adapter would have to convert — and every conversion of `Result` into `void`
either throws (invisible in the signature, which is the thing `Result` exists to prevent) or
discards the error. Discarding it in this component means a capability that was never written still
looking valid, or an approval the owner answered never being recorded as answered.

There is also a question the original shape could not express at all: **what should the Guardian
answer when it cannot reach its own state?** `deny` is tempting, and wrong — it is a decision, and
the Guardian did not make one. It would be recorded in the audit trail as though the rules had been
consulted.

## Decision

**Every method on the Guardian's three store ports returns `Result<T, FridayError>`, reads
included.** The Guardian propagates a storage failure outward rather than converting it into a
decision.

Concretely:

| | |
|---|---|
| `CapabilityStore`, `GrantStore`, `ApprovalStore` | Every method returns `Result`. |
| `Guardian.authorize` | Already returns `Result`. A storage failure surfaces as the error branch, **never** as `allow`, and never as a recorded `deny`. |
| `CapabilityIssuer.verify` | Its error branch widens from a rejection to `{ kind: 'rejected', reason, error }` or `{ kind: 'unavailable', error }`. |
| `GrantRegistry.find` | Returns `Result<GrantOutcome, FridayError>`. |
| Reads | Return `Result` too, not a bare value. |

The distinction the `verify` split encodes is the one that matters: **"this token is not valid" and
"I could not tell whether this token is valid" are different answers**, and only the first belongs
in a decision record.

A caller that receives the error branch has no decision and therefore cannot proceed. That is
fail-closed, and it is fail-closed *honestly* — nothing is written claiming the rules refused
something they were never consulted about.

## Constitutional review

- **Article III (Approval):** unchanged in force and strengthened in honesty. An action still cannot
  proceed without a decision; the difference is that "no decision was reachable" is now
  distinguishable from "the answer was no".
- **Article II (Transparency):** a decision record now always means the rules were actually
  evaluated. Under the old shape, a `deny` produced by a failed store read would have been
  indistinguishable in the log from a `deny` the owner's rules produced.
- **Article VII (Reliability — failures detected quickly and communicated clearly):** a storage
  failure in the authorization path is now typed, named, and impossible to ignore, because the
  compiler forces the caller to handle the error branch.
- **Principle 10 (Simplicity Wins):** this is the one place the decision is arguable. It adds a
  branch at every store call. Accepted under Consequences.

**The five questions:**

- [x] **Can the user see it?** A storage failure produces a typed error with a plain-language
      message, which the kernel records as a degraded-component event.
- [x] **Can the user stop it?** Fail-closed is preserved: no decision means no action.
- [x] **Can we replace it?** This is precisely what makes the stores replaceable — the port is now
      expressive enough for any implementation, including a remote one.
- [x] **Can we explain it?** "She could not read her own records, so she did nothing and said so."
- [x] **Will this still be right in five years?** Yes. Widening a port later is a breaking change to
      every implementation; doing it before there are two is the cheap moment.

## Alternatives considered

### Keep `void` and let the implementation throw

**What it is.** The SQLite store throws on a failed write. The kernel wraps Guardian calls in a
`try`/`catch`.

**Advantages.** No refactor. `better-sqlite3` throws synchronously anyway, so it is the path of
least resistance. The Guardian's own code stays free of error branches and is easier to read.

**Why rejected.** It contradicts Chapter 30 directly, in the component the chapter's reasoning most
applies to. The specific argument Chapter 30 gives is that an exception is invisible in a signature:
neither the owner nor an assistant reading `store.put(capability)` cold can tell it might throw. In
a component where an unhandled failure means a permission is believed to exist that does not, that
invisibility is the whole problem. It also pushes the obligation onto every future caller to
remember a `try`/`catch` that nothing checks for.

### Keep `void`, and have the implementation swallow failures

**Rejected without qualification.** A silently failed write here means a revoked capability that
still verifies, or an approval the owner declined that is never recorded as declined.

### `Result` on writes only; reads stay bare

**Advantages.** Most of the safety for about half the churn. Reads are the common path, and a failed
read in SQLite is rarer than a failed write.

**Seriously considered.** Rejected because the asymmetry has to be remembered rather than derived,
and because the read path is where the dangerous case actually lives: a capability lookup that
returns `undefined` because the database was unreachable is indistinguishable from one that returns
`undefined` because the token was forged. Those are recorded as different reasons —
`capability_unknown` is close to an alarm — so conflating them would corrupt the audit trail in
precisely the direction that hides an attack.

### Make the ports asynchronous while changing them

**Advantages.** It is the change most likely to be wanted later, and doing two breaking changes at
once is cheaper than doing them in sequence.

**Why rejected.** [ADR-0018](0018-better-sqlite3-as-the-sqlite-driver.md) chose a synchronous
driver deliberately, and an async surface over it would be a promise that is always already
resolved. In the authorization path specifically, an unawaited promise is a security bug rather
than a race, and adding `await` to every call site buys nothing today. Revisit only if a store
implementation ever needs real I/O.

## Consequences

**Positive**

- A storage failure can no longer be mistaken for a decision, in the log or in code.
- `packages/storage`'s repositories satisfy the ports directly. No adapter, and no place for an
  error to be quietly dropped in translation.
- The compiler enforces handling at every call site, which is the enforcement mechanism that
  survives contributors who start cold.

**Negative**

- **More branches in the Guardian**, and each one needs a test to hold 100% coverage. This is real
  cost paid in the package with the strictest coverage requirement.
- `verify`'s two-shaped error is more to hold in the head than a single rejection type. Mitigated by
  the fact that its two shapes correspond to two genuinely different events.
- Reads returning `Result` is verbose where a failure is very unlikely.

**Neutral**

- The in-memory stores gain error branches they will never take. They are test doubles, and their
  job is to have the same shape as the real thing.

## Reversibility

- **Cost to reverse:** medium, and falling. The ports have two implementations today — one in
  memory, one over SQLite — and reversing means changing both plus every call site.
- **Point of no return:** none, but the cheap moment is now, before a third implementation exists.

## Review triggers

- A store implementation needs genuine asynchronous I/O — revisit the async question above.
- A storage failure in the authorization path is ever observed being converted into a `deny`
  anywhere. That is this decision failing, and it is a stop-the-line incident.
- The branch count in the Guardian makes a code path hard to follow. The answer is extracting
  helpers, not narrowing the ports.

## Notes

The tell was writing the SQLite implementation. `packages/storage` returns `Result` everywhere
because Chapter 30 says to, and the adapter needed to satisfy `put(x): void` had nowhere to put the
error. When an interface makes a correct implementation impossible to write, the interface is the
thing that is wrong.
