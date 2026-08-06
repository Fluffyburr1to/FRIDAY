# ADR-0005 — The Guardian as the sole authorization point

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 19](../01-bible/19-approval-system.md), [Bible 17](../01-bible/17-authentication-authorization.md)

## Context

Article III requires explicit approval for consequential actions. The question is how to guarantee
that across years, dozens of agents, code written mostly by AI assistants, and eventually
third-party plugins.

"We will remember to check permissions" is how every security incident in history begins.

## Decision

We will build **one component — the Guardian — that every action must pass through**, answering a
single question: may this actor take this action on this resource right now? It returns `ALLOW`,
`DENY`, or `NEEDS_APPROVAL`.

Agents cannot bypass it, because agents have no network access, no filesystem access, and no
credentials. They can only *request* an action from the kernel, which routes every request through
the Guardian.

**No other component may implement authorization.** Guardian policies are owner-only and may never
be modified by FRIDAY.

## Constitutional review

- **Article III (Approval):** implemented as physics rather than etiquette. The code path that
  skips approval does not exist.
- **Article V (Security):** one place enforces least privilege; one place to audit.
- **Principle 1 (The User Is Always In Command):** structurally, not by convention.

- [x] Can the user stop it? — Yes; this component is the mechanism.
- [x] Can we explain it? — Policies are declarative data, so FRIDAY can name the actual rule that
      required approval. Policy scattered as `if` statements could not be enumerated or explained.

## Alternatives considered

### Authorization checks distributed through the codebase
**Advantages.** Conventional; no indirection; each component decides in context.
**Why rejected.** Every safety guarantee would depend on every component — including ones written
next year by an assistant and eventually by strangers — correctly remembering to check. That is not
a guarantee, it is a wish.

### Two authorities (a fast path and a full path)
**Why rejected.** Two authorizers eventually disagree, and the disagreement is a security hole.

### Confidence-based auto-approval
**Advantages.** Less friction; the model often is right.
**Why rejected.** Model confidence is poorly calibrated, and an injected or confused model is often
*highly* confident. Tying authority to self-reported certainty means the failure modes that most
need a human are exactly the ones that would bypass one.

### Trust levels that increase automatically over time
**Advantages.** Matches Principle 3's "trust is earned"; less friction as FRIDAY proves reliable.
**Why rejected.** Trust would be granted by the system to itself, based on its own record. Article I
says the user is the highest authority; a system that expands its own permissions has taken
authority from the user, however gradually. Standing grants achieve the same practical outcome with
the *user* deciding.

## Consequences

**Positive**
- A fully prompt-injected agent still cannot cause harm, because it never had the ability to act.
- One component to test exhaustively — hence the 100% coverage requirement.
- Approval blocks durably; a plan can wait days without holding resources.

**Negative**
- ~2 ms on every action. This number is protected by a performance budget precisely because a slow
  Guardian creates pressure to bypass it, which is how safety architecture erodes.
- Approval friction is real, and managed by reducing volume rather than weakening the requirement.
- 100% test coverage on this package is demanding to write and maintain.

## Reversibility

- **Cost to reverse:** high — and deliberately so.
- **Point of no return:** Milestone 2.

## Review triggers

- Guardian evaluation exceeds its 2 ms p50 budget
- Any of the eight "must never happen" properties in Bible 19 is violated → stop-the-line
- Policy count exceeds ~50 → evaluate Cedar or OPA
