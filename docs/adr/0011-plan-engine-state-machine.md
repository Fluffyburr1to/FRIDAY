# ADR-0011 — The Chief of Staff is a durable state machine, not a loop

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 12](../01-bible/12-chief-of-staff.md)

## Context

The tempting design — and the one every agent framework encourages — is to give a powerful model a
goal and let it loop: think, act, observe, repeat. It is easy to build and demos beautifully.

## Decision

**Planning is a bounded AI operation producing a validated data structure. Execution is a
deterministic state machine over that structure.**

A plan is a row in the database with a state machine attached — not a running function. Plans are
capped at 20 steps and depth 3; larger work decomposes into reviewable sub-plans.

**Risk is assigned by the Guardian, never by the planner.** The planner proposes actions; the
Guardian classifies them from a static table.

## Constitutional review

- **Article II (Transparency):** the plan exists as inspectable data *before* it runs. You cannot
  meaningfully approve step 7 of something that had no steps until it happened.
- **Article III (Approval):** a plan can sit in `awaiting_approval` for days at zero cost. A running
  loop holding an expensive context cannot.
- **Principle 7 (Explainability):** structured steps produce a structured record.

The Guardian-assigns-risk rule is small and load-bearing: if the planner assigned risk, a confused
or manipulated model could mark a money transfer as low risk. It cannot, because it is not asked.

## Alternatives considered

### ReAct loop (the standard agent pattern)
**Advantages.** Simple, flexible, handles surprises well, and is what every framework provides.
**Why rejected.** No inspectable plan before execution, no durable pause for approval, no structured
record for explanation, and no natural bound — a confused loop keeps looping until a budget stops
it. **What we borrowed:** within a *single step*, an agent may use a bounded tool loop. The loop
lives at the leaf, where it is cheap and contained, not at the top where it would be unobservable.

### Multi-agent debate / hierarchical teams
**Advantages.** Better results on genuinely hard problems.
**Why rejected as primary.** Several times the cost, much longer, and reasoning that is harder to
explain honestly. **Retained for high-stakes cases** — an adversarial critic reviews FRIDAY's own
code changes at M6.

### A workflow engine (Temporal, Restate, Inngest)
**Advantages.** Durable execution solved properly by specialists. Temporal would give us durable
plans essentially for free, and it is excellent software.
**Why rejected.** Requires a server, its own database, and meaningful operational complexity — a
large addition to something meant to run on a laptop — and becomes a foundational dependency that
is hard to remove. Our durability requirement is genuinely modest: a few hundred plans a day, one
user, served by a state machine over a table in a few hundred lines we fully understand.
**This is the strongest alternative in the Bible and it is explicitly flagged for reconsideration.**

### Rule-based planning with no AI
**Why rejected as primary.** Cannot handle novel requests, which is most of FRIDAY's value.
**Adopted as a fast path** for recognized recurring intents, using cached previously-approved plan
templates — cheaper, faster, more predictable.

## Consequences

**Positive**
- Plans survive restarts and can wait days for approval.
- The step DAG allows safe concurrency for independent steps.
- Failure behavior is declared per step at planning time rather than improvised.

**Negative**
- Less adaptive than a loop; a plan built on a wrong assumption may need replanning.
- A planning model call adds 1–3 s before any work begins. Mitigated by the rule-based fast path.
- We are hand-building durable execution that a mature tool provides.

## Reversibility

- **Cost to reverse:** medium. The Chief of Staff can be replaced entirely behind the same event
  interface without touching any department — deliberately, since this is the component most likely
  to be improved by advancing model capability.

## Review triggers

- Plan orchestration requires parallel branches with complex compensation → **reconsider Temporal**
- Plans routinely exceed 20 steps
- Replanning occurs in more than 20% of executions
- A newer model class makes continuous-loop agents genuinely inspectable → revisit the core premise
