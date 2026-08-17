# @friday/agent-runtime

**Runs agents in isolation, with no ambient authority.**

Milestone: **M5**

## Charter

Agents are the least trustworthy component in FRIDAY — they run AI-generated behaviour over untrusted
content. This package makes it so that an agent **cannot do anything; it can only ask.**

## What is built, and what is not

**Built:** the manifest boundary, the Guardian mediator, the per-invocation spend ledger, and the
termination rules.

**Not yet:** worker-thread isolation, the execution loop, output validation, and resume. Each lands
in its own change.

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
5. **Worker threads are isolation, not a security sandbox.** Sufficient for first-party and
   AI-written agents. Third-party plugin code gets process isolation instead.

Reference: [Chapter 11](../../docs/01-bible/11-agent-framework.md)
