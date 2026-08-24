import {
  approvePlan,
  approveStep,
  beginning,
  composeExplanation,
  createCapabilityRegistry,
  createExecutor,
  type ExecutableStep,
  eventsFor,
  fromStored,
  generatePlan,
  type Invoke,
  loadDepartments,
  type PlanExplanation,
  type PlanProgress,
  type PlanTransition,
  type ProposedPlan,
  parseIntent,
  type RunOutcome,
  routePlan,
  runPlan,
  toStored,
  validatePlan,
} from '@friday/chief-of-staff'
import type { AuthorizingClerk } from '@friday/clerk'
import type { FridayConfig } from '@friday/config'
import {
  type Actor,
  type CorrelationId,
  type DepartmentManifest,
  err,
  type FridayError,
  fridayError,
  ok,
  type Plan,
  type PlanStep,
  type PrincipalId,
  type Result,
  type RiskClass,
  registerPlanEventTypes,
  uuidv7,
} from '@friday/contracts'
import type { CapabilityIssuer } from '@friday/guardian'
import type { EventBus } from '@friday/kernel'
import { createFakeProvider, createModelRouter, createNestedBudget } from '@friday/model-router'
import type { Storage } from '@friday/storage'
import { createDispatcher } from './departments.js'
import { createScriptedPlanner } from './scripted-planner.js'

/**
 * Asking FRIDAY to do something — the whole path, composed once.
 *
 * ★ **There is exactly one of these, and everything uses it.** The CLI, and
 * later the dashboard, call this; neither builds its own registry, Guardian,
 * executor, or execution path. That is the point rather than tidiness: a
 * second path to acting is a second set of rules, and the quiet one always
 * wins. What is here is what FRIDAY actually does.
 *
 * The path, end to end:
 *
 *   1. **The departments on disk** decide what she can do. The manifest is the
 *      security boundary; nothing not declared in one can be reached.
 *   2. **Intent parsing and plan generation** are the only steps a model
 *      touches, and both are bounded — a schema on the way out, and Chapter
 *      12's step and depth limits after.
 *   3. **The plan is written down and shown** before anything runs.
 *   4. **The Guardian decides every step**, at the moment it runs, through the
 *      real clerk — which records the decision and raises the approval.
 *   5. **The department performs the work**, and only with an `Authorised`.
 *   6. **Every transition is an event**, and the explanation is read back out
 *      of those events rather than composed from anybody's memory.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/adr/0005 · docs/adr/0007
 */

/** The actor a plan runs as. Never "FRIDAY" — always the specific agent. */
const PLANNER: Actor = { type: 'agent', id: 'agent:chief-of-staff/plan' }

/**
 * What a plan is estimated to cost.
 *
 * ★ Zero, honestly, because the shipped provider is local and free. It is not
 * a stand-in for a real estimator: when a paid provider arrives, this is where
 * its estimate goes, and until then a made-up number would make the approval
 * threshold fire on fiction.
 */
const ESTIMATE_CENTS = 0

export interface AskSessionOptions {
  readonly config: FridayConfig
  readonly storage: Storage
  readonly bus: EventBus
  readonly authorizing: AuthorizingClerk

  /**
   * Minting the per-step capability an agent must carry.
   *
   * ★ Passed in rather than built here. Exactly one thing in FRIDAY holds the
   * signing key, it is constructed once at startup where a missing key stops
   * her starting, and a second issuer would be a second thing that could sign.
   */
  readonly capabilities: CapabilityIssuer

  /**
   * How FRIDAY thinks, for intent parsing and planning only.
   *
   * Defaults to the shipped local provider through the real router, so the
   * sensitivity and budget rules apply to planning exactly as they apply to
   * anything else. A caller may substitute a provider; it may not substitute
   * the router.
   */
  readonly invoke?: Invoke | undefined
}

/** A plan, written down and ready to be shown, before anything has run. */
export interface ProposedRun {
  readonly plan: Plan
  readonly steps: readonly ExecutableStep[]

  /** The Guardian's classification per step, from the manifests. */
  readonly riskClasses: readonly RiskClass[]

  readonly progress: PlanProgress
}

/** Where a run stopped, in terms the caller can act on. */
export type AskOutcome =
  | { readonly kind: 'completed'; readonly explanation: PlanExplanation }
  | { readonly kind: 'awaiting_plan_approval'; readonly because: string }
  | {
      readonly kind: 'awaiting_approval'
      readonly stepId: string
      readonly description: string
    }
  | { readonly kind: 'failed'; readonly because: string; readonly error?: FridayError | undefined }

