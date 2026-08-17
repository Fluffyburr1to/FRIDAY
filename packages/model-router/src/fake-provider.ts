import { MODEL_CAPABILITIES, type ModelRequest, type ModelResponse, ok } from '@friday/contracts'
import type { ModelProvider } from './provider.js'

/**
 * A provider that answers without a model behind it.
 *
 * ★ **Not a test double — a shipped provider, and it earns its place twice.**
 *
 * It is how M5 is built and demonstrated end to end at zero cost and with no
 * credentials: every other part of the path — the Guardian, budgets, the plan
 * state machine, suspension across an approval — is exercised identically
 * whether the thinking is real or scripted, and none of them should have to
 * wait on a billing decision to be written.
 *
 * It is also the honest answer to *"is the router actually vendor-neutral?"*.
 * A router with one real provider has an untested abstraction; a router that
 * serves a scripted provider and a real one through the same port has a
 * demonstrated one.
 *
 * ★ **It reports `isLocal: true`, and that is a true statement rather than a
 * convenience.** Nothing leaves the machine, so it may serve `private` data.
 * The day it is made to call out to anything, this flag is a lie and the
 * sensitivity guarantee is gone — which is why it is asserted in a test.
 */
export interface FakeProviderOptions {
  /**
   * What to answer. A function so a scenario can respond to what it was asked
   * — a fixed string makes every eval scenario the same test.
   */
  readonly respond?: (request: ModelRequest) => string

  /** Whether it is reachable. `false` exercises the unavailable path. */
  readonly available?: boolean

  /** What it claims to cost. Zero by default: nothing is being bought. */
  readonly costCents?: number
}

/**
 * Creates the scripted provider.
 *
 * @param options - The response function, availability, and claimed cost.
 * @returns A provider that serves every capability, locally, for nothing.
 */
export function createFakeProvider(options: FakeProviderOptions = {}): ModelProvider {
  const respond = options.respond ?? defaultResponse
  const available = options.available ?? true
  const costCents = options.costCents ?? 0

  return {
    name: 'fake',
    isLocal: true,
    capabilities: MODEL_CAPABILITIES,

    isAvailable() {
      return Promise.resolve(available)
    },

    serve(request) {
      const text = respond(request)

      const response: ModelResponse = {
        text,
        provider: 'fake',
        model: 'scripted',
        usage: {
          // Not a token count. A stable, cheap proxy so budget arithmetic has
          // something non-zero to work on without pretending to be a tokenizer
          // — a fake tokenizer would be a number that looks measured.
          inputTokens: request.messages.reduce(
            (total, message) => total + message.content.length,
            0,
          ),
          outputTokens: text.length,
          costCents,
          durationMs: 0,
        },
      }

      return Promise.resolve(ok(response))
    },
  }
}

/** Says plainly that nothing thought about this. */
function defaultResponse(request: ModelRequest): string {
  return `[fake:${request.capability}] no model was consulted`
}
