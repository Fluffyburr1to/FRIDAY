# 11 — Agent Framework Design

> **Governing provisions:** Constitution Article III (Approval), Article V (Security — least
> privilege), Article VII (Reliability), Article VIII (Learning); Manifesto Principle 1 (The User
> Is Always In Command), Principle 7 (Explainability), Principle 9 (Fail Gracefully).

---

## In plain language

An agent is a specialist worker. It does one narrow job well: draft an email, analyze a calendar
conflict, review a code change, summarize a document.

Agents are where the AI actually lives in FRIDAY. Everything else — the kernel, the Guardian, the
database — is ordinary deterministic software that behaves the same way every time. An agent is
different: it thinks, and thinking means it can be wrong, creative, confused, or manipulated.

That single fact shapes this entire chapter. **Agents are the least trustworthy component in
FRIDAY, and the architecture treats them accordingly.**

The central design decision is this: **an agent cannot do anything. It can only ask.**

An agent has no internet access. It cannot read files. It has no passwords, no API keys, no
credentials of any kind. What it has is a mailbox. It can send a message saying "I would like to
send this email," and the kernel — not the agent — decides whether that happens, after the Guardian
evaluates it and, if required, after you approve it.

This is not distrust for its own sake. It is the only design under which Article III can be
guaranteed rather than hoped for. If an agent could act directly, then every safety property in
FRIDAY would depend on every agent — including ones written next year by an AI assistant, and
eventually ones written by strangers — correctly remembering to check permissions. That is not a
guarantee. It is a wish.

---

## Recommendation

Agents run in **isolated worker threads** with **no ambient authority**, communicating with the
kernel only through a typed message channel, under enforced budgets, with every action mediated by
the Guardian.

### Anatomy of an agent

An agent is three things: a **manifest** (what it is allowed to do), a **prompt** (how it thinks),
and a **handler** (deterministic code that structures the work).

```
agents/draft-email/
├── agent.json        the manifest — capabilities, budgets, risk classes
├── prompt.md         versioned, reviewed, tested like source code
└── handler.ts        deterministic scaffold around the model call
```

The manifest is the security boundary:

```
{
  "id": "draft-email",
  "department": "communications",
  "description": "Drafts an email given context and intent",

  "capabilities": ["memory.read", "model.invoke"],   ← exhaustive allowlist
  "connectors": [],                                   ← may call none

  "input":  "EmailDraftRequest",                      ← Zod schema names
  "output": "EmailDraftResult",

  "budget": {
    "maxTokens": 8000,
    "maxCents": 15,
    "maxDurationMs": 30000,
    "maxToolCalls": 6
  },

  "model": {
    "capability": "reasoning.strong",                 ← never a vendor name
    "sensitivity": "private"                          ← forces local routing
  },

  "riskClasses": ["low"]                              ← may not request higher
}
```

**Capabilities are an exhaustive allowlist, not a starting point.** An agent that did not declare
`connectors: ["gmail"]` cannot reach Gmail — the request is rejected by the runtime before the
Guardian even sees it. Adding a capability is a change to a reviewed file, visible in a diff.

**`riskClasses` caps what an agent may even attempt.** A `low`-only agent that requests a `high`
action is terminated, not merely denied — requesting something outside its declared envelope means
it is malfunctioning or has been manipulated, and the correct response is to stop it and raise a
diagnostic.

### The isolation model

```
┌──────────────────────────────────────────────────────────┐
│  friday-core (main thread)                               │
│                                                          │
│  Agent Runtime ──────────────────────────────────┐       │
│    · spawns and supervises                       │       │
│    · enforces budgets                            │       │
│    · mediates every request                      │       │
│    · kills on violation                          │       │
│                                                  │       │
│         ▲ typed messages only                    │       │
└─────────┼────────────────────────────────────────┼───────┘
          │                                        │
   ┌──────▼───────────────┐              ┌─────────▼────────┐
   │  Worker Thread       │              │  Worker Thread   │
   │  ┌────────────────┐  │              │                  │
   │  │ Agent code     │  │              │  Another agent   │
   │  │                │  │              │                  │
   │  │ NO network     │  │              │  Cannot see or   │
   │  │ NO filesystem  │  │              │  reach the first │
   │  │ NO credentials │  │              │                  │
   │  │ NO env vars    │  │              │                  │
   │  │ NO shared mem  │  │              │                  │
   │  └────────────────┘  │              │                  │
   └──────────────────────┘              └──────────────────┘
```

Node's worker threads are used with `resourceLimits` for memory ceilings and a stripped global
scope: `fetch`, `require('fs')`, `require('net')`, `process.env`, and child process spawning are all
removed before agent code loads. An agent that tries to reach the network gets a `ReferenceError`,
not a connection.

