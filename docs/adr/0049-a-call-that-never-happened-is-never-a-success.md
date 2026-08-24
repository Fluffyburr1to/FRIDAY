# ADR-0049 — A call that never happened is never a success

- **Status:** accepted
- **Date:** 2026-08-24
- **Accepted:** 2026-08-24
- **Deciders:** Tyler Hutson
- **Supersedes:** none
- **Related:** [Chapter 14](../01-bible/14-connector-framework.md) · [Chapter 23](../01-bible/23-diagnostics-system.md) · PR #76 · PR #81 · PR #87

---

## Context

The connector reliability controls — the egress boundary, the rate limiter, the retry rule, and the
circuit breaker — were each built and tested on their own, and each passed its own tests. Composing
them in [PR #87](https://github.com/Fluffyburr1to/FRIDAY/pull/87) exposed **three faults that no
amount of testing the pieces individually would have found**, because every one of them lived in the
seams.

They are recorded here rather than only in the commits that fixed them, because each was a
consequence of the same missing rule and the same rule would prevent all three coming back.

### The three faults

**1. The circuit wedged itself permanently after a single outage.** The breaker was consulted once
per retry *attempt*. In half-open it deliberately allows exactly one probe — so the first attempt
reserved it, and the retry immediately behind it was refused by that same reservation. No outcome
was ever recorded, the probe was never handed back, and the circuit stayed half-open forever. **One
outage would have disabled a connector permanently, with nothing saying so.**

**2. A throttled retry discarded a failure already observed.** When the provider failed and FRIDAY's
own rate limiter then refused the retry, the call ended as *refused* and the provider's failure was
dropped. A genuinely broken service could look quiet.

**3. A request refused at FRIDAY's own boundary was recorded as a provider success.** A blocked host
produced no provider failure, so the code fell through to recording success — which **resets the
consecutive-failure count.** Four real outages followed by one wrong address in a manifest looked
like a service in perfect health.

### What they have in common

All three are the same mistake: **treating the absence of an observed failure as evidence of
success.** A call that was refused, throttled, or never sent tells us *nothing* about the provider,
and the code had no way to say "nothing" — only "worked" or "failed".

**None was found by review, and none by the passing test suite.** All three were found by mutation
testing: deliberately breaking a behaviour and discovering the tests still passed.

---

## Decision

We will hold four invariants across the connector reliability path, and test each of them directly
rather than as a side effect of other behaviour.

### 1. The controls run in one order, and the order is load-bearing

**Circuit breaker → rate limiter → egress boundary → retry.**

The breaker is first so a service that is down costs nothing — not a token from the bucket, not a
DNS lookup. If the limiter ran first, an outage would drain the bucket and leave FRIDAY throttling
herself once the service came back.

### 2. A call that never reached the provider is never recorded as a provider success

★ **The rule the three faults all violated.** A refusal at our own boundary, a call stopped by our
own limiter, and a call abandoned before it was sent are each *neither* a success nor a failure of
the provider. Recording any of them as a success resets the failure count and erases real evidence.

### 3. Every allowed call resolves its circuit-breaker probe, exactly once

Consulting the breaker reserves something in half-open, and **whatever reserves it must give it
back.** Three explicit resolutions exist and one of them always happens: recorded a success,
recorded a failure, or handed back undecided.

The third is a first-class operation rather than an accident of retry behaviour. Both alternatives
to it are wrong: keeping the probe wedges the circuit forever, and recording a success closes it on
the strength of a request that did not happen.

### 4. FRIDAY's own refusals are never attributed to the provider

A blocked host, an unparseable URL, a throttle, or a connector crash are FRIDAY's, not the
provider's. They are reported as `refused` rather than `failed`, they never count against the
circuit, and they never appear as an outage.

---

## Constitutional review

- **Article II (Transparency):** served. `refused` and `failed` stay distinct so the dashboard
  cannot present FRIDAY's own safety controls as somebody else's outage.
- **Article VII (Reliability — failures should be predictable):** the point of the whole ADR.
  Invariant 3 in particular is what makes recovery possible at all.
- **Chapter 23:** *"a component that has not reported recently is `unknown`, not `healthy`."*
  Invariant 2 is that principle applied to a single call rather than to a component.

**The five questions:**

- [x] **Can the user see it?** A degraded connector is an event; the attribution rule keeps it
      pointed at the right party.
- [x] **Can the user stop it?** Not applicable.
- [x] **Can we replace it?** These are rules about composition, not a technology.
- [x] **Can we explain it?** *"She did not call them, so she cannot tell you whether they are up."*
- [x] **Will this still be right in five years?** Yes. The failure mode is intrinsic to composing
      controls that can each refuse independently.

**Notes:** Invariant 2 is the general form; the other three are consequences of it worth stating
separately because each was violated in its own way.

---

## Alternatives considered

### A. Fix the three bugs and leave it at that

**What it is.** The commits already exist. No ADR.

**Advantages.** Less ceremony. The code is correct either way.

**Why rejected.** The three faults were independent symptoms of one missing rule, and a future
control — a bulkhead, a concurrency limit, a budget guard — will sit in the same seam and be written
by someone who never saw these. **A fix teaches nobody; a rule does.**

### B. Enforce the probe lifecycle structurally with a token

**What it is.** `attempt()` returns a handle that must be resolved, so failing to resolve is a type
error rather than a bug.

**Advantages.** The invariant becomes unforgeable rather than tested.

**Why rejected — for now, and this is the one worth revisiting.** TypeScript cannot enforce that a
value is consumed, so the "must" would still be a convention with extra machinery around it. The
runtime has exactly one caller of `attempt()`, and a test asserts every exit path resolves. If a
second caller ever appears, this becomes the right answer.

### C. Let a refusal count against the circuit

**What it is.** Simpler: anything that did not succeed counts.

**Advantages.** One code path. No attribution rule to get wrong.

**Why rejected.** It is fault 3, adopted deliberately. A manifest with a wrong hostname would open
the circuit against a provider that is perfectly healthy, and the owner would go and read somebody
else's status page.

---

## Consequences

**Positive**

- A connector can recover from an outage. Before invariant 3, one outage was terminal.
- Evidence of real failures survives our own refusals.
- A diagnostic points at the party actually responsible.

**Negative**

- **Three outcomes instead of two, everywhere.** Every future control in this path must decide which
  of the three it produces, and "neither" is the one people forget — which is precisely how these
  bugs happened.
- The runtime is harder to read than a straight-line call. It was split into an attempt loop and its
  bookkeeping to keep it under the complexity limit, and that split is itself a thing to maintain.

**Neutral**

- No behaviour change from this document. It ratifies what PR #87 shipped.

---

## Reversibility

- **Cost to reverse:** low for the rules, **high for the consequences.** Undoing invariant 3
  reintroduces a permanent wedge that presents as silence.
- **How:** the invariants are enforced by tests, not by types. Deleting the tests would allow drift.
- **Point of no return:** none, but the failures these prevent are all silent, which makes drift
  here unusually expensive to detect.

---

## Review triggers

- **A second caller of `CircuitBreaker.attempt()` appears** — adopt alternative B.
- **A new control joins the path** (bulkhead, concurrency cap, budget guard) — it must state which
  of the three outcomes it produces before it merges.
- **Any connector is observed stuck** in a non-closed circuit with no traffic — invariant 3 has been
  violated again.
- **A `connector.degraded` event names a provider that was healthy** — invariant 4 has been
  violated.

---

## Notes

**What this ADR does not claim.** That the composition is now correct. It claims that these four
properties hold and are tested. The composition has never run against a real provider, and Chapter
14's answer to that — nightly live smoke tests outside the merge path — does not exist yet.

**Method worth recording.** All three faults were found by mutation testing, and two of them only
after the first repair attempt: the initial assertions could not tell a returned probe from a held
one, because asserting on circuit *state* passes either way. Only a call that actually goes out
distinguishes them. **A test that cannot fail for the right reason is not evidence.**
