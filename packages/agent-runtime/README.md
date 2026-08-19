# @friday/agent-runtime

**Runs agents in isolation, with no ambient authority.**

Milestone: **M5**

## Charter

Agents are the least trustworthy component in FRIDAY — they run AI-generated behaviour over untrusted
content. This package makes it so that an agent **cannot do anything; it can only ask.**

## What is built, and what is not

**Built:** the manifest boundary, the Guardian mediator, the per-invocation spend ledger, the
termination rules, the execution loop, output validation with one retry, resume, and worker-thread
isolation.

★ **The two halves are not interchangeable.** Mediation decides what FRIDAY will do on an agent's
behalf; isolation decides what the agent's own code can touch. Without the second, the mediator
would faithfully refuse to fetch a URL for an agent while nothing stopped the agent calling `fetch`
itself.

## What lives here

- Manifest validation and capability enforcement
- Mediated tool calls — every request routed to the Guardian, never around it
- Budget ledgers: tokens, money, wall-clock, tool calls
- Suspension handling (an agent never waits for approval; the plan does)

## What agents do NOT have

`fetch` · `require('fs')` · `require('net')` · `process.env` · child processes · shared memory ·
credentials of any kind

## Rules

1. **The manifest is checked before the Guardian.** "Is this agent even the kind of thing that does
   this?" is cheaper and more absolute than "may this actor do this?", and a manifest breach must
   not become an ordinary permission question the owner is asked about.
2. **An agent requesting something outside its manifest is terminated**, not merely denied —
   including a risk class above its declared ceiling, and including when the Guardian would have
   asked the owner. Exceeding its own envelope means it is malfunctioning or has been manipulated.
3. **Agents are stateless.** Continuity comes from plans and memory, both inspectable data.
4. **A denied request still costs a tool call.** Counting only permitted ones would let a refused
   agent loop for free.
5. **Worker threads are isolation, not a security sandbox.** Determined malicious code with a V8
   escape could break out. Sufficient for first-party and AI-written agents, where the threat is
   bugs and prompt injection rather than a hostile author. **Not** sufficient for third-party plugin
   code, which gets process isolation instead ([Chapter 15](../../docs/01-bible/15-plugin-system.md)).
6. **An isolated agent runs through the same loop as any other.** Isolation is exposed as a step
   function rather than as a second way to run an agent, so the budget and the mediator are enforced
   by one piece of code — and the constitutional guarantee that the execution boundary obeys the
   ledger covers this path too, rather than a second path existing beside it that nothing checks.
7. **What the worker sends is untrusted input.** Its messages are parsed, never cast. An agent that
   posts something unreadable is terminated for a protocol violation; the mediator only ever sees
   well-formed questions.

Reference: [Chapter 11](../../docs/01-bible/11-agent-framework.md)