export interface AskSession {
  /** Every action the loaded departments declare. What she can do, exactly. */
  readonly actions: readonly string[]

  /**
   * Works out what was meant and how to do it, and writes the plan down.
   *
   * ★ Nothing runs. This is the step whose whole purpose is that the owner
   * sees the work before it happens.
   */
  propose(utterance: string): Promise<Result<ProposedRun, FridayError>>

  /** Reads back a plan that stopped earlier, so it can be picked up. */
  reopen(planId: string): Promise<Result<ProposedRun, FridayError>>

  /** Runs, or resumes, a proposed plan. Persists where it got to. */
  run(proposed: ProposedRun): Promise<Result<AskOutcome, FridayError>>

  /**
   * Records that the owner approved the plan's shape. Approves no step.
   *
   * ★ Takes an id and reads the plan off disk, rather than taking a value the
   * caller is holding. A durable plan's state lives in the database — it moved
   * when it last ran, and it may have moved in another process since. An
   * approval applied to a stale snapshot would be an answer to a question the
   * plan is no longer asking.
   */
  approveShape(planId: string): Promise<Result<ProposedRun, FridayError>>

  /** Records that the owner answered the one step that was waiting. */
  answerStep(planId: string, stepId: string): Promise<Result<ProposedRun, FridayError>>

  /** What happened, read out of the event log. */
  explain(planId: string): Promise<Result<PlanExplanation, FridayError>>
}

/**
 * Builds the session.
 *
 * @param options - The loaded configuration, storage, the bus, and the clerk
 *   that asks the Guardian and records what it answered.
 * @returns The session, or why the departments could not be loaded.
 */
export function createAskSession(options: AskSessionOptions): Result<AskSession, FridayError> {
  const { config, storage, bus, authorizing } = options
  const principalId = config.principalId

  const departments = loadDepartments(config.paths.departmentsDir)
  if (!departments.ok) return departments

  const registry = createCapabilityRegistry(departments.value)
  if (!registry.ok) return registry

  // ★ Registered on this bus and nowhere else, exactly as the Guardian's types
  // are. A process that never composed a session cannot record that a plan
  // advanced, even holding the exact type string.
  registerPlanEventTypes(bus.registry)

  const invoke = options.invoke ?? localThinking(config, departments.value)
  const perform = createDispatcher(storage)

  /**
   * The executor for one plan.
   *
   * ★ Built per plan rather than once, because two things it does are about
   * *this* plan: the capability it mints names the step, and the decision it
   * records carries the plan's correlation id so the Guardian's own account of
   * itself lands in the plan's causal chain. A shared executor would have to
   * leave both blank, and an explanation would then be missing the half that
   * says why FRIDAY was allowed.
   */
  const executorFor = (planId: string, correlationId: string) =>
    createExecutor({
      registry: registry.value,
      actor: PLANNER,
      principalId,
      perform,

      // ★ The real Guardian, through the real clerk. Not a wrapper, not a
      // narrowed copy, and not a second decision point: the clerk asks,
      // records `guardian.decided`, and raises the approval when the answer is
      // that the owner must be asked.
      authorize: async (input) => {
        // ★ Minted first, and it is NOT permission. A capability says which
        // step this action belongs to — the evidence an agent must carry so
        // that what it does can be tied back to work the owner asked for. The
        // Guardian then decides, and can still say no. Reading this as
        // self-authorization is the misreading worth guarding against, which
        // is why the two lines are adjacent and in this order.
        const permit = options.capabilities.issue({
          principalId: input.principalId,
          issuedTo: input.actor,
          action: input.action,
          resource: input.resource,
          planId,
          planStepId: input.stepId,

          // One step, one use. It cannot be spent on the retry, which asks
          // again and is issued its own.
          constraints: { maxCalls: 1 },
        })

        if (!permit.ok) return permit

        const decided = await authorizing.authorize({
          request: {
            actor: input.actor,
            principalId: input.principalId,
            action: input.action,
            resource: input.resource,
            capability: permit.value.token,
            planId,
            planStepId: input.stepId,
            correlationId: correlationId as CorrelationId,
          },
          explain: explanationFor(input.action, registry.value.actions),
        })

        return decided.ok ? ok(decided.value.decision) : decided
      },
    })

  const session: AskSession = {
    actions: registry.value.actions,

    async propose(utterance) {
      return await propose({ utterance, registry: registry.value, invoke, storage, principalId })
    },

    reopen(planId) {
      return Promise.resolve(reopen({ planId, storage, principalId, registry: registry.value }))
    },

    async run(proposed) {
      const outcome = await runPlan({
        steps: proposed.steps,
        executor: executorFor(proposed.plan.id, proposed.plan.correlationId),
        progress: proposed.progress,
        planId: proposed.plan.id,
        record: recorder({ bus, principalId, correlationId: proposed.plan.correlationId }),
        riskClasses: proposed.riskClasses,
        estimateCents: ESTIMATE_CENTS,
        approvalThresholdCents: config.budgets.planApprovalThresholdCents,
      })

      const saved = save(storage, principalId, proposed.plan.id, outcome.progress)
      if (!saved.ok) return saved

      return await describe({ outcome, proposed, session })
    },

    async approveShape(planId) {
      const current = reopen({ planId, storage, principalId, registry: registry.value })
      if (!current.ok) return current

      const moved = await approvePlan({
        progress: current.value.progress,
        planId,
        record: recorder({ bus, principalId, correlationId: current.value.plan.correlationId }),
      })

      return moved === undefined
        ? err(notWaiting('This plan is not waiting for you to approve its shape.'))
        : persist(storage, principalId, current.value, moved)
    },

    async answerStep(planId, stepId) {
      const current = reopen({ planId, storage, principalId, registry: registry.value })
      if (!current.ok) return current

      const step = current.value.steps.find((candidate) => candidate.id === stepId)

      if (step === undefined) {
        return err(notWaiting('That step is not part of this plan.'))
      }

      const moved = await approveStep({
        progress: current.value.progress,
        step,
        planId,
        record: recorder({ bus, principalId, correlationId: current.value.plan.correlationId }),
      })

      return moved === undefined
        ? err(notWaiting('That step is not waiting for an answer.'))
        : persist(storage, principalId, current.value, moved)
    },

    explain(planId) {
      const reopened = reopen({ planId, storage, principalId, registry: registry.value })
      if (!reopened.ok) return Promise.resolve(reopened)

      return Promise.resolve(explanationOf(storage, reopened.value.plan, bus))
    },
  }

  return ok(session)
}

