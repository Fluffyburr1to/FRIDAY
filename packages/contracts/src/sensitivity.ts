import { z } from 'zod'

/**
 * Sensitivity — declared on every schema that crosses a boundary.
 *
 * This one field drives three separate mechanisms, which is why Chapter 09
 * makes it mandatory rather than optional: field-level encryption in storage,
 * redaction in the system log, and whether a value may be sent to a cloud
 * model. A field nobody classified is a field stored in the clear.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 22
 */
export const SENSITIVITY_LEVELS = ['public', 'internal', 'private', 'secret'] as const

export const SensitivitySchema = z.enum(SENSITIVITY_LEVELS)

/** How closely a value must be held. */
export type Sensitivity = z.infer<typeof SensitivitySchema>

/**
 * Rank, ascending. Not exported — callers compare through `isAtLeast`, so the
 * numbers stay an implementation detail and cannot end up persisted anywhere.
 * A number in the database would silently change meaning if a level were ever
 * inserted into the middle of the scale.
 */
const RANK: Readonly<Record<Sensitivity, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  secret: 3,
}

/**
 * Compares two sensitivity levels.
 *
 * @param level - The level being tested.
 * @param floor - The level to compare against.
 * @returns True when `level` is at least as sensitive as `floor`.
 */
export function isAtLeastAsSensitiveAs(level: Sensitivity, floor: Sensitivity): boolean {
  return RANK[level] >= RANK[floor]
}

/**
 * Whether a value at this level must be encrypted before it reaches disk.
 *
 * `private` is encrypted with a key from the Keychain. `secret` never reaches
 * the database at all — it lives in the Keychain and the database holds a
 * reference — so a `secret` value arriving at the storage layer is a bug, and
 * storage rejects it rather than encrypting it.
 *
 * @param level - The declared sensitivity of the value.
 * @returns True for `private` only.
 */
export function requiresFieldEncryption(level: Sensitivity): boolean {
  return level === 'private'
}

/**
 * Whether a value at this level may leave the machine.
 *
 * Article IV. The model router consults this before any cloud call; nothing
 * above `internal` is eligible without an explicit, separately recorded
 * decision by the owner.
 *
 * @param level - The declared sensitivity of the value.
 * @returns True for `public` and `internal`.
 */
export function mayLeaveTheMachine(level: Sensitivity): boolean {
  return !isAtLeastAsSensitiveAs(level, 'private')
}
