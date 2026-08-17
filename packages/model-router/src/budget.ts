import { err, type FridayError, fridayError, ok } from '@friday/contracts'
import type { BudgetLedger } from './router.js'

/**
 * Nested budgets, every level failing closed.
 *
 * ★ **This is the defence against the single most plausible expensive failure
 * in FRIDAY**: an agent loop calling a model thousands of times overnight.
 * Against a $50–200 budget, one unbounded run could exceed a month by an order
 * of magnitude, and it would happen while everyone is asleep.
 *
 * Chapter 11: budgets nest — invocation ⊂ plan ⊂ day ⊂ month — and **every
 * level fails closed.** Exhausted means stop. Never "continue and bill it",
 * never "warn and proceed", and there is no override, because an override is
 * the thing a runaway loop would find.
 *
 * The check happens *before* the call, against an estimated ceiling. Checking
 * afterwards would make a budget a report of what was already spent.
 *
 * Reference: docs/01-bible/11-agent-framework.md · docs/01-bible/35-performance-goals.md
 */

/** One ceiling and what has gone against it. */
export interface BudgetLevel {
  readonly name: 'invocation' | 'plan' | 'day' | 'month'
  readonly limitCents: number
  spentCents: number
}

export interface NestedBudgetOptions {
  /** Ordered narrowest to widest. Every one is checked; the first to refuse wins. */
  readonly levels: readonly BudgetLevel[]
}

/**
 * Creates a ledger over nested ceilings.
 *
 * @param options - The levels, narrowest first.
 * @returns A ledger that refuses before spending rather than after.
 */
export function createNestedBudget(options: NestedBudgetOptions): BudgetLedger {
  const { levels } = options

  return {
    check(estimateCents) {
      if (estimateCents < 0) {
        return err(
          fridayError({
            code: 'VALIDATION_FAILED',
            message: 'A negative cost estimate would make a budget grow by spending.',
            detail: { estimateCents },
          }),
        )
      }

      for (const level of levels) {
        if (level.spentCents + estimateCents > level.limitCents) {
          return err(exhausted(level, estimateCents))
        }
      }

      return ok(undefined)
    },

    record(costCents) {
      // ★ Recorded against every level, including one the estimate cleared and
      // the actual overran. A level can therefore end up over its limit, and
      // that is correct: the next `check` refuses. The alternative — clamping
      // — would lose the record of how much was actually spent, which is the
      // number the owner needs when asking why the budget ran out.
      for (const level of levels) {
        level.spentCents += costCents
      }
    },
  }
}

/**
 * The refusal.
 *
 * Names the level, in the owner's terms, because "the budget is exhausted" is
 * not actionable and "you have spent this month's allowance" is.
 */
function exhausted(level: BudgetLevel, estimateCents: number): FridayError {
  const remaining = Math.max(0, level.limitCents - level.spentCents)

  return fridayError({
    code: 'BUDGET_EXHAUSTED',
    message:
      `FRIDAY stopped rather than spend more. This would cost about ${format(estimateCents)} ` +
      `and the ${level.name} allowance has ${format(remaining)} left of ${format(level.limitCents)}.`,
    detail: {
      level: level.name,
      limitCents: level.limitCents,
      spentCents: level.spentCents,
      estimateCents,
    },
  })
}

function format(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