/** Turns each accepted transition into events on the real bus. */
function recorder(input: {
  bus: EventBus
  principalId: PrincipalId
  correlationId: string
}): (transition: PlanTransition) => Promise<Result<void, FridayError>> {
  return async (transition) => {
    for (const event of eventsFor(transition, {
      actor: PLANNER,
      principalId: input.principalId,
      correlationId: input.correlationId as CorrelationId,
    })) {
      const written = await input.bus.publish(event)
      if (!written.ok) return written
    }

    return ok(undefined)
  }
}

/** Parses the intent, generates the plan, checks it, and writes it down. */
async function propose(input: {
  utterance: string
  registry: Parameters<typeof routePlan>[0]
  invoke: Invoke
  storage: Storage
  principalId: PrincipalId
}): Promise<Result<ProposedRun, FridayError>> {
  const { utterance, registry, invoke, storage, principalId } = input

  const intent = await parseIntent({ utterance, registry, invoke })
  if (!intent.ok) return intent

  const generated = await generatePlan({ utterance, intent: intent.value, registry, invoke })
  if (!generated.ok) return generated

  const validated = validatePlan(generated.value.steps)
  if (!validated.ok) return validated

  // ★ Routing before anything is written down. A plan naming an action no
  // department performs is refused now, while it is still a proposal — not
  // discovered halfway through, with earlier steps already done.
  const routes = routePlan(registry, generated.value.steps)
  if (!routes.ok) return routes

  return write({
    utterance,
    intent: intent.value,
    generated: generated.value,
    routes: routes.value,
    storage,
    principalId,
  })
}

