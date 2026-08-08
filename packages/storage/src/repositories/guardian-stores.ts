import {
  type ApprovalRequest,
  ApprovalRequestSchema,
  type Capability,
  CapabilitySchema,
  err,
  type FridayError,
  fridayError,
  type GuardianDecision,
  ok,
  type Result,
  type StandingGrant,
  StandingGrantSchema,
} from '@friday/contracts'
import type { Database } from 'better-sqlite3'

/**
 * The Guardian's records, on disk.
 *
 * This is what makes Milestone 2's claim true rather than aspirational: an
 * approval request survives a restart, so waiting days for the owner costs
 * nothing and there is never pressure to add a timeout that proceeds anyway.
 *
 * Written against `better-sqlite3` directly rather than through Drizzle. The
 * plan tables use Drizzle and these do not, which is a deliberate split: these
 * four tables are written and read by exactly one consumer with fixed queries,
 * and the row shapes are wide and flat. Hand-written statements are prepared
 * once, are visible in full, and avoid teaching Drizzle about a fifth shape of
 * JSON column. If a second consumer ever needs these tables, revisit it.
 *
 * ★ Every method returns `Result`, and every query filters by `principal_id`
 * where the row has one. The first is ADR-0027; the second is the rule every
 * query in this package follows.
 *
 * Reference: docs/01-bible/19-approval-system.md · Chapter 09 · ADR-0027
 */

/** What the Guardian needs persisted. Shapes match its ports exactly. */
export interface GuardianStores {
  readonly approvals: {
    put(request: ApprovalRequest): Result<void, FridayError>
    get(id: string): Result<ApprovalRequest | undefined, FridayError>
    replace(request: ApprovalRequest): Result<void, FridayError>
    listPending(principalId?: string): Result<readonly ApprovalRequest[], FridayError>
  }

  readonly grants: {
    put(grant: StandingGrant): Result<void, FridayError>
    get(id: string): Result<StandingGrant | undefined, FridayError>
    replace(grant: StandingGrant): Result<void, FridayError>
    listByPrincipal(principalId: string): Result<readonly StandingGrant[], FridayError>
  }

  readonly capabilities: {
    put(capability: Capability): Result<void, FridayError>
    get(id: string): Result<Capability | undefined, FridayError>
    replace(capability: Capability): Result<void, FridayError>
    listByPlan(planId: string): Result<readonly Capability[], FridayError>
  }

  /** Write-only from the Guardian's side; the dashboard and audit read it. */
  readonly decisions: {
    record(decision: GuardianDecision): Result<void, FridayError>
    listByPrincipal(
      principalId: string,
      limit?: number,
    ): Result<readonly GuardianDecision[], FridayError>
  }
}

/**
 * Runs a statement, turning a thrown driver error into a typed failure.
 *
 * `better-sqlite3` throws. Chapter 30 wants a `Result` for anything that can
 * fail in normal operation, and a locked or unwritable database is exactly
 * that — so the throw is caught here, once, at the boundary, rather than left
 * to surprise a caller who cannot see it in a signature.
 */
/** The slice of a Zod schema these repositories use to read a row back. */
interface RowSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown }
}

function attempt<T>(what: string, run: () => T): Result<T, FridayError> {
  try {
    return ok(run())
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_WRITE_FAILED',
        message: `FRIDAY could not ${what}.`,
        cause,
      }),
    )
  }
}

/**
 * Parses a stored row back into its contract shape.
 *
 * A row that no longer satisfies the schema is a typed failure rather than a
 * silent coercion. Corruption, a hand-edited database, or a migration that
 * went wrong should surface as "FRIDAY could not read this" — not as an
 * approval with no explanation being handed to the dashboard.
 */
function parseRow<T>(what: string, schema: RowSchema<T>, row: unknown): Result<T, FridayError> {
  const parsed = schema.safeParse(row)
  if (!parsed.success) {
    return err(
      fridayError({
        code: 'VALIDATION_FAILED',
        message: `A stored ${what} is not in a shape FRIDAY can read.`,
        detail: { issues: parsed.error },
      }),
    )
  }
  return ok(parsed.data)
}

