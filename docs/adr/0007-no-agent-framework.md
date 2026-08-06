# ADR-0007 — Build the agent runtime rather than adopt a framework

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 11](../01-bible/11-agent-framework.md), [Bible 12](../01-bible/12-chief-of-staff.md)

## Context

Mature frameworks exist for building AI agents — LangChain, LlamaIndex, AutoGen, CrewAI — offering
agent loops, tool calling, memory, and multi-agent coordination. Adopting one would save weeks.

FRIDAY's requirements are unusual: every action mediated by a policy engine, a tamper-evident audit
trail, durable suspension for human approval, and agents with no ambient authority.

## Decision

We will **build the agent runtime ourselves** — a few hundred lines in `packages/agent-runtime` —
and depend on no agent framework. We will read their designs and take their good ideas.

## Constitutional review

- **Article III / Article V:** these frameworks decide how agents are isolated (usually not at all)
  and how tools are authorized (usually not at all). Adopting one means FRIDAY's safety model
  becomes whatever its authors chose — and none were designed around a constitution requiring human
  approval and an auditable trail.
- **Article VI (Modularity):** a fast-moving framework at the most load-bearing point would be a
  recurring migration tax over a multi-decade horizon.

## Alternatives considered

### LangChain / LlamaIndex
**Advantages.** Enormous functionality; many provider integrations; large community; weeks saved.
**Why rejected.** Broad and shallow — they cover many providers thinly, where FRIDAY needs a few
deeply with budget enforcement and sensitivity routing that none provide. Interfaces break between
minor versions.

### AutoGen / CrewAI (multi-agent orchestration)
**Advantages.** Sophisticated agent collaboration; good results on complex tasks.
**Why rejected as the primary architecture.** Costs several times more per request, takes far
longer, and produces reasoning much harder to explain honestly. "Three agents disagreed and the
supervisor picked one" is not a satisfying answer to "why?" **Retained for high-stakes cases** — an
adversarial critic reviews FRIDAY's code changes at M6.

### Vercel AI SDK
**Advantages.** Well-made, TypeScript-native, good provider abstraction. The closest call.
**Why rejected as the foundation.** Optimized for chat-style streaming UIs rather than autonomous
orchestration with policy enforcement. **We will use it inside the Model Router** as an
implementation detail for providers it covers well — their code, our boundary.

### Agents with direct tool access (the conventional design)
**Why rejected outright.** Makes Article III unenforceable. Every safety guarantee would depend on
every agent behaving correctly, including agents written by assistants and, later, strangers.

## Consequences

**Positive**
- The safety properties the Constitution requires are guaranteed rather than hoped for.
- No migration tax from a fast-moving dependency at the most critical point.
- The runtime is small enough to be understood completely.

**Negative**
- Weeks of initial work we could have skipped.
- We maintain it ourselves, including keeping pace with changing model capabilities.
- We forgo community integrations and must write our own equivalents.

## Reversibility

- **Cost to reverse:** medium. Agents implement a small interface; a framework could sit behind it —
  though doing so would forfeit the guarantees this ADR exists to protect.

## Review triggers

- A framework emerges with genuine capability-based authorization and durable human-approval
  suspension
- Agent runtime maintenance consistently exceeds ~10% of engineering time
- Agent evaluation scores degrade across releases → the framework may be constraining capability
