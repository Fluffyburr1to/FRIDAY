import type { AgentBudget, AgentSpend } from '@friday/contracts'

/**
 * What one invocation has used, against what it was given.
 *
 * ★ **Exceeded means terminated, not warned.** Chapter 11 states it and the
 * reason is arithmetic rather than principle: a loop that is warned and
 * continues is still a loop. There is no soft limit here, because a soft limit
 * is a limit that an overnight run passes through at 3am.
 *
 * Four dimensions, and all four are ceilings rather than targets: tokens,
 * money, wall-clock, and mediated tool calls. The last is the bound on the
 * leaf loop — ADR-0011 permits a bounded tool loop inside a single step, and
 * *bounded* is this number.
 *
 * Reference: docs/01-bible/11-agent-framework.md
 */

/** Which ceiling was hit. `undefined` means none of them. */
export type ExceededDimension = 'tokens' | 'cents' | 'duration' | 'toolCalls'

export interface SpendLedger {
  /** What has been consumed so far. */
  readonly spend: AgentSpend

  /** Records a completed tool call and what it cost. */
  record(input: { tokens?: number; cents?: number }): void

  /**
   * Whether any ceiling has been passed.
   *
   * ★ Checked after every step, including the one that would be the last, so
   * a budget cannot be exceeded and then reported as complete.
   *
   * @returns The dimension that is over, or `undefined` when all are inside.
   */
  exceeded(): ExceededDimension | undefined
}

export interface SpendLedgerOptions {
  readonly budget: AgentBudget

  /** Injected so a test can drive the clock rather than sleep through it. */
  readonly now?: () => number
}

/**
 * Opens a ledger for one invocation.
 *
 * @param options - The manifest's budget, and optionally a clock.
 * @returns A ledger that answers whether the invocation may continue.
 */
export function openSpendLedger(options: SpendLedgerOptions): SpendLedger {
  const { budget } = options
  const now = options.now ?? Date.now
  const startedAt = now()

  const spend: AgentSpend = { tokens: 0, cents: 0, durationMs: 0, toolCalls: 0 }

  return {
    spend,

    record(input) {
      spend.tokens += input.tokens ?? 0
      spend.cents += input.cents ?? 0

      // ★ Counted per mediated request, whatever the Guardian answered. A
      // denied call still cost a model round trip to produce, so counting only
      // the permitted ones would let an agent that is being refused loop for
      // free — which is exactly the shape a manipulated agent takes.
      spend.toolCalls += 1
      spend.durationMs = now() - startedAt
    },

    exceeded() {
      spend.durationMs = now() - startedAt

      if (spend.tokens > budget.maxTokens) return 'tokens'
      if (spend.cents > budget.maxCents) return 'cents'
      if (spend.durationMs > budget.maxDurationMs) return 'duration'
      if (spend.toolCalls > budget.maxToolCalls) return 'toolCalls'

      return undefined
    },
  }
}

/** Says which ceiling stopped it, in the owner's terms. */
export function describeExceeded(dimension: ExceededDimension, budget: AgentBudget): string {
  switch (dimension) {
    case 'tokens':
      return `it used more than the ${budget.maxTokens.toLocaleString()} words of thinking it was given`
    case 'cents':
      return `it would have cost more than $${(budget.maxCents / 100).toFixed(2)}`
    case 'duration':
      return `it ran longer than the ${Math.round(budget.maxDurationMs / 1000)} seconds it was given`
    case 'toolCalls':
      return `it asked to do things more than the ${budget.maxToolCalls} times it was allowed`
  }
}