/** Collects rows, stopping at the first that will not parse. */
function parseAll<T>(
  what: string,
  schema: RowSchema<T>,
  rows: readonly unknown[],
): Result<T[], FridayError> {
  const parsed: T[] = []

  for (const row of rows) {
    const one = parseRow<T>(what, schema, row)
    if (!one.ok) return err(one.error)
    parsed.push(one.value)
  }

  return ok(parsed)
}

const bool = (value: boolean): number => (value ? 1 : 0)
const unbool = (value: number): boolean => value === 1

/**
 * Opens the Guardian's repositories over an already-migrated database.
 *
 * @param db - The `friday.db` handle.
 * @returns The four stores.
 */
export function createGuardianStores(db: Database): GuardianStores {
  const approvalColumns = `
    id, principal_id, title, risk_class,
    explanation_what, explanation_why, confidence, risks, alternatives,
    preview_kind, preview_content,
    reversible, data_leaves_device, data_categories, estimated_cost_cents,
    actor_type, actor_id, action, resource,
    plan_id, plan_step_id, correlation_id, decision_id, requested_event_id,
    required_auth, created_at, expires_at, status,
    responded_at, responded_via, response_reason`

  const insertApproval = db.prepare(`
    INSERT OR REPLACE INTO approvals (${approvalColumns})
    VALUES (@id, @principalId, @title, @riskClass,
            @what, @why, @confidence, @risks, @alternatives,
            @previewKind, @previewContent,
            @reversible, @dataLeavesDevice, @dataCategories, @estimatedCostCents,
            @actorType, @actorId, @action, @resource,
            @planId, @planStepId, @correlationId, @decisionId, @requestedEventId,
            @requiredAuth, @createdAt, @expiresAt, @status,
            @respondedAt, @respondedVia, @responseReason)`)

  const selectApproval = db.prepare('SELECT * FROM approvals WHERE id = ?')
  const selectPendingAll = db.prepare(
    "SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC",
  )
  const selectPendingFor = db.prepare(
    "SELECT * FROM approvals WHERE status = 'pending' AND principal_id = ? ORDER BY created_at ASC",
  )

  const approvalParams = (request: ApprovalRequest): Record<string, unknown> => ({
    id: request.id,
    principalId: request.principalId,
    title: request.title,
    riskClass: request.riskClass,
    what: request.explanation.what,
    why: request.explanation.why,
    confidence: request.explanation.confidence,
    risks: JSON.stringify(request.explanation.risks),
    alternatives: JSON.stringify(request.explanation.alternatives),
    previewKind: request.preview.kind,
    previewContent: request.preview.content,
    reversible: bool(request.impact.reversible),
    dataLeavesDevice: bool(request.impact.dataLeavesDevice),
    dataCategories: JSON.stringify(request.impact.dataCategories),
    estimatedCostCents: request.impact.estimatedCostCents,
    actorType: request.actor.type,
    actorId: request.actor.id,
    action: request.action,
    resource: request.resource,
    planId: request.planId,
    planStepId: request.planStepId,
    correlationId: request.correlationId,
    decisionId: request.decisionId,
    requestedEventId: request.requestedEventId,
    requiredAuth: request.requiredAuth,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: request.status,
    respondedAt: request.respondedAt,
    respondedVia: request.respondedVia,
    responseReason: request.responseReason,
  })

  const toApproval = (row: ApprovalRow): unknown => ({
    id: row.id,
    principalId: row.principal_id,
    title: row.title,
    riskClass: row.risk_class,
    explanation: {
      what: row.explanation_what,
      why: row.explanation_why,
      confidence: row.confidence,
      risks: JSON.parse(row.risks) as string[],
      alternatives: JSON.parse(row.alternatives) as string[],
    },
    preview: { kind: row.preview_kind, content: row.preview_content },
    impact: {
      reversible: unbool(row.reversible),
      dataLeavesDevice: unbool(row.data_leaves_device),
      dataCategories: JSON.parse(row.data_categories) as string[],
      estimatedCostCents: row.estimated_cost_cents,
    },
    actor: { type: row.actor_type, id: row.actor_id },
    action: row.action,
    resource: row.resource,
    planId: row.plan_id,
    planStepId: row.plan_step_id,
    correlationId: row.correlation_id,
    decisionId: row.decision_id,
    requestedEventId: row.requested_event_id,
    requiredAuth: row.required_auth,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    respondedAt: row.responded_at,
    respondedVia: row.responded_via,
    responseReason: row.response_reason,
  })

  const writeApproval = (request: ApprovalRequest): Result<void, FridayError> => {
    const written = attempt('save an approval request', () =>
      insertApproval.run(approvalParams(request)),
    )
    return written.ok ? ok(undefined) : err(written.error)
  }

  return {
    approvals: {
      put: writeApproval,
      replace: writeApproval,

      get(id) {
        const read = attempt('read an approval request', () => selectApproval.get(id))
        if (!read.ok) return err(read.error)
        if (read.value === undefined) return ok(undefined)

        return parseRow<ApprovalRequest>(
          'approval request',
          ApprovalRequestSchema,
          toApproval(read.value as ApprovalRow),
        )
      },

      listPending(principalId) {
        const read = attempt('list pending approvals', () =>
          principalId === undefined ? selectPendingAll.all() : selectPendingFor.all(principalId),
        )
        if (!read.ok) return err(read.error)

        return parseAll<ApprovalRequest>(
          'approval request',
          ApprovalRequestSchema,
          (read.value as ApprovalRow[]).map(toApproval),
        )
      },
    },

    grants: createGrantStore(db),
    capabilities: createCapabilityStore(db),
    decisions: createDecisionStore(db),
  }
}

