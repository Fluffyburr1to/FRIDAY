# ADR-0012 — Every standing grant must expire

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 19](../01-bible/19-approval-system.md)

## Context

Article III contains its own escape clause: approval is required *"unless the user has intentionally
granted permission in advance."* That clause is what makes strict approval livable — without it,
FRIDAY would ask about everything and the owner would begin rubber-stamping.

It is also the mechanism most likely to hollow out the entire approval system if designed carelessly.

The failure mode this ADR prevents is specific and quiet: **a permission granted once and never
reviewed is how "the user is in command" becomes false over three years, without any single decision
making it so.**

## Decision

**Every standing grant has a mandatory expiry.** There is no perpetual grant, and the schema makes
`expiresAt` non-nullable so one cannot be created by mistake.

Maximums by risk class: `medium` 90 days, `high` 30 days. **`critical` can never be fully satisfied
by a standing grant** — a grant may narrow the question, but the action still requires live,
biometrically-confirmed approval.

Four supporting rules: no grant may wildcard both action and resource; every use is recorded and
visible; creating a grant is itself a `high`-risk action requiring step-up authentication; and
**expiring grants are reviewed, not auto-renewed** — FRIDAY reports usage and asks.

## Constitutional review

- **Article III (Approval):** implements the escape clause without letting it swallow the rule.
- **Article I (The User):** renewal is an informed decision by the user, with real usage data.
- **Article II (Transparency):** a pre-approved action is still an observable action.

## Alternatives considered

### Perpetual grants that can be revoked
**Advantages.** Least friction; grant once and forget.
**Why rejected.** Revocation requires the user to notice something is wrong. Expiry requires the
user to notice something is *right*. The second is a far better default for authority.

### Automatic renewal on expiry
**Advantages.** Keeps friction low while nominally bounded.
**Why rejected.** Would quietly convert every temporary grant into a permanent one within a year,
which is the same outcome as perpetual grants with extra bookkeeping.

### Trust levels that widen grants as FRIDAY proves reliable
**Why rejected.** See ADR-0005 — the system would be expanding its own authority.

### No standing grants at all
**Advantages.** The strictest possible reading of Article III.
**Why rejected.** Would produce approval fatigue (risk R4), which hollows out oversight while
appearing to preserve it. Worse than a bounded grant.

## Consequences

**Positive**
- Authority cannot silently accumulate.
- Renewal reviews carry usage data — "used 23 times, saved ~40 interruptions" — so the decision is
  informed rather than reflexive.

**Negative**
- Periodic review work for the owner. Batched and brief.
- A grant may lapse at an inconvenient moment; expiry warnings arrive 7 days ahead.

## Reversibility

- **Cost to reverse:** low technically. Reversing forfeits the protection entirely, so it should be
  treated as a constitutional change requiring a new ADR.

## Review triggers

- Standing grants cover more than ~50% of medium-risk actions → the risk table may be miscalibrated
- Renewal reviews are consistently approved without reading → the same rubber-stamp failure, moved
- Approvals per day exceeds ~10 sustained despite grants