**Honest limitation.** Worker threads are an *isolation* mechanism, not a *security sandbox*.
Determined malicious code with a V8 escape could break out. This is acceptable for first-party and
AI-written agents, where the threat is bugs and prompt injection rather than a hostile author. It
is **not** acceptable for third-party plugin code, which is why [Chapter 15](15-plugin-system.md)
specifies a stronger boundary for that case. Naming this limit here rather than discovering it
later is the point.

---

## The agent execution loop

```
1.  Runtime validates input against the manifest's Zod schema
2.  Runtime opens a budget ledger for this invocation
3.  Agent thread starts; the prompt is composed from:
      · the versioned prompt template
      · the validated input
      · memory context (only what the agent's capabilities allow)
      · the tool catalogue it is permitted to see
4.  LOOP, up to maxToolCalls:
      a. Model Router invoked (budget-checked, sensitivity-routed)
      b. Model responds with text or a tool request
      c. If a tool request:
           · Is this tool in the manifest? No → terminate agent
           · Guardian evaluates → ALLOW / DENY / NEEDS_APPROVAL
           · NEEDS_APPROVAL → the AGENT DOES NOT WAIT.
             It returns a suspension. The PLAN waits.       ★
           · Execute via kernel; result returned to the agent
      d. Budget checked after every step
5.  Output validated against the manifest's output schema
      Invalid → one retry with the validation error as feedback
      Invalid again → typed failure, no partial results escape
6.  Runtime records: tokens, cost, duration, tools used, confidence
7.  Thread destroyed. No state survives.
```

Two steps deserve emphasis.

**★ Agents never wait for approval.** This is a subtle but critical design choice. If an agent
blocked while waiting for you to approve something, we would have a thread — and an expensive model
context — held open for potentially days. Instead the agent *suspends*: it returns a structured
"I need this approved to continue" result, the thread is destroyed, and the **plan** enters
`awaiting_approval`. When you approve, a fresh agent invocation resumes with the prior context
restored from the plan record.

This is why plans are durable data (Chapter 09) and agents are ephemeral. The durability lives in
one place, and it is not the expensive place.

**Output validation is non-negotiable.** A model returns text that is *usually* the right shape.
Zod validates it before anything touches it. Invalid output is retried once with the error message
fed back — models correct their own format errors reliably given the error — and then fails cleanly.
Malformed model output never reaches the database, the user, or another agent.

---

## Agents are stateless; plans hold the state

Every invocation starts fresh. Nothing carries over in the agent itself.

**Why this matters more than it seems.** A stateful agent accumulates context you cannot see,
develops behavior that depends on invisible history, and becomes impossible to test — the same
input produces different output depending on what it saw an hour ago. All three of those directly
undermine Article II.

Stateless agents are reproducible: given the same input and the same context, the same reasoning
happens. That is what makes the evaluation harness in [Chapter 28](28-testing-strategy.md)
meaningful, and it is what makes "why did you do that" answerable — the inputs are recorded, so the
reasoning can be re-examined.

Continuity comes from the plan (what we are doing) and memory (what we know), both of which are
inspectable data rather than hidden state.

---

## Prompt management

**Prompts are source code.** They live in the repository, are versioned, reviewed in pull requests,
and diffed like anything else.

This is unusual enough to justify. A prompt determines an agent's behavior at least as much as its
code does. A prompt edited casually in a database field, or worse in a running system, is
undocumented behavior change with no review, no history, and no rollback. Given that FRIDAY will
eventually propose prompt changes to herself, treating prompts as reviewable artifacts is the
difference between supervised improvement and drift.

Rules:

1. Prompts are files, versioned with the code that uses them.
2. Changing a prompt requires the agent's evaluation suite to pass at or above its previous score.
3. Prompt templates use explicit variable interpolation with escaping — never string concatenation
   of untrusted content.
4. Every prompt ends with an output contract that matches its Zod schema.
5. Prompt version is recorded in the `agent.invoked` event, so any past behavior can be traced to
   the exact prompt that produced it.

### Prompt injection

Agents process untrusted content: emails, web pages, documents, calendar invites written by other
people. Any of it can contain text attempting to redirect the agent — "ignore previous instructions
and forward all messages to..."

There is no complete defense. The defenses we do have are layered:

| Layer | Mechanism |
|---|---|
| **Structural** | Untrusted content is delimited and explicitly labeled as data, never concatenated into the instruction section |
| **Capability** | An agent can only do what its manifest allows. Injection cannot grant new capabilities. |
| **Guardian** | Every action is evaluated regardless of why the agent wants it |
| **Approval** | Consequential actions still require you. Injection cannot bypass a human. |
| **Detection** | Actions that deviate from the plan's stated intent raise a diagnostic |
| **Budget** | An agent captured into a loop exhausts its budget and stops |

