# @friday/model-router

**The only package permitted to import an AI vendor SDK.**

Milestone: **M5** · Load-bearing: **yes**

## What is built, and what is not

**Built at M5:** the capability-based request interface, the provider port, sensitivity routing,
the nested fail-closed budget ledger, and a scripted local provider.

**Not built, and deliberately:** Anthropic, OpenAI, and Ollama adapters. M5 is built and
demonstrated against the scripted provider so that none of it waits on a credential or a bill.
**There is no vendor SDK in this package today**, which means rule 1 below is currently enforced by
a deny-list guarding an empty room — and that is the cheapest time to have got it right.

★ **With no local provider installed, a `private` request is refused.** Not queued, not downgraded,
not served by a cloud provider that happens to be configured. See rule 2.

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
