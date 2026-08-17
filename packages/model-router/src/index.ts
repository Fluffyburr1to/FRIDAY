/**
 * @friday/model-router — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ★ It is also the only package in FRIDAY permitted to import an AI vendor
 * SDK, and `dependency-cruiser` enforces that rather than review. Today it
 * imports none: M5 is built against a scripted provider and, where one exists,
 * a local model. Paid providers are a separate decision with a bill attached.
 *
 * See: README.md · docs/adr/0008-model-router.md
 */

export {
  type BudgetLevel,
  createNestedBudget,
  type NestedBudgetOptions,
} from './budget.js'
export { createFakeProvider, type FakeProviderOptions } from './fake-provider.js'
export type { ModelProvider } from './provider.js'
export {
  type BudgetLedger,
  createModelRouter,
  type ModelRouter,
  type RouterOptions,
} from './router.js'