// ── Standing grants ─────────────────────────────────────────────────────────

function createGrantStore(db: Database): GuardianStores['grants'] {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO standing_grants (
      id, principal_id, action_pattern, resource_pattern, risk_class, negative,
      max_amount_cents, max_per_day, time_window, requires_dry_run_match,
      reason, created_at, expires_at, max_uses, uses, revoked_at)
    VALUES (@id, @principalId, @actionPattern, @resourcePattern, @riskClass, @negative,
            @maxAmountCents, @maxPerDay, @timeWindow, @requiresDryRunMatch,
            @reason, @createdAt, @expiresAt, @maxUses, @uses, @revokedAt)`)

  const selectOne = db.prepare('SELECT * FROM standing_grants WHERE id = ?')
  const selectMine = db.prepare(
    'SELECT * FROM standing_grants WHERE principal_id = ? ORDER BY created_at ASC',
  )

  const params = (grant: StandingGrant): Record<string, unknown> => ({
    id: grant.id,
    principalId: grant.principalId,
    actionPattern: grant.actionPattern,
    resourcePattern: grant.resourcePattern,
    riskClass: grant.riskClass,
    negative: bool(grant.negative),
    maxAmountCents: grant.constraints.maxAmountCents,
    maxPerDay: grant.constraints.maxPerDay,
    timeWindow: grant.constraints.timeWindow,
    requiresDryRunMatch: bool(grant.constraints.requiresDryRunMatch),
    reason: grant.reason,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    maxUses: grant.maxUses,
    uses: grant.uses,
    revokedAt: grant.revokedAt,
  })

  const toGrant = (row: GrantRow): unknown => ({
    id: row.id,
    principalId: row.principal_id,
    actionPattern: row.action_pattern,
    resourcePattern: row.resource_pattern,
    riskClass: row.risk_class,
    negative: unbool(row.negative),
    constraints: {
      maxAmountCents: row.max_amount_cents,
      maxPerDay: row.max_per_day,
      timeWindow: row.time_window,
      requiresDryRunMatch: unbool(row.requires_dry_run_match),
    },
    reason: row.reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    revokedAt: row.revoked_at,
  })

  const write = (grant: StandingGrant): Result<void, FridayError> => {
    const written = attempt('save a standing permission', () => insert.run(params(grant)))
    return written.ok ? ok(undefined) : err(written.error)
  }

  return {
    put: write,
    replace: write,

    get(id) {
      const read = attempt('read a standing permission', () => selectOne.get(id))
      if (!read.ok) return err(read.error)
      if (read.value === undefined) return ok(undefined)

      return parseRow<StandingGrant>(
        'standing permission',
        StandingGrantSchema,
        toGrant(read.value as GrantRow),
      )
    },

    listByPrincipal(principalId) {
      const read = attempt('list standing permissions', () => selectMine.all(principalId))
      if (!read.ok) return err(read.error)

      return parseAll<StandingGrant>(
        'standing permission',
        StandingGrantSchema,
        (read.value as GrantRow[]).map(toGrant),
      )
    },
  }
}

// ── Capabilities ────────────────────────────────────────────────────────────

function createCapabilityStore(db: Database): GuardianStores['capabilities'] {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO capabilities (
      id, principal_id, issued_to_type, issued_to_id, plan_id, plan_step_id,
      action, resource, max_calls, max_amount_cents,
      issued_at, expires_at, uses, revoked_at, revoked_reason)
    VALUES (@id, @principalId, @issuedToType, @issuedToId, @planId, @planStepId,
            @action, @resource, @maxCalls, @maxAmountCents,
            @issuedAt, @expiresAt, @uses, @revokedAt, @revokedReason)`)

  const selectOne = db.prepare('SELECT * FROM capabilities WHERE id = ?')
  const selectForPlan = db.prepare(
    'SELECT * FROM capabilities WHERE plan_id = ? ORDER BY issued_at ASC',
  )

  const params = (capability: Capability): Record<string, unknown> => ({
    id: capability.id,
    principalId: capability.principalId,
    issuedToType: capability.issuedTo.type,
    issuedToId: capability.issuedTo.id,
    planId: capability.planId,
    planStepId: capability.planStepId,
    action: capability.action,
    resource: capability.resource,
    maxCalls: capability.constraints.maxCalls,
    maxAmountCents: capability.constraints.maxAmountCents,
    issuedAt: capability.issuedAt,
    expiresAt: capability.expiresAt,
    uses: capability.uses,
    revokedAt: capability.revokedAt,
    revokedReason: capability.revokedReason,
  })

  const toCapability = (row: CapabilityRow): unknown => ({
    id: row.id,
    principalId: row.principal_id,
    issuedTo: { type: row.issued_to_type, id: row.issued_to_id },
    planId: row.plan_id,
    planStepId: row.plan_step_id,
    action: row.action,
    resource: row.resource,
    constraints: { maxCalls: row.max_calls, maxAmountCents: row.max_amount_cents },
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    uses: row.uses,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  })

  const write = (capability: Capability): Result<void, FridayError> => {
    const written = attempt('save a permission slip', () => insert.run(params(capability)))
    return written.ok ? ok(undefined) : err(written.error)
  }

  return {
    put: write,
    replace: write,

    get(id) {
      const read = attempt('read a permission slip', () => selectOne.get(id))
      if (!read.ok) return err(read.error)
      if (read.value === undefined) return ok(undefined)

      return parseRow<Capability>(
        'permission slip',
        CapabilitySchema,
        toCapability(read.value as CapabilityRow),
      )
    },

    listByPlan(planId) {
      const read = attempt('list a plan’s permission slips', () => selectForPlan.all(planId))
      if (!read.ok) return err(read.error)

      return parseAll<Capability>(
        'permission slip',
        CapabilitySchema,
        (read.value as CapabilityRow[]).map(toCapability),
      )
    },
  }
}

