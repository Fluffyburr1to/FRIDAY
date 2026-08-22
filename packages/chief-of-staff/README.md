# @friday/chief-of-staff

**Turns a goal into an ordered plan, then executes it deterministically.**

Milestone: **M5**

## Charter

> "FRIDAY is the General. **The Chief of Staff coordinates execution.**" — The Manifesto

The central design decision: **this is not an AI agent that runs continuously. It is a state machine
that uses AI for one step.**

The model *makes* the plan. Ordinary deterministic code *executes* it — which is what makes plans
inspectable before they run, pausable for days, and explainable afterward.

## ★ Plan approval is not blanket authorization

**Approving a plan approves the *shape* of the work** — that these steps, in this order, may begin.
It does **not** pre-authorise the actions inside it. Every step still goes to the Guardian on its
own, at the moment it runs.

The distinction has teeth: a plan approved on Monday and resumed on Thursday runs against
**Thursday's** rules, grants, and expiries. If approval pre-authorised, one click would become a
standing grant nobody wrote down and nobody could expire — and Chapter 19 caps how long even a real
standing grant may live.

This is the rule the state machine is arranged around, and the one most likely to be eroded by
someone trying to reduce prompts. Two tests exist purely to fail if it is: *a step inside an
approved plan still suspends*, and *answering one step's question does not answer the next one's*.

## ★ It is not an authority

**Nothing here decides whether an action is permitted.** Risk is assigned by the Guardian and
permission is decided by the Guardian, **per step, at the moment that step runs.**

That holds even for a plan the owner approved as a whole. **Plan-level approval approves the
*shape* of the work, not the actions inside it** — every step still goes to the Guardian on its own,
and the constitutional guarantee that an agent cannot act without the Guardian sits underneath the
whole plan engine rather than beside it. A plan engine that pre-authorised its own steps would be a
second authority path, and there is exactly one.

## What is built, and what is not

**Built:** intent parsing, plan generation, plan validation, deterministic routing, the execution
state machine including plan-level approval and resume, and explanation composition.

**Built:** the executor.

★ **Its Guardian gate is structural, not procedural.** `runCapability` accepts an `Authorised`,
never a step. The only way to obtain one is `authorise()`, which calls the Guardian — and it carries
a private symbol, so it cannot be forged, spread, or built from an object literal.

So *step is ready* cannot reach *capability executes* without a current Guardian decision, **not
because every path remembers to ask, but because no other path can produce the value execution
requires.** A contributor adding a retry path, an error path, or an internal shortcut cannot bypass
it without deliberately calling `authorise` themselves — which is the thing they were trying to skip.

None of these is a shortcut around it:

| | |
|---|---|
| **Plan approval** | Moves the plan to `running`. Authorises no step. |
| **Resume** | Re-authorises from scratch, so it runs under current rules, grants, and expiries. |
| **Routing** | A `Route` says who would act. It is a different type and cannot become an `Authorised`. |
| **A previous answer** | Each `Authorised` is minted for one step, and reuse is refused. |

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
5. **Routing answers *who does this*, never *may this be done*.** It resolves an action to exactly
   one department, refuses an unknown one rather than matching something close, and refuses two
   departments claiming the same action rather than picking. It will happily route an action the
   Guardian denies outright — because the Guardian is what denies it, at the moment the step runs.
6. **A capability's declared `riskClass` is never read to decide anything.** The Guardian classifies
   from the owner's policy table. If the two disagree, the Guardian is right and the department's
   manifest has a documentation bug.

Reference: [Chapter 12](../../docs/01-bible/12-chief-of-staff.md)