/** Writes the plan and its steps, and returns what is needed to run it. */
function write(input: {
  utterance: string
  intent: Parameters<typeof generatePlan>[0]['intent']
  generated: ProposedPlan
  routes: readonly { readonly capability: { readonly riskClass: RiskClass } }[]
  storage: Storage
  principalId: PrincipalId
}): Result<ProposedRun, FridayError> {
  const { generated, storage, principalId } = input
  const now = Date.now()
  const planId = uuidv7()
  const correlationId = uuidv7()

  const plan: Plan = {
    id: planId,
    principalId,

    // ★ Both, per ADR-0045. The owner's own sentence is what an explanation
    // quotes back; the parsed intent is what the plan was built from. Keeping
    // only the second would leave FRIDAY paraphrasing him to himself.
    utterance: input.utterance,
    intent: input.intent,

    rationale: generated.rationale,
    explanation: null,
    status: 'draft',
    correlationId,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    budgetTokens: null,
    budgetCents: null,
    budgetDeadlineMs: null,
    spentTokens: 0,
    spentCents: 0,
  }

  const created = storage.plans.createPlan(plan)
  if (!created.ok) return created

  const steps: ExecutableStep[] = []

  for (const [index, proposed] of generated.steps.entries()) {
    const route = input.routes[index]
    if (route === undefined)
      return err(fridayError({ code: 'VALIDATION_FAILED', message: 'a step was not routed' }))

    const row: PlanStep = {
      id: proposed.id,
      planId,
      principalId,
      sequence: proposed.sequence,
      dependsOn: [...proposed.dependsOn],
      description: proposed.description,
      actionType: proposed.actionType,
      actionPayload: {},
      department: proposed.department,
      status: 'pending',

      // ★ From the manifest, which is the Guardian's table — never from the
      // planner. Restated here because this is the field where it would erode.
      riskClass: route.capability.riskClass,

      onFailure: proposed.onFailure,
      approvalId: null,
      agentId: null,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      attempt: 0,

      // ★ Derived from the step id, so a resumed plan produces the same key
      // for the same step. That is what stops a crash between doing a thing
      // and recording it from doing the thing twice.
      idempotencyKey: `step:${proposed.id}`,
    }

    const added = storage.plans.addStep(row)
    if (!added.ok) return added

    steps.push({
      id: row.id,
      sequence: row.sequence,
      dependsOn: row.dependsOn,
      description: row.description,
      actionType: row.actionType,
      department: row.department,
      resource: resourceFor(row.actionType),
      onFailure: row.onFailure,
    })
  }

  return ok({
    plan,
    steps,

    // ★ From the manifests, which is to say from the departments — never from
    // the planner. A model that could set its own risk class could talk its
    // way past the plan-approval gate.
    riskClasses: input.routes.map((route) => route.capability.riskClass),
    progress: beginning(steps),
  })
}

/** Reads a plan back off disk, exactly as it was left. */
function reopen(input: {
  planId: string
  storage: Storage
  principalId: PrincipalId
  registry: Parameters<typeof routePlan>[0]
}): Result<ProposedRun, FridayError> {
  const { planId, storage, principalId } = input

  const plan = storage.plans.getPlan({ id: planId, principalId })
  if (!plan.ok) return plan

  if (plan.value === undefined) {
    return err(
      fridayError({
        code: 'NOT_FOUND',
        message: `FRIDAY has no plan with that id.`,
        detail: { planId },
      }),
    )
  }

  const rows = storage.plans.listSteps({ planId, principalId })
  if (!rows.ok) return rows

  const loaded = storage.plans.loadProgress({ planId, principalId })
  if (!loaded.ok) return loaded

  if (loaded.value === undefined) {
    return err(
      fridayError({
        code: 'NOT_FOUND',
        message: 'That plan has no recorded progress.',
        detail: { planId },
      }),
    )
  }

  const steps: ExecutableStep[] = rows.value.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    dependsOn: row.dependsOn,
    description: row.description,
    actionType: row.actionType,
    department: row.department,
    resource: resourceFor(row.actionType),
    onFailure: row.onFailure,
  }))

  // ★ Re-routed against the manifests as they are NOW, not as they were when
  // the plan was made. A capability reclassified upward between Monday and
  // Thursday takes effect on Thursday — and a step whose department has since
  // been removed makes the plan unresumable rather than silently skippable.
  const routes = routePlan(input.registry, steps)
  if (!routes.ok) return routes

  return ok({
    plan: plan.value,
    steps,
    riskClasses: routes.value.map((route) => route.capability.riskClass),
    progress: fromStored(loaded.value),
  })
}

/** Writes where the plan got to, so a restart can pick it up. */
function save(
  storage: Storage,
  principalId: PrincipalId,
  planId: string,
  progress: PlanProgress,
): Result<void, FridayError> {
  const saved = storage.plans.saveProgress({ planId, principalId, ...toStored(progress) })

  return saved.ok ? ok(undefined) : saved
}

function persist(
  storage: Storage,
  principalId: PrincipalId,
  proposed: ProposedRun,
  progress: PlanProgress,
): Result<ProposedRun, FridayError> {
  const saved = save(storage, principalId, proposed.plan.id, progress)

  return saved.ok ? ok({ ...proposed, progress }) : saved
}

