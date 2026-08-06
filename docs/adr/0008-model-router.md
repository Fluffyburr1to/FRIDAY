# ADR-0008 — Vendor-neutral Model Router; no AI vendor named in the core

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 02](../01-bible/02-technology-stack.md), [Bible 11](../01-bible/11-agent-framework.md)

## Context

Principle 5 states it directly: *"FRIDAY should never depend on one vendor, one technology, or one
AI provider."*

Beyond the principle, three practical forces: models change faster than anything else in the stack;
Article IV requires routing by sensitivity; and a $50–200/month budget requires a spending chokepoint.

## Decision

All AI model access goes through **`packages/model-router`**, which exposes capability-based
requests — "strong reasoning, up to 8000 tokens, under 5 seconds, this data is sensitive" — and
selects a provider by policy.

**No other package may import an AI vendor SDK.** Enforced by dependency-cruiser with an explicit
deny-list.

The router **fails closed** on both sensitivity and budget: a `private` request is refused rather
than downgraded to a cloud provider, and an exhausted budget stops work rather than continuing to
spend.

## Constitutional review

- **Principle 5 (Modularity Creates Freedom):** a vendor becomes a configuration line rather than a
  dependency baked into a thousand files.
- **Article IV (Privacy):** sensitivity routing is the mechanism that makes "prefer local
  processing" real. It cannot exist if agents call vendors directly.

## Alternatives considered

### Calling vendor SDKs directly
**Advantages.** Simplest; fastest to write; full access to vendor-specific features.
**Why rejected.** A direct violation of Principle 5 and a guaranteed future rewrite. Also makes
sensitivity routing and budget enforcement impossible.

### LangChain / LlamaIndex as the abstraction
**Why rejected.** See ADR-0007. Broad and shallow, and their abstraction is not ours to control.

### OpenRouter (a hosted routing service)
**Advantages.** Genuinely useful; one API for many models; no abstraction to maintain.
**Why rejected as primary.** Inserts a third party into every AI request, which Article IV
disfavors, and becomes exactly the single dependency Principle 5 forbids. **Supported as one
provider among several** inside our router.

### Vercel AI SDK as the whole solution
**Advantages.** Good provider abstraction, TypeScript-native, actively maintained.
**Why rejected as the boundary.** No budget enforcement and no sensitivity routing — the two
properties that matter most here. Used *inside* the router where it fits.

## Consequences

**Positive**
- Swapping providers is a configuration change.
- One chokepoint enforces the spending ceiling. A runaway overnight agent loop is the most plausible
  route to a bill an order of magnitude over budget; this is the defense.
- Sensitive content provably never reaches a cloud provider.

**Negative**
- A lowest-common-denominator abstraction: a vendor's unique feature is wrapped generically or
  unavailable. Accepted — vendor-specific features are precisely the lock-in Principle 5 warns about.
- We maintain it. It is a few hundred lines and the most strategically important few hundred in the
  system.

## Reversibility

- **Cost to reverse:** low to remove (though doing so would violate Principle 5); low to add or
  swap a provider.

## Review triggers

- Monthly AI spend exceeds $150 for two consecutive months
- A provider changes pricing or terms materially
- Local model quality reaches cloud parity → shift the default routing