// ── Decisions ───────────────────────────────────────────────────────────────

function createDecisionStore(db: Database): GuardianStores['decisions'] {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO guardian_decisions (
      id, principal_id, decision, reason, risk_class, matched_policies,
      approval_id, standing_grant_id, capability_id, summary,
      actor_type, actor_id, action, resource,
      plan_id, plan_step_id, correlation_id, decided_at)
    VALUES (@id, @principalId, @decision, @reason, @riskClass, @matchedPolicies,
            @approvalId, @standingGrantId, @capabilityId, @summary,
            @actorType, @actorId, @action, @resource,
            @planId, @planStepId, @correlationId, @decidedAt)`)

  const selectMine = db.prepare(
    'SELECT * FROM guardian_decisions WHERE principal_id = ? ORDER BY decided_at DESC LIMIT ?',
  )

  return {
    record(decision) {
      const written = attempt('record a decision', () =>
        insert.run({
          id: decision.id,
          principalId: decision.principalId,
          decision: decision.decision,
          reason: decision.reason,
          riskClass: decision.riskClass,
          matchedPolicies: JSON.stringify(decision.matchedPolicies),
          approvalId: decision.approvalId,
          standingGrantId: decision.standingGrantId,
          capabilityId: decision.capabilityId,
          summary: decision.summary,
          actorType: decision.actor.type,
          actorId: decision.actor.id,
          action: decision.action,
          resource: decision.resource,
          planId: decision.planId,
          planStepId: decision.planStepId,
          correlationId: decision.correlationId,
          decidedAt: decision.decidedAt,
        }),
      )

      return written.ok ? ok(undefined) : err(written.error)
    },

    listByPrincipal(principalId, limit = 100) {
      const read = attempt('list decisions', () => selectMine.all(principalId, limit))
      if (!read.ok) return err(read.error)

      return ok(
        (read.value as DecisionRow[]).map((row) => ({
          id: row.id,
          principalId: row.principal_id,
          decision: row.decision as GuardianDecision['decision'],
          reason: row.reason as GuardianDecision['reason'],
          riskClass: row.risk_class as GuardianDecision['riskClass'],
          matchedPolicies: JSON.parse(row.matched_policies) as string[],
          approvalId: row.approval_id,
          standingGrantId: row.standing_grant_id,
          capabilityId: row.capability_id,
          summary: row.summary,
          actor: { type: row.actor_type as GuardianDecision['actor']['type'], id: row.actor_id },
          action: row.action,
          resource: row.resource,
          planId: row.plan_id,
          planStepId: row.plan_step_id,
          correlationId: row.correlation_id,
          decidedAt: row.decided_at,
        })),
      )
    },
  }
}

// ── Row shapes ──────────────────────────────────────────────────────────────

interface ApprovalRow {
  id: string
  principal_id: string
  title: string
  risk_class: string
  explanation_what: string
  explanation_why: string
  confidence: number
  risks: string
  alternatives: string
  preview_kind: string
  preview_content: string
  reversible: number
  data_leaves_device: number
  data_categories: string
  estimated_cost_cents: number | null
  actor_type: string
  actor_id: string
  action: string
  resource: string
  plan_id: string | null
  plan_step_id: string | null
  correlation_id: string | null
  decision_id: string
  requested_event_id: string | null
  required_auth: string
  created_at: number
  expires_at: number
  status: string
  responded_at: number | null
  responded_via: string | null
  response_reason: string | null
}

interface GrantRow {
  id: string
  principal_id: string
  action_pattern: string
  resource_pattern: string
  risk_class: string
  negative: number
  max_amount_cents: number | null
  max_per_day: number | null
  time_window: string | null
  requires_dry_run_match: number
  reason: string
  created_at: number
  expires_at: number
  max_uses: number | null
  uses: number
  revoked_at: number | null
}

interface CapabilityRow {
  id: string
  principal_id: string
  issued_to_type: string
  issued_to_id: string
  plan_id: string | null
  plan_step_id: string | null
  action: string
  resource: string
  max_calls: number | null
  max_amount_cents: number | null
  issued_at: number
  expires_at: number
  uses: number
  revoked_at: number | null
  revoked_reason: string | null
}

interface DecisionRow {
  id: string
  principal_id: string
  decision: string
  reason: string
  risk_class: string
  matched_policies: string
  approval_id: string | null
  standing_grant_id: string | null
  capability_id: string | null
  summary: string
  actor_type: string
  actor_id: string
  action: string
  resource: string
  plan_id: string | null
  plan_step_id: string | null
  correlation_id: string | null
  decided_at: number
}
