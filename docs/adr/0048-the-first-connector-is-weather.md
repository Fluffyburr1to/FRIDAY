# ADR-0048 — The first connector is weather, not calendar

- **Status:** accepted
- **Date:** 2026-08-24
- **Accepted:** 2026-08-24
- **Deciders:** Tyler Hutson
- **Supersedes:** none — but overrides the roadmap's standing recommendation
- **Related:** [RFC-0002](../rfc/0002-the-first-connector.md) · [Chapter 14](../01-bible/14-connector-framework.md) · [Roadmap M6](../01-bible/39-roadmap.md) · [ADR-0047](0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md)

---

## Context

The connector SDK was built end to end against a service that does not exist: the manifest, the
egress boundary, the lifecycle, rate limiting, retry, the circuit breaker, the conformance suite,
and the credential-broker boundary. Choosing the first *real* service was deliberately deferred
through all of it.

[The roadmap has recommended Google Calendar since ratification](../01-bible/39-roadmap.md):
read-only to start, structurally simple data, well-documented API, immediate daily value, and it
exercises OAuth, the credential broker, rate limiting, and the egress allowlist without risking
anything irreversible.

[RFC-0002](../rfc/0002-the-first-connector.md) proposed exactly that — and then argued against
itself in §1:

> Calendar data is **not** low-sensitivity. Your calendar reveals who you meet, when you are away
> from home, your medical appointments, and who you are interviewing with. "Read-only" bounds what
> FRIDAY can *change*, not what she can *see*.

And a second departure the egress list does not show: answering *"what does my week look like?"*
sends event contents to a model, which is a **second** exit from the machine, to a second party.

**What was not known when the roadmap was written:** that the reasoning for calendar rested on
*reversibility* — nothing can be destroyed — while the actual risk of a first connector is
*disclosure*. Those are different axes, and the roadmap's argument only addressed one of them.

---

## Decision

We will **make weather the first real connector.** Calendar remains a documented and likely
candidate, deferred rather than rejected.

**The reasoning is that reversibility was the wrong test.** Weather exercises the same machinery —
the egress allowlist, rate limiting, retry, the circuit breaker, health checks, the conformance
suite, the whole lifecycle — **without giving FRIDAY visibility into someone's schedule and
relationships on day one.**

A first connector should be *boring*, not merely *undoable*.

---

## Constitutional review

- **Article IV (Privacy — minimize data, minimum necessary disclosure):** the reason for this
  decision. Weather discloses a location; calendar discloses a life.
- **Article V (Security — least privilege):** served. Weather needs a far narrower grant, and for
  some providers no credential at all.
- **Principle 4 (Privacy Is Fundamental):** *"External services should only receive the minimum
  information required."* The minimum required to answer "will I need a coat?" is a coarse
  location. The minimum required to answer "what does my week look like?" is everything.

**The five questions:**

- [x] **Can the user see it?** Every call recorded; the data category declared and itemisable.
- [x] **Can the user stop it?** Weather is read-only and idempotent; nothing to interrupt mid-flight.
- [x] **Can we replace it?** Yes, and more cheaply than calendar — no OAuth grant to unwind.
- [x] **Can we explain it?** *"She asked a weather service what it is like where you are."*
- [x] **Will this still be right in five years?** The ordering will. Calendar arrives later on its
      own merits.

**Notes:** This decision trades **validation coverage** for **exposure**. See below — it is the real
cost and it should not be glossed.

---

## Alternatives considered

### A. Google Calendar, read-only — the roadmap's recommendation

**What it is.** Read-only calendar access as the first connector.

**Advantages.** Genuinely useful from day one. Exercises OAuth and the credential broker
end to end, which weather may not. It is the milestone's own done-when.

**Why rejected.** The privacy surface is far larger than "read-only" suggests, and it is the surface
that matters for a *first* connector — the one written while the plumbing is least proven. If
something is subtly wrong in scope handling, credential lifetime, or what reaches a model, the cost
should be a wrong forecast rather than an exposed calendar. **Deferred, not rejected:** the
reasoning that makes calendar valuable is unchanged.

### B. A keyless weather provider vs. a keyed one

Deliberately **not settled here.** See "Consequences" — the provider choice is a privacy decision in
its own right and comes back separately.

### C. Public transit

**What it is.** Departure boards for a nearby stop.

**Advantages.** Comparable exposure to weather, comparably boring.

**Why rejected.** Not meaningfully safer than weather, and it discloses a location just as weather
does while being less broadly useful. No advantage to justify a different choice.

---

## Consequences

**Positive**

- FRIDAY's first real external integration cannot reveal who the owner meets.
- The exercise is genuine: same allowlist, same limiter, same retry rules, same breaker, same
  conformance suite.
- Some providers need no account at all, which means a first connector that ships with **zero
  credentials in existence**.

**Negative**

- **★ Weather may not exercise OAuth or the credential broker at all.** That was a stated reason for
  choosing calendar, and it is genuinely lost. If a keyless provider is chosen, the broker ships
  built but **unvalidated by any real connector**, and the first true exercise of it moves to
  whichever connector comes second. This is the concrete cost of this decision and it is accepted
  knowingly.
- Less daily value than calendar. Weather is useful; it is not *"a day where you would miss her"*.
- The M6 done-when — *"what does my week look like?"* — is not satisfiable by this connector, so
  either the milestone's done-when changes or calendar arrives before M6 closes.

**Neutral**

- The roadmap's recommendation is superseded rather than wrong. It optimised for reversibility; this
  optimises for disclosure.

---

## Reversibility

- **Cost to reverse:** **low.** Nothing built for weather constrains calendar. The SDK is
  provider-agnostic and the conformance suite is shared.
- **How:** write the calendar manifest, implement the interface, pass the same suite.
- **Point of no return:** none. Deferring calendar costs only the time between.

---

## Review triggers

- **The M6 done-when is reached** without calendar — resolve whether the milestone's own success
  criterion changes or calendar is pulled in before close.
- **A keyless provider is chosen** — the credential broker then has no real consumer, and whether it
  ships unvalidated or waits becomes a live question rather than a footnote.
- **A second connector is proposed** — revisit whether calendar should be it.

---

## Notes

**Still owed, and explicitly not decided here:**

1. **Which weather provider.** Options differ on whether an account is required at all. This
   determines whether any credential exists.
2. **Location precision.** A weather connector's whole privacy question is *how exactly* the owner's
   position is disclosed — exact coordinates, a rounded grid, or a named place. This is a
   privacy-posture decision and comes back as its own package before any provider is contacted.

**No provider has been contacted, no account created, and no credential obtained.**
