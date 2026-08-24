import type { PlanStatus, PlanStepStatus } from '@friday/contracts'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from './i18n'
import { trpc } from './trpc'

/**
 * What FRIDAY is doing, and what she did.
 *
 * Chapter 26's Layer 2 asks *what is happening now*; Layer 3 is *a specific
 * plan, with a full explanation in plain language*. This panel is both,
 * because ADR-0041 §4 says the HUD has no routes: expanding a plan is how you
 * get from one layer to the next, and reloading the page loses nothing but
 * which row was open.
 *
 * ── What this panel cannot do ───────────────────────────────────────────────
 *
 * ★ **It reads.** There is no control here that advances a plan, approves one,
 * or retries a step — and the API it talks to has no procedure that could.
 * Answering FRIDAY goes through the approvals panel, where Chapter 19's rules
 * and ADR-0030's presence restriction both apply. A second way to say yes,
 * sitting next to the work it would authorise, is exactly how a considered
 * approval becomes a reflex.
 *
 * ── Why the explanation is fetched rather than stored ───────────────────────
 *
 * Chapter 12 §2: if a plan's stored explanation and its events ever disagree,
 * the events are right. The server recomposes from the log on every request,
 * so what is on screen is what happened rather than what was written down at
 * the time.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md · docs/adr/0041
 */

/** How many plans the panel holds. Enough to see a day. */
const PAGE_SIZE = 25

export function PlansPanel(input: { pollIntervalMs: number }): React.JSX.Element {
  const [openPlanId, setOpenPlanId] = useState<string | undefined>(undefined)

  const query = useQuery({
    ...trpc.plans.list.queryOptions({ showing: 'recent', limit: PAGE_SIZE }),
    refetchInterval: input.pollIntervalMs,

    // Same reason as the event log: this is a transparency surface reading a
    // local socket, and "what FRIDAY is doing" has to be true on a screen
    // being glanced at rather than only on one being clicked into.
    refetchIntervalInBackground: true,
  })

  if (query.data === undefined) {
    return (
      <p className="notice">
        {query.isError ? `${t('plans.unreachable')} ${query.error.message}` : t('plans.connecting')}
      </p>
    )
  }

  if (query.data.plans.length === 0) {
    return <p className="notice">{t('plans.empty')}</p>
  }

  return (
    <ul className="plans">
      {query.data.plans.map((entry) => (
        <PlanRow
          key={entry.plan.id}
          plan={entry.plan}
          steps={entry.steps}
          open={openPlanId === entry.plan.id}
          onToggle={() => setOpenPlanId(openPlanId === entry.plan.id ? undefined : entry.plan.id)}
        />
      ))}
    </ul>
  )
}

interface PlanSummary {
  readonly id: string
  readonly utterance: string
  readonly status: PlanStatus
  readonly rationale: string
}

interface StepSummary {
  readonly id: string
  readonly sequence: number
  readonly description: string
  readonly status: PlanStepStatus
}

function PlanRow(input: {
  plan: PlanSummary
  steps: readonly StepSummary[]
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { plan, steps, open, onToggle } = input
  const done = steps.filter((step) => isFinished(step.status)).length

  return (
    <li className={`plan plan--${plan.status}`}>
      <button className="plan__head" type="button" onClick={onToggle} aria-expanded={open}>
        {/*
          ★ The owner's own sentence, not the parsed intent and not the
          rationale. ADR-0045 keeps the utterance precisely so a plan can be
          recognised by what was asked for rather than by FRIDAY's restatement
          of it.
        */}
        <span className="plan__asked">{plan.utterance}</span>
        <span className="plan__status">{statusLabel(plan.status)}</span>
        <span className="plan__progress">
          {t('plans.stepsDone')
            .replace('{done}', String(done))
            .replace('{total}', String(steps.length))}
        </span>
      </button>

      {open && <PlanDetail plan={plan} steps={steps} />}
    </li>
  )
}

function PlanDetail(input: {
  plan: PlanSummary
  steps: readonly StepSummary[]
}): React.JSX.Element {
  const { plan, steps } = input

  return (
    <div className="plan__detail">
      <p className="plan__rationale">{plan.rationale}</p>

      <ol className="plan__steps">
        {[...steps]
          .sort((left, right) => left.sequence - right.sequence)
          .map((step) => (
            <li key={step.id} className={`step step--${step.status}`}>
              <span className="step__status">{stepLabel(step.status)}</span>
              <span className="step__what">{step.description}</span>
            </li>
          ))}
      </ol>

      <Why planId={plan.id} />
    </div>
  )
}

/**
 * Why she did it, from the log.
 *
 * ★ Every line carries the id of the event behind it, and that id is rendered
 * rather than kept for debugging: it is what makes Chapter 26's Layer 4
 * reachable from Layer 3, and what stops this reading as a story FRIDAY told
 * about herself.
 */
function Why(input: { planId: string }): React.JSX.Element {
  const query = useQuery(trpc.plans.why.queryOptions({ planId: input.planId }))

  if (query.data === undefined) {
    return <p className="notice">{query.isError ? query.error.message : t('plans.why.loading')}</p>
  }

  const { lines, omitted } = query.data

  return (
    <section className="why" aria-label={t('plans.why.heading')}>
      <h3 className="why__heading">{t('plans.why.heading')}</h3>
      <p className="why__headline">{query.data.headline}</p>

      <ol className="why__lines">
        {lines.map((line) => (
          <li key={line.eventId} className="why__line" style={{ marginLeft: line.depth * 12 }}>
            <span className="why__text">{line.text}</span>
            <span className="why__event" title={line.eventType}>
              {line.eventId.slice(0, 8)}
            </span>
          </li>
        ))}
      </ol>

      {/*
        ★ Said out loud rather than left implied. "Is this the whole story?"
        must have an answer on the screen — an explanation that quietly omitted
        part of what happened would be the exact failure the audit package
        exists to prevent, and it would be invisible.
      */}
      {(omitted.belowDepth > 0 || omitted.unphrased.length > 0) && (
        <p className="why__omitted">
          {t('plans.why.omitted').replace(
            '{count}',
            String(omitted.belowDepth + omitted.unphrased.length),
          )}
        </p>
      )}
    </section>
  )
}

function isFinished(status: PlanStepStatus): boolean {
  return status === 'completed' || status === 'skipped'
}

/**
 * The words the owner reads for a status.
 *
 * ★ Sentences rather than the enum. `awaiting_plan_approval` is a correct name
 * for a state and a bad thing to put in front of someone — and the two waiting
 * states are worded differently on purpose, because *"she wants you to see the
 * plan"* and *"she is partway through and stuck"* are different situations.
 */
function statusLabel(status: PlanStatus): string {
  switch (status) {
    case 'draft':
      return t('plans.status.draft')
    case 'awaiting_plan_approval':
      return t('plans.status.awaitingPlan')
    case 'running':
      return t('plans.status.running')
    case 'awaiting_approval':
      return t('plans.status.awaitingStep')
    case 'completed':
      return t('plans.status.completed')
    case 'failed':
      return t('plans.status.failed')
    case 'cancelled':
      return t('plans.status.cancelled')
  }
}

function stepLabel(status: PlanStepStatus): string {
  switch (status) {
    case 'pending':
      return t('plans.step.pending')
    case 'running':
      return t('plans.step.running')
    case 'awaiting_approval':
      return t('plans.step.awaiting')
    case 'completed':
      return t('plans.step.completed')
    case 'failed':
      return t('plans.step.failed')
    case 'skipped':
      return t('plans.step.skipped')
  }
}
