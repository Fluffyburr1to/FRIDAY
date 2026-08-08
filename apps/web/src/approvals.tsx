import type { ApprovalRequest } from '@friday/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from './i18n'
import { trpc } from './trpc'

/**
 * What needs you.
 *
 * Chapter 26's first design rule for this screen: "needs you" is always first,
 * because Article III depends on the owner noticing. So it sits above the
 * event log and it is the only thing here that can be acted on.
 *
 * ── Why some of them cannot be answered ─────────────────────────────────────
 *
 * A browser on this machine can establish that a request came from the owner's
 * computer. It cannot establish that the owner is sitting at it, and the
 * highest-risk approvals need exactly that. Those requests are shown in full
 * and their controls are inert, with the reason said out loud rather than left
 * for the owner to work out.
 *
 * `requiredAuth` comes from the server. This component renders it; it does not
 * compute it, and if it were bypassed the Guardian would refuse anyway.
 *
 * Reference: docs/adr/0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md
 */

const POLL_INTERVAL_MS = 1_000

export function Approvals(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const pending = trpc.approvals.pending.queryOptions()

  const query = useQuery({
    ...pending,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const respond = useMutation(
    trpc.approvals.respond.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: pending.queryKey }),
    }),
  )

  // Nothing waiting is the normal state, and it should look like nothing
  // rather than like an empty container asking to be noticed.
  if (query.data === undefined || query.data.approvals.length === 0) return null

  return (
    <section aria-labelledby="needs-you">
      <h2 id="needs-you">
        {t('approvals.heading')} <span className="count">{query.data.approvals.length}</span>
      </h2>

      <ul className="approvals">
        {query.data.approvals.map((request) => (
          <Approval
            key={request.id}
            request={request}
            busy={respond.isPending}
            onRespond={(decision) => respond.mutate({ approvalId: request.id, decision })}
          />
        ))}
      </ul>

      {respond.isError && <p className="notice notice--stale">{respond.error.message}</p>}
    </section>
  )
}

function Approval(input: {
  request: ApprovalRequest
  busy: boolean
  onRespond: (decision: 'approve' | 'decline') => void
}): React.JSX.Element {
  const { request, busy, onRespond } = input

  // Server-derived. `none` is the Guardian saying this one does not need the
  // owner to prove presence — not this component deciding it is safe.
  const answerable = request.requiredAuth === 'none'

  return (
    <li className="approval">
      <p className="approval__title">{request.title}</p>
      <p className="approval__why">{request.explanation.why}</p>

      <dl className="approval__facts">
        <dt>{t('approvals.risk')}</dt>
        <dd>{request.riskClass}</dd>
        <dt>{t('approvals.reversible')}</dt>
        <dd>{request.impact.reversible ? t('approvals.yes') : t('approvals.no')}</dd>
        <dt>{t('approvals.leaves')}</dt>
        <dd>{request.impact.dataLeavesDevice ? t('approvals.yes') : t('approvals.no')}</dd>
      </dl>

      <div className="approval__actions">
        <button type="button" disabled={!answerable || busy} onClick={() => onRespond('approve')}>
          {t('approvals.approve')}
        </button>
        <button type="button" disabled={!answerable || busy} onClick={() => onRespond('decline')}>
          {t('approvals.decline')}
        </button>
      </div>

      {/*
        Said plainly. An unavailable control with no explanation reads as a
        bug, and the owner is left unsure whether FRIDAY is stuck.
      */}
      {!answerable && <p className="approval__blocked">{t('approvals.needsStepUp')}</p>}
    </li>
  )
}
