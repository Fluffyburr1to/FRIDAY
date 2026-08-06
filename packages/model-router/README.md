# @friday/model-router

**The only package permitted to import an AI vendor SDK.**

Milestone: **M3** · Load-bearing: **yes**

## Charter

FRIDAY's core never names an AI vendor. Callers describe what they need — *"strong reasoning, up to
8000 tokens, this data is sensitive"* — and the router selects a provider by policy.

This is Principle 5 ("FRIDAY should never depend on one vendor, one technology, or one AI provider")
implemented as a single chokepoint.

## What lives here

- The capability-based request interface
- Provider adapters: Anthropic, OpenAI, local Ollama
- **Sensitivity routing** — `private`+ requests go to a local model or are refused
- **Budget enforcement** — per invocation, per plan, per day, per month, all fail-closed
- Prompt caching, retry, and fallback logic
- Cost accounting per request, attributed to the plan

## What does NOT

- Prompts (those live with their agents) or any reasoning about *what* to ask

## Absolute rules

1. **`@anthropic-ai/*`, `openai`, and equivalents are deny-listed everywhere else.** Enforced by
   `dependency-cruiser`.
2. **The router fails closed on sensitivity.** A `private` request is never downgraded to a cloud
   provider because the local model is unavailable. It refuses.
3. **The router fails closed on budget.** Exhausted means stop, never "continue and bill it." A
   runaway overnight loop is the most plausible way to receive a surprise bill an order of magnitude
   over budget.
4. Every invocation is recorded: model, tokens, cost, duration, prompt version.

Reference: [Chapter 02](../../docs/01-bible/02-technology-stack.md)
