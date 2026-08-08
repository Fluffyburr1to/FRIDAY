# @friday/clerk

**Records what the Guardian decided. Decides nothing.**

Milestone: **M3** · Load-bearing: **yes**

## Charter

The seam between the component that decides and the log that remembers.

`packages/guardian` answers "may this happen?" and stays a pure, synchronous function of the rules.
`packages/kernel` records events and knows nothing about authorization. Neither claims the job of
writing down what was decided — and for all of Milestone 2, nobody did. Twelve Guardian event types
were defined, phrased, and protected from compaction, and not one of them had ever been written.

This package is that job, and only that job.

## What lives here

- Asking the Guardian and recording the answer as `guardian.decided`
- Raising an approval and recording it as `approval.requested`, caused by the decision's **event**
- Settling an approval and recording it as `approval.granted` or `approval.declined`, caused by the
  request's **event**
- Registering the Guardian's event types on the bus that will carry them

## What does NOT

- **Any authorization decision.** Every rule applied here is applied by `@friday/guardian` — the
  policy engine for whether an action is permitted, the approval registry for whether an *answer* is
  permitted. The clerk chooses which event describes the outcome, and that is transcription.
- **Any risk classification.** It never sees a `PolicySet` and could not compute one.
- **Any reading of the log to decide something.** The store is authoritative for authorization
  state; the log is the history. `@friday/audit` explains, and explaining is not deciding.

## Two entry points, on purpose

| | Needs | Used by |
|---|---|---|
| `createApprovalClerk` | an approval store, a bus | anything that settles approvals |
| `createAuthorizingClerk` | a Guardian, plus the above | anything that authorizes |

The split exists because Chapter 19's rules about an *answer* — has it expired, may this surface
answer it, was step-up proved — live in the approval registry, not in `Guardian.authorize`. A
consumer that only settles approvals therefore needs no Guardian, which is what keeps `apps/core`
from constructing a policy engine, a capability signer, and a keychain entry it never uses.

## Absolute rules

1. **The Guardian stays synchronous and pure.** It is never given a bus. If recording an answer ever
   requires making `authorize` async, the design is wrong, not the Guardian.
2. **An error is not a decision.** When `Guardian.authorize` returns a failure, nothing is recorded.
   A `guardian.decided` written on that path would be a decision nobody made.
3. **`causationId` is an EVENT id.** Never `decisionId`, never `approvalId`. All three are UUIDs, so
   only a test stops them being swapped — and swapping them orphans the whole chain silently.
4. **State and its event commit together.** The state write runs inside the append transaction via
   the hook `EventBus.publish` accepts. If it fails, the event rolls back with it.
5. **No retries, no repair, no reconciliation.** A write that did not happen is reported as not
   having happened.
6. **Guardian event types are registered here and nowhere else.** A process that never composed a
   clerk cannot record an approval, even with the exact type string. That is a safety property, not
   tidiness.

## The one known gap

`sweepExpired` changes state without an event. Expiry emits no `approval.expired` yet — that is the
next slice. It is called out in the code rather than left to be discovered.

Reference: [ADR-0031](../../docs/adr/0031-the-clerk-records-what-the-guardian-decided.md) ·
[ADR-0032](../../docs/adr/0032-the-guardians-state-moves-into-the-event-log-database.md) ·
[Chapter 19](../../docs/01-bible/19-approval-system.md)