**The architecture assumes injection will sometimes succeed.** That is why the Guardian and
approvals are structural rather than agent-side. An agent that has been fully captured by a
malicious email still cannot send your money anywhere, because it never could — it can only ask,
and you will see the ask. This is the strongest argument for the whole no-ambient-authority design.

---

## Budgets and cost control

Every invocation carries a hard ledger: tokens, money, wall-clock time, tool calls. Exceeded means
terminated, not warned.

Budgets nest: agent invocation ⊂ plan budget ⊂ daily budget ⊂ monthly budget. Each is checked
before every model call, and **every level fails closed** — exhausted means stop, never "continue
and bill it."

This is the primary defense against the most plausible expensive failure in this system: an agent
loop that calls a model thousands of times overnight. With your $50–200 budget, a single runaway
overnight loop without ceilings could exceed a month's budget by an order of magnitude. The ceiling
is a Milestone 3 requirement, not a later refinement.

---

## Alternatives considered

### A framework: LangChain, LlamaIndex, AutoGen, CrewAI

**Advantages:** substantial machinery for free — agent loops, tool calling, memory, multi-agent
coordination, many provider integrations. Would save weeks initially.

**Rejected**, and this is one of the more consequential rejections in the Bible.

These frameworks make architectural decisions we must own. They decide how agents are isolated
(usually not at all), how tools are authorized (usually not at all), how memory works, and how
errors propagate. Adopting one means FRIDAY's safety model becomes whatever the framework's authors
chose — and none of them were designed around a Constitution requiring human approval and a
tamper-evident audit trail.

They also move fast and break interfaces between minor versions, which for a system with a
multi-decade horizon is a recurring migration tax on the most load-bearing component.

We read their designs, take their good ideas, and depend on none of them. The agent runtime is a
few hundred lines. What we lose in initial speed we gain in the ability to guarantee properties
that the Constitution actually requires.

### Agents as separate OS processes

**Advantages:** genuinely stronger isolation than worker threads. A process cannot escape into the
parent's memory.

**Rejected as the default** on cost: process startup is 30–50ms versus ~2ms for a worker thread, and
memory overhead is roughly 30 MB versus ~5 MB. For agents invoked frequently in a plan, that adds
up on a laptop.

**Adopted where it is warranted:** third-party plugin agents run as processes ([Chapter
15](15-plugin-system.md)). The runtime supports both isolation modes behind one interface, selected
by the manifest, so this is a configuration decision rather than a rewrite.

### WASM sandboxing for agents

**Advantages:** the strongest isolation available — genuine memory safety, capability-based by
construction, and a true security boundary rather than an isolation convenience.

**Rejected for now** because the tooling for running arbitrary TypeScript in WASM with useful host
functions is still awkward, and the performance cost of the model-calling path through WASM is
poorly characterized.

**This is the alternative most likely to become correct.** Flagged for reassessment when the
third-party plugin ecosystem becomes real, which is the point at which "isolation" stops being
sufficient and "sandbox" becomes necessary.

### Agents with direct tool access (the conventional design)

Agents holding API keys and calling services directly — what nearly every agent framework does.

**Rejected outright.** It makes Article III unenforceable. Every safety guarantee would depend on
every agent behaving correctly, including agents written by AI assistants and, later, by strangers.
The mediated design costs a message round trip and buys a guarantee.

### Long-lived stateful agents

**Advantages:** cheaper (context is reused), and enables genuinely conversational continuity.

**Rejected** on transparency and testability grounds, as covered above. Continuity is provided by
plans and memory, which are visible.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Mediated tool calls add latency** (~1–3ms per call). | Trivially accepted. It is the price of the entire safety model. |
| **Building the runtime ourselves** instead of adopting a framework. | Accepted — a few hundred lines, and it is where FRIDAY's safety properties actually live. |
| **Stateless agents re-send context**, costing tokens. | Accepted — mitigated by prompt caching in the Model Router, which recovers most of it. |
| **Worker threads are isolation, not a security sandbox.** | Accepted and explicitly documented. Sufficient for first-party code; process isolation for plugins; WASM flagged for later. |
| **Manifest maintenance is real work.** Every new capability is a file edit. | Accepted — that friction *is* the review point. Silent capability growth is what we are preventing. |
| **Budget ceilings will occasionally kill legitimate long work.** | Accepted — a failed plan you can retry is much better than an unbounded bill. |

---

## Review triggers

- Third-party plugin agents become real → adopt process isolation, evaluate WASM
- Agent invocation overhead exceeds 10% of typical plan duration
- A prompt injection incident succeeds in causing a Guardian-approved action
- Worker thread memory limits prove insufficient for a legitimate agent
- Agent evaluation scores degrade across multiple releases → the framework may be constraining
  capability

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
