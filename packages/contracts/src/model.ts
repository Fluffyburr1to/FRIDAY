import { z } from 'zod'
import { SensitivitySchema } from './sensitivity.js'

/**
 * What a caller asks a model for — and what never appears in the asking.
 *
 * ★ **No vendor name, no model name.** A caller describes the *capability* it
 * needs — strong reasoning, up to 8000 tokens, this data is sensitive — and
 * the router selects a provider by policy. This is Principle 5 ("FRIDAY should
 * never depend on one vendor, one technology, or one AI provider") expressed
 * as a type: there is nowhere in this shape to write `claude` or `gpt`, so a
 * caller that wanted to could not.
 *
 * Enforced twice over, because a rule enforced once erodes: `dependency-cruiser`
 * denies every AI vendor SDK outside `packages/model-router`, and this shape
 * gives callers no way to express a preference even if one were installed.
 *
 * Reference: docs/adr/0008-model-router.md · docs/01-bible/11-agent-framework.md
 */

/**
 * What kind of thinking is wanted.
 *
 * Deliberately coarse. A finer scale would be a vendor's capability ladder
 * wearing a generic name, and it would need revising every time a vendor
 * renamed a tier — which is the lock-in ADR-0008 exists to prevent.
 */
export const MODEL_CAPABILITIES = [
  'reasoning.strong',
  'reasoning.fast',
  'classification',
  'embedding',
] as const

export const ModelCapabilitySchema = z.enum(MODEL_CAPABILITIES)
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>

/**
 * A message in a request.
 *
 * ★ `content` is data, never instructions, when `role` is `context`. The
 * distinction is structural rather than advisory: Chapter 11's first defence
 * against prompt injection is that untrusted material is delimited and
 * labelled rather than concatenated into the instruction section, and a
 * provider adapter is required to keep them apart.
 */
export const MODEL_ROLES = ['system', 'user', 'context'] as const

export const ModelRoleSchema = z.enum(MODEL_ROLES)
export type ModelRole = z.infer<typeof ModelRoleSchema>

export const ModelMessageSchema = z.object({
  role: ModelRoleSchema,
  content: z.string().min(1).max(1_000_000),
})

/** One turn of input to a model. */
export type ModelMessage = z.infer<typeof ModelMessageSchema>

export const ModelRequestSchema = z.object({
  /** What kind of thinking, not which vendor's. */
  capability: ModelCapabilitySchema,

  messages: z.array(ModelMessageSchema).min(1).max(64),

  /**
   * ★ How closely this data must be held.
   *
   * The router **fails closed** on it: `private` and above are refused rather
   * than downgraded to a cloud provider when no local one is available. That
   * refusal is the mechanism that makes Article IV's "prefer local processing"
   * a guarantee instead of a preference.
   */
  sensitivity: SensitivitySchema,

  maxTokens: z.int().positive().max(200_000),

  /** Wall-clock ceiling. Every external call has a timeout (Chapter 30). */
  timeoutMs: z.int().positive().max(600_000),

  /**
   * Which prompt produced this, recorded on the invocation so past behaviour
   * can be traced to the exact text that caused it (Chapter 11, rule 5).
   */
  promptVersion: z.string().min(1).max(128).optional(),
})

/** A request for thinking, described by capability rather than by vendor. */
export type ModelRequest = z.infer<typeof ModelRequestSchema>

export const ModelUsageSchema = z.object({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),

  /**
   * What it cost, in cents, as reported by the provider that served it.
   *
   * Integer cents rather than a float: money that accumulates in floating
   * point drifts, and this number is what a budget is checked against.
   */
  costCents: z.int().nonnegative(),

  durationMs: z.int().nonnegative(),
})

/** What one invocation consumed. */
export type ModelUsage = z.infer<typeof ModelUsageSchema>

export const ModelResponseSchema = z.object({
  text: z.string(),

  /**
   * Which provider and model actually served it.
   *
   * ★ Recorded, never requested. A caller cannot ask for this value; it can
   * only read it afterwards, which is the difference between accounting and
   * vendor selection.
   */
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),

  usage: ModelUsageSchema,
})

/** What a model returned, and what serving it cost. */
export type ModelResponse = z.infer<typeof ModelResponseSchema>