/** Turns where the run stopped into something the caller can say out loud. */
async function describe(input: {
  outcome: RunOutcome
  proposed: ProposedRun
  session: AskSession
}): Promise<Result<AskOutcome, FridayError>> {
  const { outcome, proposed } = input

  if (outcome.kind === 'awaiting_plan_approval') {
    return ok({
      kind: 'awaiting_plan_approval',
      because:
        outcome.because === 'over_cost_threshold'
          ? 'this would cost enough that FRIDAY wants you to see the plan first'
          : 'part of this is consequential, so FRIDAY wants you to see the plan first',
    })
  }

  if (outcome.kind === 'awaiting_approval') {
    const step = proposed.steps.find((candidate) => candidate.id === outcome.stepId)

    return ok({
      kind: 'awaiting_approval',
      stepId: outcome.stepId,
      description: step?.description ?? 'one step of this plan',
    })
  }

  if (outcome.kind === 'failed') {
    return ok({ kind: 'failed', because: outcome.because, error: outcome.error })
  }

  const explained = await input.session.explain(proposed.plan.id)

  return explained.ok ? ok({ kind: 'completed', explanation: explained.value }) : explained
}

/** Reads the plan's own events back and composes the account of them. */
function explanationOf(
  storage: Storage,
  plan: Plan,
  bus: EventBus,
): Result<PlanExplanation, FridayError> {
  const events = storage.events.readByCorrelation({
    correlationId: plan.correlationId,
    principalId: plan.principalId,
  })

  if (!events.ok) return events

  return composeExplanation({
    plan,
    events: events.value,
    depth: 'standard',
    describe: (type) =>
      bus.registry.list().find((definition) => definition.type === type)?.description,
  })
}

/**
 * What the owner is told when a step needs their answer.
 *
 * ★ Deliberately thin, and honest about being thin. Chapter 19 wants the
 * preview to be the connector's dry run rather than a description of intent —
 * and the departments that ship today produce no artifact to preview, so this
 * says `none` rather than inventing one. When a connector arrives that can show
 * the owner what it is about to send, its preview goes here.
 */
function explanationFor(action: string, actions: readonly string[]) {
  return {
    title: `FRIDAY wants to ${action}`,
    explanation: {
      what: `Run ${action}.`,
      why: 'It is a step of a plan you asked for.',
      confidence: 1,
      risks: ['FRIDAY cannot preview this action, so you are approving it by name.'],
      alternatives: [
        actions.length > 1 ? 'Decline, and the plan stops here.' : 'Decline and nothing happens.',
      ],
    },
    preview: { kind: 'none' as const, content: '' },
    impact: {
      reversible: false,
      dataLeavesDevice: false,
      dataCategories: [],
      estimatedCostCents: null,
    },
  }
}

/**
 * The thing an action happens to, named the way the Guardian names things.
 *
 * ★ Derived from the action rather than carried on the step row, so the
 * resource a rule is matched against cannot drift from the action it belongs
 * to. `diagnostics.self-check.run` is a thing done to `diagnostics:self-check`
 * — and a step that stored its own resource string could name a different one.
 */
function resourceFor(actionType: string): string {
  const [scheme, ...rest] = actionType.split('.')

  return rest.length === 0 ? `${scheme}:${scheme}` : `${scheme}:${rest.join('/')}`
}

/**
 * FRIDAY thinking locally, through the real router.
 *
 * ★ The router is real even though the provider is not. Sensitivity routing
 * and the budget apply to planning exactly as they apply to anything else, so
 * the day a paid provider is configured, nothing above this line changes —
 * which is the only way to know the abstraction was ever real.
 */
function localThinking(config: FridayConfig, departments: readonly DepartmentManifest[]): Invoke {
  const router = createModelRouter({
    providers: [createFakeProvider({ respond: createScriptedPlanner(departments) })],

    // ★ The real per-plan ceiling from configuration, not a number chosen
    // here. Planning spends from the same budget the work does.
    budget: createNestedBudget({
      levels: [{ name: 'plan', limitCents: config.budgets.perPlanCents, spentCents: 0 }],
    }),

    estimateCents: () => 0,
  })

  return (request) => router.invoke(request)
}

function notWaiting(message: string): FridayError {
  return fridayError({ code: 'APPROVAL_ALREADY_RESOLVED', message })
}
