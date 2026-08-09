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
consumer that only settles approvals therefore needs no Guardian at all, and the two halves stay
separable for whatever composes them next.

**As of M3 Slice 3A, `apps/core` composes both**, so it does build a policy engine and a capability
signer. That is a change from what this file said when the split was designed — the prediction was
that the settling consumer would never need a Guardian, and the first production composition root
turned out to be the same process.

The split still earns its place, and now carries a sharper rule: `ApprovalClerk` is what
`CoreContext` hands to tRPC procedures, and `AuthorizingClerk` is kept off it deliberately, because
a procedure that could authorize is a procedure that decides when FRIDAY acts.

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

## Every ending is recorded

There is no path here that settles an approval without writing the event that says so. All three
endings — granted, declined, expired — go through the same transaction, and expiry arrives by two
routes that both record it:

- the sweep, which lapses everything past its deadline, each in its own transaction;
- answering *after* the deadline, which lapses the request on the way to refusing the answer.

An expiry that could not be recorded did not happen: the state change rolls back with its event, the
request stays pending, and the next sweep finds it. That is resumption falling out of durable state,
not a retry.

`cancelled` has no event because nothing in FRIDAY produces that status yet. If something ever does,
`eventTypeFor` throws rather than filing it under the wrong ending.

Reference: [ADR-0031](../../docs/adr/0031-the-clerk-records-what-the-guardian-decided.md) ·
[ADR-0032](../../docs/adr/0032-the-guardians-state-moves-into-the-event-log-database.md) ·
[Chapter 19](../../docs/01-bible/19-approval-system.md)
