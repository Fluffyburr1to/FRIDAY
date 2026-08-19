# @friday/chief-of-staff

**Turns a goal into an ordered plan, then executes it deterministically.**

Milestone: **M5**

## Charter

> "FRIDAY is the General. **The Chief of Staff coordinates execution.**" — The Manifesto

The central design decision: **this is not an AI agent that runs continuously. It is a state machine
that uses AI for one step.**

The model *makes* the plan. Ordinary deterministic code *executes* it — which is what makes plans
inspectable before they run, pausable for days, and explainable afterward.

## ★ It is not an authority

**Nothing here decides whether an action is permitted.** Risk is assigned by the Guardian and
permission is decided by the Guardian, **per step, at the moment that step runs.**

That holds even for a plan the owner approved as a whole. **Plan-level approval approves the
*shape* of the work, not the actions inside it** — every step still goes to the Guardian on its own,
and the constitutional guarantee that an agent cannot act without the Guardian sits underneath the
whole plan engine rather than beside it. A plan engine that pre-authorised its own steps would be a
second authority path, and there is exactly one.

## What is built, and what is not

**Built:** plan validation — the bounds, the DAG, and what may run now.

**Not yet:** intent parsing, plan generation, deterministic routing, the state machine, plan-level
approval and resume, and explanation composition.

## What lives here

- Intent parsing (bounded AI call)
- Plan generation (bounded AI call, schema-validated, max 20 steps / depth 3)
- Capability-based routing to departments (deterministic)
- The execution state machine over the step DAG (deterministic)
- Suspension and resumption across approvals and restarts
- Explanation composition from recorded events (deterministic)

## What does NOT

- Any execution. **The Chief of Staff dispatches; it never acts.**
- Risk classification. The planner *proposes* actions; the **Guardian** classifies them.

## Rules

1. **The planner has no tools.** It receives context and returns a plan.
2. **Never guess on a consequential step.** Ambiguity in a `high`+ step blocks and asks.
3. **Plans are data, not running functions** — which is why they survive restarts.
4. **Validation is about reviewability and termination, never about permission.** A twenty-step
   bound keeps a plan the owner can actually read; a cycle check keeps the executor terminating.
   Neither is a security decision.

Reference: [Chapter 12](../../docs/01-bible/12-chief-of-staff.md)
