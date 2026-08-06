# ADR-0006 — Capability tokens rather than role-based access control

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 17](../01-bible/17-authentication-authorization.md), [Bible 11](../01-bible/11-agent-framework.md)

## Context

FRIDAY has roughly one human user and many non-human actors: agents, departments, connectors,
scheduled jobs, and eventually plugins. Authorization for the non-human actors is the hard part.

Agents process untrusted content — emails, documents, web pages — any of which may contain
instructions aimed at them. We must assume prompt injection will sometimes succeed.

## Decision

**Being authenticated grants nothing.** Every action requires a **capability token**: a signed,
short-lived permission naming one action, one resource, and a constraint set, issued for one
specific plan step and expiring in minutes.

Every request passes four independent checks — authentication, capability, policy, risk — and all
must pass.

## Constitutional review

- **Article V (Security — least privilege):** implemented at the narrowest possible point.
- **Article III (Approval):** an agent cannot exceed what its current step required, so injection
  cannot escalate.

- [x] Can we explain it? — Every token issuance and use is recorded with actor, action, and resource.

## Alternatives considered

### Role-based access control (RBAC)
**Advantages.** Familiar, simple, mature tooling, easy to reason about.
**Why rejected.** **Ambient authority.** An actor holding a role holds that role's full power for
its entire lifetime, regardless of what it is currently doing. An agent redirected by prompt
injection would still hold every permission the role granted. RBAC is correct when actors are
trustworthy humans doing varied work; it is wrong when actors are AI agents that can be manipulated.

### OAuth2 with FRIDAY as her own authorization server
**Advantages.** Standard, well-specified, good tooling.
**Why rejected.** Heavy machinery for one user and internal actors. OAuth is used where it belongs —
authenticating *to external services* via connectors.

### JWT-based sessions for internal actors
**Why rejected.** JWTs are designed for stateless distributed verification, irrelevant in a single
process, and their revocation story is poor. Capability tokens are checked against kernel state and
revoke instantly.

### A policy engine (Cedar, OPA/Rego)
**Advantages.** Genuinely better than a hand-rolled engine — formally analyzable, expressive,
verified semantics in Cedar's case.
**Why rejected for now.** Dependency weight against a small, highly FRIDAY-specific policy set. Our
policy format is deliberately declarative so **migrating to Cedar later is a translation, not a
redesign.**

## Consequences

**Positive**
- Ambient authority is eliminated. This is the single strongest defense against prompt injection.
- Capability and policy are independent gates: a bug in issuance cannot bypass policy, and an
  over-broad policy cannot grant an agent something its step did not require.

**Negative**
- ~1 ms per step for issuance and verification.
- More machinery than RBAC, and less familiar to a new contributor.
- Correct issuance is security-critical; mitigated by policy as a second gate and exhaustive testing.

## Reversibility

- **Cost to reverse:** medium-high. Every call site assumes a token.
- **Point of no return:** Milestone 3, once agents exist.

## Review triggers

- Policy count exceeds ~50, or interactions become hard to reason about → evaluate Cedar
- Any capability escalation incident, however minor
- Third-party plugins arrive → review the model for untrusted actors
