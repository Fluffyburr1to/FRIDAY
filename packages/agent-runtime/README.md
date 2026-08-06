# @friday/agent-runtime

**Runs agents in isolation, with no ambient authority.**

Milestone: **M3**

## Charter

Agents are the least trustworthy component in FRIDAY — they run AI-generated behavior over untrusted
content. This package makes it so that an agent **cannot do anything; it can only ask.**

## What lives here

- Worker-thread isolation with a stripped global scope
- Manifest validation and capability enforcement
- Budget ledgers: tokens, money, wall-clock, tool calls
- Mediated tool calls — every request routed to the kernel and the Guardian
- Output validation against the manifest's Zod schema, with one retry on format failure
- Suspension handling (an agent never waits for approval; the plan does)

## What agents do NOT have

`fetch` · `require('fs')` · `require('net')` · `process.env` · child processes · shared memory ·
credentials of any kind

An agent that tries to reach the network gets a `ReferenceError`, not a connection.

## Rules

1. **Agents are stateless.** Every invocation starts fresh. Continuity comes from plans and memory,
   both of which are inspectable data rather than hidden state.
2. **An agent requesting a risk class above its manifest ceiling is terminated**, not merely denied
   — exceeding its declared envelope means it is malfunctioning or has been manipulated.
3. **Worker threads are isolation, not a security sandbox.** Sufficient for first-party and
   AI-written agents. Third-party plugin code gets process isolation instead.

Reference: [Chapter 11](../../docs/01-bible/11-agent-framework.md)
