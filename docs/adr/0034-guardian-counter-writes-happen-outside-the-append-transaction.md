# ADR-0034 — Guardian counter writes happen outside the append transaction

- **Status:** accepted
- **Date:** 2026-08-08
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 19 — Approval System](../01-bible/19-approval-system.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md),
  [ADR-0012 — Every standing grant must expire](0012-standing-grants-expire.md),
  [ADR-0026 — Capability tokens are signed handles to kernel state](0026-capability-tokens-are-signed-handles-to-kernel-state.md),
  [ADR-0027 — The Guardian's stores are ports that can fail](0027-the-guardians-stores-are-ports-that-can-fail.md),
  [ADR-0031 — The clerk records what the Guardian decided](0031-the-clerk-records-what-the-guardian-decided.md),
  **[ADR-0032 — The Guardian's state moves into `events.db`](0032-the-guardians-state-moves-into-the-event-log-database.md)**

---

## Context

[ADR-0032](0032-the-guardians-state-moves-into-the-event-log-database.md) established that
authoritative Guardian state and the event recording it must commit in **one** `events.db`
transaction, and rejected "store, then publish" — its option A — as *"the worst of the four"*
because it can leave an action authorized with no audit record of the authorization.

**Two writes inside `Guardian.authorize` do exactly that today.** They were not noticed when
ADR-0032 was written, because at that point nothing in production called `authorize` at all, and
they are still unreachable in production. They become reachable the moment capability issuance or
grant creation ships.

Verified against `271fe8d`:

| Claim | Verified at |
|---|---|
| `authorize` is synchronous and takes no bus | [`guardian.ts:62`](../../packages/guardian/src/guardian.ts) |
| Verifying a capability **increments `uses` and writes** | [`capabilities.ts:203-209`](../../packages/guardian/src/capabilities.ts) — `store.replace(used)` |
| Applying a standing grant **increments `uses` and writes** | [`grants.ts:192-194`](../../packages/guardian/src/grants.ts) via [`guardian.ts:311`](../../packages/guardian/src/guardian.ts) — `options.grants.use(...)` |
| Both run *before* the clerk publishes anything | [`authorizing-clerk.ts:96-104`](../../packages/clerk/src/authorizing-clerk.ts) — `guardian.authorize` returns, *then* `recordDecision` publishes |
| Both stores are on the events connection | [`database.ts:114`](../../packages/storage/src/database.ts) |
| Neither write is inside a transaction | `createGuardianStores` prepares plain statements; the only `db.transaction` is [`event-store.ts:146`](../../packages/storage/src/repositories/event-store.ts) |
| Neither path is reachable in production | no capability is ever issued and no grant is ever created — verified by grep for production callers of `issue` and `create` |

So both counters commit in their own autocommit transaction, and the `guardian.decided` event that
describes the decision they were part of commits later, separately. Between the two there is a crash
window.

### Why the writes are there, and why they are not simply wrong

Both have a correct and well-argued reason to happen when they happen, recorded in the code:

> *"A use that could not be counted must not be treated as permitted. A token with a budget of five
> that silently never counts is a token with no budget at all."*
> — [`capabilities.ts:205-207`](../../packages/guardian/src/capabilities.ts)

> *"Counted now rather than after the action runs. An `allow` is FRIDAY saying the action proceeds,
> and a grant whose uses were only counted on success would under-report exactly when something went
> wrong."*
> — [`guardian.ts:307-310`](../../packages/guardian/src/guardian.ts)

Both are right. Counting at decision time is the safe direction for a budget. The defect is not
*when* the counter moves; it is that the counter moves in a transaction the event cannot join.

### The crash window, concretely

This is ADR-0032's option A, in the two places it survived:

**Capability.** `verify` increments `uses` from 4 to 5 on a token capped at 5, and commits. The
publish of `guardian.decided` then fails — the log is unwritable, the disk is full, the process
dies. Observable state: the capability is spent, and there is no record of what spent it. The next
presentation is refused with `capability_exhausted` for an action the audit trail says never
happened.

**Grant.** `grants.use` increments a standing grant's `uses` and commits; the publish fails. The
owner's permission has been consumed with no record of the action it authorized. Under a `maxUses`
cap, the permission is measurably shorter-lived than the log can explain.

In both cases each store is internally consistent, so no reader can detect the divergence — the
property that made option A *"fail silently"* and the reason ADR-0032 rejected it in the direction
that *"cannot be detected by reading either store on its own."*

### What we did not know

That ADR-0032's analysis was complete for the *approval* path and incomplete for the rest of the
Guardian. The ADR reasoned carefully about `store.replace(settled)` on an approval and built the
`deferWrites` mechanism ([`deferred-store.ts:49`](../../packages/clerk/src/deferred-store.ts)) to
pull that write into the transaction. It did not enumerate the other two stores, because the
approval path was the one being implemented and the other two had no callers. The result is a
mechanism that solves the general problem, applied to one of three cases.

## Decision

We will **record that `CapabilityIssuer.verify` and `GrantRegistry.use` perform authoritative state
writes outside the append transaction, that this violates ADR-0032, and that it blocks capability
and grant lifecycle work until it is fixed.**

We will **not fix it in Milestone 3 Slice 3.**

| Rule | |
|---|---|
| **The hazard is documented, not patched.** | Fixing it means changing `packages/guardian`'s store ports or its purity, and that is a design decision deserving its own slice rather than a passing edit inside one about policy loading. |
| **It is unreachable and must stay unreachable.** | No production code may issue a capability or create a standing grant until this is resolved. |
| **This ADR is the gate.** | `capability.issued`, `capability.used`, `capability.revoked`, `grant.created`, `grant.revoked`, `grant.expired`, and `approval.auto_granted` are all blocked on it. |
| **The Guardian stays pure and synchronous in the meantime.** | No interim mitigation that makes `authorize` async, gives it a bus, or has it return "writes to perform later" without a full design. |

### Why it blocks `approval.auto_granted` specifically

The auto-grant path is `decision: 'allow'`, `reason: 'standing_grant_applied'`
([`guardian.ts:314`](../../packages/guardian/src/guardian.ts)), and it is the path that calls
`grants.use`. Its payload
([`guardian-event-types.ts:98`](../../packages/contracts/src/guardian-event-types.ts)) requires
`grantUses` — *"how many times this grant has now been used"* — which is the value the
outside-the-transaction write produced. Emitting that event would put a number in the log that was
committed by a write the event cannot roll back. It would be the most precise possible statement of
the bug.

## Constitutional review

- **Article II (Transparency):** the hazard is a divergence no reader can detect. Recording it is
  the only thing that makes it visible before it can occur.
- **Article III (Consent):** a consumed standing grant with no record of what consumed it is
  consent spent without an account of it.
- **Article VII (Reliability):** ADR-0032 removed a crash window rather than documenting one; this
  ADR documents one it missed, and commits to removing it before the code path opens.

**The five questions:**

- [x] **Can the user see it?** Not today — that is the defect. Nothing is user-visible yet because
      nothing reaches the path.
- [x] **Can the user stop it?** Unchanged. No authorization semantics move.
- [x] **Can we replace it?** N/A — nothing is being built.
- [x] **Can we explain it?** Yes, and the explanation is that this must be fixed before the events
      it would corrupt can be produced.
- [x] **Will this still be right in five years?** The *documentation* is right permanently. The
      *deferral* is right only until capability or grant work begins.

**Notes:** The tension worth stating: writing an ADR that fixes nothing is a way of feeling
responsible without being responsible. The justification is narrow and should be held to — the path
is provably unreachable, the fix requires reopening the purity argument that
[ADR-0031](0031-the-clerk-records-what-the-guardian-decided.md) settled at length, and doing it
inside a slice about policy loading would be the "just one more thing" that the 400-line cap exists
to prevent. If capability or grant work is scheduled and this is still open, that justification has
expired.

## Alternatives considered

### Fix it now, inside Slice 3

**What it is.** Extend the `deferWrites` pattern to the capability and grant stores, so the clerk
carries their writes into the append transaction the way it already carries the approval's.

**Advantages.** The mechanism exists and is proven. It is the obviously correct end state. Fixing a
hazard when you find it is usually right, and "we'll do it later" is how latent faults become
permanent.

**Why rejected.** Not on effort — on sequencing. Slice 3's premise is that nothing in production
composes a Guardian; the fix cannot be validated by anything that runs. It would also require
`createGuardian` to accept deferring stores, which changes the composition contract of the one
package with a 100% coverage requirement, inside a slice whose stated constraint is not to modify
`packages/guardian`. The result would be an untestable change to the most safety-critical package,
justified by a path nothing can reach.

### Make the counters idempotent and reconcile from the log

**What it is.** Let the counters drift, and rebuild them from `capability.used` and
`approval.auto_granted` events.

**Advantages.** No transaction changes. It is ADR-0032's option C, applied narrowly.

**Why rejected.** ADR-0032 already rejected exactly this and gave the reason that still applies:
the store is what the Guardian *reads* to decide, so a stale count can permit an action a correct
count would have refused. For a budget, that is the whole failure. It also makes the counter derived
state, which is a larger change than the fix.

### Leave it undocumented until the work is scheduled

**What it is.** Note it in a milestone list and move on.

**Advantages.** No ADR to maintain.

**Why rejected.** The finding is that a written, accepted ADR's invariant is violated by shipped
code. That belongs in the ADR record, where the next person implementing capability issuance will
look, rather than in a list nobody reads at the moment of writing `store.replace`.

## Consequences

**Positive**

- The blocker is named before it can produce corrupt history, at the only time naming it is free.
- Whoever implements capability or grant issuance finds this first, and finds `deferWrites` named
  as the mechanism that already solves the shape of it.
- ADR-0032's invariant is restated as covering the whole Guardian rather than the approval path.

**Negative**

- **A known defect ships.** It is unreachable, and unreachable is not the same as absent. Someone
  will add a capability issuer without reading this.
- **The deferral has no enforcement.** No test fails if the path becomes reachable. The mitigation
  is that both producers are substantial pieces of work, not one-line changes.
- **An ADR that fixes nothing** sets a precedent for using the ADR record as a to-do list, which is
  not what it is for.

**Neutral**

- No code changes. No behaviour changes.
- `packages/guardian` keeps its purity, its synchronous `Result` contract, and its store ports
  exactly as ADR-0027 defines them.

## Reversibility

- **Cost to reverse:** none — nothing is built. Reversing means fixing the hazard sooner, which is
  strictly better.
- **Point of no return:** the first `capability.used` or `approval.auto_granted` event written to a
  log the owner keeps. From that moment the log contains counter values committed outside the
  transaction that recorded them, and no later fix repairs the already-written history.

## Review triggers

- **Any work on capability issuance, `capability.used`, or `capability.revoked`.** Fix this first.
- **Any work on grant creation, revocation, or `approval.auto_granted`.** Fix this first.
- **The agent runtime lands.** Agents present capabilities on every action, so `verify` becomes the
  hottest path in the system and the window becomes the most-executed unfixed code in FRIDAY.
- **`Guardian.authorize` is proposed to become async**, for any reason. This is one of the arguments
  that would be reopened, and ADR-0031 rejected it for reasons that should be re-read rather than
  re-derived.
- **FRIDAY spans processes.** ADR-0032 already notes the validate-then-publish sequence stops being
  safe cross-process; these counters are the same class of problem and worse, because they are
  writes rather than reads.

## Notes

**How this was found.** By tracing what would actually happen the first time production called
`authorize`, rather than by reading the ADRs and assuming their acceptance criteria described
shipped behaviour. ADR-0032's criteria are all about the approval path and all pass; the capability
and grant paths were never in scope and never checked.

**On "unreachable".** Verified by grep, not by reasoning: `CapabilityIssuer.issue` and
`GrantRegistry.create` have no non-test callers, so no capability token and no standing grant can
exist in a production database. `verify` is additionally guarded by
[`guardian.ts:139`](../../packages/guardian/src/guardian.ts) — a request with no `capability` field
from a non-agent actor never reaches the issuer at all. Milestone 3 Slice 3A's scheduled `schedule`
actor takes precisely that path, which is why it can compose a Guardian and authorize without
touching either counter.

**Uncertainty.** Whether the eventual fix is `deferWrites` extended to two more stores, or a change
to how `authorize` reports state changes it wants made, is genuinely open. The first is smaller and
keeps the Guardian pure; the second is more honest about the fact that `authorize` is not actually
a pure function today, and pretending otherwise is what let this survive review twice.
