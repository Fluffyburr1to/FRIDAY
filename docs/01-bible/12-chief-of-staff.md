# 12 — Chief of Staff Architecture

> **Governing provisions:** Manifesto — The Organization ("FRIDAY is the General. The Chief of Staff
> coordinates execution."), Principle 1 (The User Is Always In Command), Principle 7
> (Explainability), Principle 9 (Fail Gracefully); Constitution Articles I, II, III, VII.

---

## In plain language

Your Manifesto says FRIDAY is the General and the Chief of Staff coordinates execution. This chapter
builds the Chief of Staff.

The job is exactly what the title suggests. You say something like "make sure I'm ready for the
board meeting Thursday." That is a goal, not an instruction — it does not say what to do. The Chief
of Staff is the part of FRIDAY that turns a goal into a sequence of specific steps, decides which
department handles each one, watches them execute, notices when something goes wrong, and reports
back.

The most important design decision in this chapter is this:

> **The Chief of Staff is not an AI agent that runs continuously. It is a state machine that uses
> AI for one specific step.**

This distinction matters enormously, and it is where most "autonomous agent" systems go wrong.

The tempting design — the one every agent framework encourages — is to give a powerful model a goal
and let it loop: think, act, observe, think again, until done. It is easy to build and it demos
beautifully.

It is also the wrong architecture for FRIDAY, for three reasons that come straight from your
founding documents:

- **You cannot see inside a loop.** Article II requires observability. A model looping in its own
  context produces a stream of reasoning that is neither structured nor reliable, and you cannot
  meaningfully approve step 7 of something that had no steps until it happened.
- **A loop cannot pause for three days.** Article III requires approval. A running loop holding an
  expensive context cannot wait for you to get back from a trip.
- **A loop's plan is not inspectable before it runs.** You should be able to see what FRIDAY intends
  to do *before* she does it. That requires the plan to exist as a thing, separately from its
  execution.

So: **the model makes the plan; the state machine executes it.** The plan is written down, shown to
you if it is consequential, and executed by ordinary deterministic code that can be paused,
resumed, retried, and audited.

---

## Recommendation

A **durable plan engine** in `packages/chief-of-staff`, in which planning is a bounded AI operation
producing a validated data structure, and execution is a deterministic state machine over that
structure.

### The five responsibilities

| # | Responsibility | Deterministic or AI |
|---|---|---|
| 1 | **Understand** — turn an utterance into a structured Intent | AI (bounded) |
| 2 | **Plan** — decompose an Intent into ordered, typed Steps | AI (bounded, validated) |
| 3 | **Route** — assign each step to a department and agent | Deterministic (capability lookup) |
| 4 | **Execute** — drive steps through the state machine | Deterministic |
| 5 | **Report** — compose the explanation from recorded events | Deterministic |

Only steps 1 and 2 involve a model, both are single bounded calls with validated output, and
neither can act on anything. Everything with consequences is deterministic code.

### The plan as a data structure

```
Plan
├── id, principal_id, correlation_id
├── intent            the structured interpretation of what you asked
├── rationale         why this decomposition, in plain language
├── status            draft | awaiting_plan_approval | running
│                     | awaiting_approval | completed | failed | cancelled
├── budget            tokens, cents, deadline
├── steps[]
│   ├── sequence, dependsOn[]        ← a DAG, not just a list
│   ├── description                  ← plain language, shown to you
│   ├── action { type, payload }
│   ├── department, agent
│   ├── riskClass
│   ├── onFailure    retry | skip | abort | ask_user | alternate
│   └── status, result, error, attempt, idempotencyKey
└── explanation       composed on completion
```

**`dependsOn` makes the plan a graph, not a list.** Independent steps run concurrently; dependent
ones wait. This is not premature optimization — "prepare me for Thursday's meeting" involves reading
the calendar, finding the documents, and checking related emails, all of which are independent. A
strictly sequential plan would be three times slower for no reason.

**`onFailure` is declared per step, at planning time.** The Chief of Staff decides in advance what
should happen when a step fails, rather than improvising when it does. Article VII asks for
predictable, understandable failure; deciding failure behavior *before* the failure is how you get
it.

---

## The execution state machine

```
                    draft
                      │  plan is created and validated
                      ▼
         ┌── awaiting_plan_approval ──┐        ← only for high-risk plans:
         │   (you review the whole    │          you approve the SHAPE before
         │    plan before it starts)  │          any step runs
         │                            │
         └────────────┬───────────────┘
                      ▼
                   running ◄──────────────────────┐
                      │                           │
        ┌─────────────┼─────────────┐             │
        ▼             ▼             ▼             │
    step ok      step needs     step failed       │
        │        approval           │             │
        │             │             │             │
        │             ▼             ▼             │
        │   awaiting_approval   onFailure:        │
        │      (durable,        retry ────────────┤
        │       days ok)        alternate ────────┤
        │             │         skip ─────────────┤
        │             ▼         ask_user ─────────┤
        │      granted → ───────┘                 │
        │      denied  → abort                    │
        │                                         │
        └──────── more steps? ────────────────────┘
                      │ no
                      ▼
              compose explanation
                      │
                      ▼
                  completed
```

Every transition publishes an event. The plan's current state is a projection of those events,
which means the dashboard's live view is not a separate reporting system — it is the same data.

### Plan-level approval

For high-risk plans, you approve the **plan** before any step runs, not just individual actions.

The reason: a sequence of individually-low-risk steps can be collectively consequential. Reading
your email is low risk. Summarizing it is low risk. Sending the summary somewhere is where it
matters — but by then five steps have already run. Reviewing the shape of the work up front is
qualitatively different from approving its last action.

Plan-level approval is required when the plan contains any `high` or `critical` step, when it
exceeds a cost threshold, or when it touches a resource class you have marked as sensitive.

---

## How planning stays safe

The planning model is the most powerful component in FRIDAY, so it operates under hard constraints:

1. **The planner has no tools.** It receives context and returns a plan. It cannot read anything,
   call anything, or act. It is a pure function from context to structure.
2. **Output is schema-validated.** A plan referencing a nonexistent department, an unavailable
   agent, or an unknown action type is rejected before it exists.
3. **Bounded size.** Maximum 20 steps and depth 3. A plan needing more is decomposed into a parent
   plan with sub-plans, each individually reviewable. This prevents the runaway decomposition
   failure mode where a model generates a hundred-step plan nobody can evaluate.
4. **Risk is assigned by the Guardian, not the planner.** The planner *proposes* actions; the
   Guardian *classifies* their risk from a static policy table. If the planner assigned risk, a
   confused or manipulated model could mark a money transfer as low risk. It cannot, because it is
   not asked.
5. **Every plan is explainable before execution.** The `rationale` field is required and is shown
   to you in the dashboard.

Point 4 is the one to remember. It is a small design detail with a large safety consequence, and it
is the kind of thing that gets lost if not written down.

---

## Handling ambiguity

Real requests are underspecified. "Remind Sarah about the budget" — which Sarah, which budget, by
what channel, when?

The Chief of Staff resolves ambiguity in a strict order, and never guesses on anything
consequential:

| Order | Source | Example |
|---|---|---|
| 1 | Explicit in the request | "email Sarah Chen" |
| 2 | Unambiguous memory | only one Sarah in your contacts |
| 3 | Strong preference pattern | you always email rather than message her |
| 4 | **Ask you** | two Sarahs, or any ambiguity in a `high`+ step |

**Rule: never guess on a consequential step.** For a low-risk step, a reasonable default with a
stated assumption is fine — and the assumption appears in the explanation. For anything
irreversible or high-risk, ambiguity blocks and asks.

This is Principle 1 in practice. Guessing is a small act of taking command.

---

## The Chief of Staff never acts

Worth stating explicitly because it is easy to erode: the Chief of Staff dispatches, it does not
execute. It never calls a connector, never touches the database directly, never sends anything. It
publishes step-dispatch events and observes step-result events.

This keeps a genuinely valuable property: **the Chief of Staff can be replaced entirely without
touching any department or connector.** If in three years there is a fundamentally better planning
architecture, it slots in behind the same event interface. Article VI, applied to the component most
likely to be improved by advancing AI capability.

---

## Alternatives considered

### ReAct loop (the standard agent pattern)

A model in a loop: reason, act, observe, repeat until done.

**Advantages:** simple, flexible, handles surprises well, and is what every framework provides.

**Rejected** for the three reasons in the plain-language section: no inspectable plan before
execution, no durable pause for approval, and no structured record for explanation. It also has no
natural bound — a confused loop keeps looping until a budget stops it.

**What we borrowed:** within a *single step*, an agent may use a bounded tool loop (Chapter 11).
The loop exists at the leaf, where it is cheap and contained, not at the top, where it would be
unobservable.

### Multi-agent debate / hierarchical agent teams

Several agents proposing, critiquing, and converging — the CrewAI and AutoGen model.

**Rejected** as the primary architecture: costs several times more per request, takes far longer,
and produces reasoning that is much harder to explain honestly ("three agents disagreed and the
supervisor picked one" is not a satisfying answer to "why?"). Non-determinism compounds with each
additional agent.

**Retained for specific high-stakes cases**: at Milestone 6, a code change proposed by FRIDAY's
Engineering department is reviewed by a separate critic agent before it becomes a pull request.
Adversarial review is genuinely valuable exactly where the cost of being wrong is high.

### A workflow engine (Temporal, Restate)

**Advantages:** durable execution as a solved problem, done properly, by people who specialize in
it.

**Rejected** for the reasons in [Chapter 05](05-backend-architecture.md) — server dependency,
operational weight, and a foundational dependency that is hard to remove. **This remains the
strongest alternative in the Bible** and is explicitly flagged for reconsideration if plan
orchestration outgrows a simple state machine.

### Rule-based planning (no AI in planning at all)

Predefined workflows triggered by pattern matching.

**Rejected** because it cannot handle novel requests, which is most of FRIDAY's value. **Adopted as
a fast path**: recognized recurring intents skip the planning model entirely and use a cached,
previously-approved plan template. Cheaper, faster, more predictable — and it means the common case
does not pay for a model call. Templates are versioned and shown to you the first time they are
used.

### Letting the planning model also execute

**Rejected** — collapses the separation that makes everything else work.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Planning up front is less adaptive** than a loop. A plan built on a wrong assumption may need replanning. | Accepted — mitigated by `onFailure: alternate` and explicit replanning, both of which are recorded. Predictability is worth more than adaptability here. |
| **A model call before any work begins** adds 1–3 seconds of latency. | Accepted — mitigated by the rule-based fast path for recurring intents. |
| **The 20-step / depth-3 bound will occasionally be limiting.** | Accepted — sub-plans handle genuine complexity, and the bound prevents the much worse failure of unreviewable mega-plans. |
| **Building durable execution ourselves.** | Accepted, with a documented trigger to reconsider Temporal. |
| **Plan-level approval adds friction** on high-risk work. | Accepted — that friction is Article III functioning as intended. |
| **Concurrency in the step DAG adds real complexity.** | Accepted — the latency improvement is large and the concurrency is bounded and explicit. |

---

## Review triggers

- Plans routinely exceed 20 steps → the decomposition strategy or the bound needs rethinking
- Replanning occurs in more than 20% of executions → planning quality is insufficient
- Plan orchestration requires complex compensation logic → reconsider Temporal
- Planning latency exceeds the Chapter 35 budget
- A newer model class makes continuous-loop agents genuinely inspectable → revisit the core premise

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
