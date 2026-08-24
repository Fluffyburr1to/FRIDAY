import type { FridayError } from '@friday/contracts'
import type { AskOutcome, AskSession, ProposedRun } from '@friday/core'
import { openContext } from '@friday/core'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode } from '../output.js'

/**
 * `friday ask` — the way in.
 *
 * ★ **This command builds nothing.** It opens the real context, takes the real
 * session, and prints what comes back. There is no CLI registry, no CLI
 * Guardian, no CLI executor, and no CLI execution path — a second way to act
 * is a second set of rules, and the quieter one always wins.
 *
 * What it does own is the *conversation*: FRIDAY stops when she needs the
 * owner, and this prints the question and the exact command that answers it.
 * That is Article III made ordinary — a plan waits as long as it waits, in the
 * database, and the terminal that started it can be closed.
 *
 *   friday ask "check my records"        propose, show, and run
 *   friday ask --resume <id>             carry on where it stopped
 *   friday ask --resume <id> --approve   answer what she is waiting on
 *   friday ask --why <id>                what happened, from the log
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · apps/cli/README.md
 */

export interface AskOptions {
  readonly context: CommandContext

  /** What the owner said. Absent when resuming or explaining. */
  readonly utterance?: string | undefined

  /** A plan to carry on with. */
  readonly resume?: string | undefined

  /** A plan to explain. */
  readonly why?: string | undefined

  /**
   * Whether this invocation carries the owner's answer.
   *
   * ★ A separate command rather than a prompt, and separate from `--resume`.
   * An approval that could be given by pressing return on a spinner is an
   * approval given without reading — Chapter 19's approval theatre — and the
   * owner typing the word is the smallest honest amount of deliberateness.
   */
  readonly approve?: boolean | undefined
}

/**
 * Runs the ask command.
 *
 * @param options - The context, and what the owner asked for.
 * @returns The process exit code.
 */
export async function runAsk(options: AskOptions): Promise<ExitCode> {
  const { context } = options
  const { out } = context

  // ★ Before anything is opened. "You did not say what you want" needs no
  // database, no signing key, and no departments — and a command that opened
  // all three first would answer a typo with whichever of them was missing.
  // That is how someone ends up debugging their Keychain because they forgot
  // the quotes.
  if (!isAnAsk(options)) {
    out.problem('Tell FRIDAY what you want. For example: friday ask "check my records"')
    return EXIT.usage
  }

  const opened = openContext({ config: context.config, keys: context.keys })

  if (!opened.ok) {
    out.problem(opened.error.message)
    out.json({ problem: opened.error })
    return EXIT.problem
  }

  try {
    // ★ The departments are what she can do. A failure to load them is
    // reported here, in the command that needed them, rather than having
    // stopped her starting at all.
    if (!opened.value.ask.ok) {
      out.problem(opened.value.ask.error.message)
      out.json({ problem: opened.value.ask.error })
      return EXIT.problem
    }

    return await conversation({ session: opened.value.ask.value, options })
  } finally {
    opened.value.close()
  }
}

/** Whether this invocation names something to do, resume, or explain. */
function isAnAsk(options: AskOptions): boolean {
  return (
    (options.utterance ?? '').trim().length > 0 ||
    options.resume !== undefined ||
    options.why !== undefined
  )
}

async function conversation(input: {
  session: AskSession
  options: AskOptions
}): Promise<ExitCode> {
  const { session, options } = input
  const { out } = options.context

  if (options.why !== undefined) {
    const explained = await session.explain(options.why)
    return explained.ok
      ? showExplanation(options, explained.value)
      : problem(options, explained.error)
  }

  const opening =
    options.resume === undefined
      ? await start(session, options)
      : await session.reopen(options.resume)

  if (!opening.ok) return problem(options, opening.error)

  const answered = options.approve === true ? await answer(session, opening.value) : opening

  if (!answered.ok) return problem(options, answered.error)

  const ran = await session.run(answered.value)
  if (!ran.ok) return problem(options, ran.error)

  out.json({ plan: answered.value.plan.id, outcome: ran.value.kind })

  return report({ options, outcome: ran.value, planId: answered.value.plan.id })
}

/** Proposes a plan and shows it, before anything runs. */
async function start(
  session: AskSession,
  options: AskOptions,
): Promise<ReturnType<AskSession['propose']> extends Promise<infer T> ? T : never> {
  const { out } = options.context

  // `isAnAsk` has already established there is one; this keeps the type honest.
  const proposed = await session.propose(options.utterance ?? '')
  if (!proposed.ok) return proposed

  // ★ Printed BEFORE anything runs, every time, including when nothing in the
  // plan needs approving. Chapter 12's promise is that the work is inspectable
  // before it happens — not merely inspectable when FRIDAY judges it worth
  // showing, which is a promise the owner cannot rely on.
  out.line(`FRIDAY's plan — ${proposed.value.plan.rationale}`)

  for (const step of [...proposed.value.steps].sort((a, b) => a.sequence - b.sequence)) {
    out.line(`  ${step.sequence}. ${step.description}`)
  }

  out.line('')

  return proposed
}

/** Records the owner's answer to whatever the plan is waiting on. */
function answer(
  session: AskSession,
  proposed: ProposedRun,
): ReturnType<AskSession['approveShape']> {
  const waiting = Object.entries(proposed.progress.stepStatuses).find(
    ([, status]) => status === 'awaiting_approval',
  )

  // ★ Answers the ONE thing that was asked. A step waiting on the owner is
  // answered as that step; only a plan waiting on its shape is answered as the
  // plan. `--approve` cannot become "yes to everything" because there is
  // nowhere for a second yes to go — and a plan waiting on two steps is
  // answered twice, once each.
  return waiting === undefined
    ? session.approveShape(proposed.plan.id)
    : session.answerStep(proposed.plan.id, waiting[0])
}

/** Says where it stopped, and what would move it on. */
function report(input: { options: AskOptions; outcome: AskOutcome; planId: string }): ExitCode {
  const { out } = input.options.context
  const { outcome, planId } = input

  if (outcome.kind === 'completed') {
    out.line(outcome.explanation.headline)

    for (const line of outcome.explanation.detail.lines) {
      out.line(`  ${line.text}`)
    }

    return EXIT.ok
  }

  if (outcome.kind === 'failed') {
    out.problem(outcome.because)
    if (outcome.error !== undefined) out.problem(`  ${outcome.error.message}`)

    return EXIT.problem
  }

  const asking =
    outcome.kind === 'awaiting_plan_approval'
      ? `FRIDAY stopped before starting: ${outcome.because}.`
      : `FRIDAY stopped and needs you: ${outcome.description}`

  out.line(asking)
  out.line('')
  out.line('  She will wait as long as it takes. To let her carry on:')
  out.line(`    friday ask --resume ${planId} --approve`)

  // ★ Not an error. She stopped because she was supposed to, and a non-zero
  // exit would make a script treat being asked as a failure — which is how
  // "just add --approve to everything" starts.
  return EXIT.ok
}

function showExplanation(
  options: AskOptions,
  explanation: { headline: string; detail: { lines: readonly { text: string }[] }; asked: string },
): ExitCode {
  const { out } = options.context

  out.line(`You asked: ${explanation.asked}`)
  out.line(explanation.headline)

  for (const line of explanation.detail.lines) {
    out.line(`  ${line.text}`)
  }

  out.json({ explanation })

  return EXIT.ok
}

function problem(options: AskOptions, error: FridayError): ExitCode {
  options.context.out.problem(error.message)
  options.context.out.json({ problem: error })

  return EXIT.problem
}
