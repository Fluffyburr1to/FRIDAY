# @friday/guardian

**The single component that decides whether any action is permitted.**

Milestone: **M2** · Load-bearing: **yes** · **100% test coverage required**

## Charter

Answers exactly one question: *may this actor take this action on this resource right now?*

Returns `ALLOW`, `DENY`, or `NEEDS_APPROVAL`. Nothing else in FRIDAY may make that decision.

This is where Article III lives. Every other safety mechanism in the system exists to make this
component's decisions unavoidable.

## What lives here

- Policy evaluation (declarative rules, not scattered `if` statements)
- Risk classification from a **static** table — never from an AI model
- Capability token issuance and verification
- Approval requests, with mandatory complete explanations
- Standing grants, with **mandatory expiry**
- `policies/` — the rules themselves

## What does NOT

- Anything that *performs* an action. The Guardian decides; the kernel executes.
- Any AI reasoning. Authorization must be deterministic and explainable.

## Absolute rules

1. **No other package implements authorization.** Two authorities eventually disagree, and the
   disagreement is a security hole.
2. **Risk class comes from policy, never from an agent or model.** A manipulated model must not be
   able to classify a wire transfer as harmless.
3. **`critical` can never be fully satisfied by a standing grant.**
4. **Timeout means denied.** Never "assume yes."
5. **`policies/` is owner-only.** FRIDAY may never propose changes to it. A system that can modify
   the rules governing it is not governed.

## Why 100% coverage

An untested branch in the component that decides whether actions are permitted is a branch nobody
has verified — and it will eventually execute.

Reference: [Chapter 19](../../docs/01-bible/19-approval-system.md),
[Chapter 17](../../docs/01-bible/17-authentication-authorization.md)
