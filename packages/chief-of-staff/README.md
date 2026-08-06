# @friday/chief-of-staff

**Turns a goal into an ordered plan, then executes it deterministically.**

Milestone: **M3**

## Charter

> "FRIDAY is the General. **The Chief of Staff coordinates execution.**" — The Manifesto

The central design decision: **this is not an AI agent that runs continuously. It is a state machine
that uses AI for one step.**

The model *makes* the plan. Ordinary deterministic code *executes* it — which is what makes plans
inspectable before they run, pausable for days, and explainable afterward.

## What lives here

- Intent parsing (bounded AI call)
- Plan generation (bounded AI call, schema-validated, max 20 steps / depth 3)
- Capability-based routing to departments (deterministic)
- The execution state machine over the step DAG (deterministic)
- Suspension and resumption across approvals and restarts
- Explanation composition from recorded events (deterministic)

## What does NOT

- Any execution. **The Chief of Staff dispatches; it never acts.** It publishes step-dispatch events
  and observes results. This is what makes it replaceable without touching any department.
- Risk classification. The planner *proposes* actions; the **Guardian** classifies their risk.

## Rules

1. **The planner has no tools.** It receives context and returns a plan. It cannot read, call, or
   act.
2. **Never guess on a consequential step.** Ambiguity in a `high`+ step blocks and asks.
3. **Plans are data, not running functions** — which is why they survive restarts and can wait days.

Reference: [Chapter 12](../../docs/01-bible/12-chief-of-staff.md)
