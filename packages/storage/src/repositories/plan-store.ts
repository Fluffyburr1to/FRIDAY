import {
  err,
  type FridayError,
  fridayError,
  ok,
  type Plan,
  type PlanStep,
  type PrincipalId,
  type Result,
} from '@friday/contracts'
import { and, asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { type PlanRow, type PlanStepRow, planSteps, plans } from '../schema/plans.js'

/**
 * Plans and their steps.
 *
 * ★ Every query filters by `principal_id`, and the filter is part of the WHERE
 * clause rather than applied to the results. Today there is exactly one value
 * in that column. When a second person is added, the isolation mechanism has
 * already been exercised by every query ever written — which is the entire
 * reason for paying the cost now rather than auditing every query later.
 *
 * The plan *engine* arrives at M3. This is the persistence it will need.
 *
 * Reference: docs/01-bible/09-database-design.md
 */
export interface PlanStore {
  createPlan(plan: Plan): Result<Plan, FridayError>

  getPlan(input: { id: string; principalId: PrincipalId }): Result<Plan | undefined, FridayError>

  listPlans(input: {
    principalId: PrincipalId
    status?: Plan['status'] | undefined
  }): Result<Plan[], FridayError>

  addStep(step: PlanStep): Result<PlanStep, FridayError>

  listSteps(input: { planId: string; principalId: PrincipalId }): Result<PlanStep[], FridayError>
}

/**
 * Creates the plan repository.
 *
 * @param db - The `friday.db` handle.
 * @returns The store.
 */
export function createPlanStore(db: BetterSQLite3Database): PlanStore {
  return {
    createPlan(plan) {
      try {
        db.insert(plans).values(plan).run()
        return ok(plan)
      } catch (cause) {
        return err(writeFailed('plan', plan.id, cause))
      }
    },

    getPlan({ id, principalId }) {
      const row = db
        .select()
        .from(plans)
        .where(and(eq(plans.id, id), eq(plans.principalId, principalId)))
        .get()

      return ok(row === undefined ? undefined : toPlan(row))
    },

    listPlans({ principalId, status }) {
      const condition =
        status === undefined
          ? eq(plans.principalId, principalId)
          : and(eq(plans.principalId, principalId), eq(plans.status, status))

      const rows = db.select().from(plans).where(condition).orderBy(asc(plans.createdAt)).all()

      return ok(rows.map(toPlan))
    },

    addStep(step) {
      try {
        db.insert(planSteps)
          .values({
            ...step,
            actionPayload: JSON.stringify(step.actionPayload),
            result: step.result === null ? null : JSON.stringify(step.result),
            error: step.error === null ? null : JSON.stringify(step.error),
          })
          .run()

        return ok(step)
      } catch (cause) {
        return err(writeFailed('plan step', step.id, cause))
      }
    },

    listSteps({ planId, principalId }) {
      const rows = db
        .select()
        .from(planSteps)
        .where(and(eq(planSteps.planId, planId), eq(planSteps.principalId, principalId)))
        .orderBy(asc(planSteps.sequence))
        .all()

      return ok(rows.map(toPlanStep))
    },
  }
}

function writeFailed(what: string, id: string, cause: unknown): FridayError {
  return fridayError({
    code: 'STORAGE_WRITE_FAILED',
    message: `FRIDAY could not save a ${what}.`,
    detail: { id },
    cause,
  })
}

function toPlan(row: PlanRow): Plan {
  return { ...row, status: row.status as Plan['status'] }
}

function toPlanStep(row: PlanStepRow): PlanStep {
  return {
    ...row,
    status: row.status as PlanStep['status'],
    riskClass: row.riskClass as PlanStep['riskClass'],
    actionPayload: JSON.parse(row.actionPayload) as Record<string, unknown>,
    result: row.result === null ? null : (JSON.parse(row.result) as Record<string, unknown>),
    error: row.error === null ? null : (JSON.parse(row.error) as Record<string, unknown>),
  }
}
