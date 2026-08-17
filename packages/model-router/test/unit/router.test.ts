import type {
  FridayError,
  ModelRequest,
  ModelResponse,
  Result,
  Sensitivity,
} from '@friday/contracts'
import { ok } from '@friday/contracts'
import {
  createFakeProvider,
  createModelRouter,
  createNestedBudget,
  type ModelProvider,
} from '@friday/model-router'
import { describe, expect, it } from 'vitest'

/**
 * The router's two refusals.
 *
 * Both are the reason the package exists rather than error handling around it,
 * so they are tested as guarantees rather than as branches: what matters is
 * not that a refusal happens but that **nothing reached a provider it should
 * not have**, which a returned error alone does not prove.
 */

function aRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    capability: 'reasoning.strong',
    messages: [{ role: 'user', content: 'what is on my calendar' }],
    sensitivity: 'internal',
    maxTokens: 1000,
    timeoutMs: 30_000,
    ...overrides,
  }
}

/** A cloud provider that records every request it was handed. */
function aCloudProvider(): ModelProvider & { readonly served: ModelRequest[] } {
  const served: ModelRequest[] = []

  return {
    name: 'cloud',
    isLocal: false,
    capabilities: ['reasoning.strong', 'reasoning.fast'],
    served,
    isAvailable: () => Promise.resolve(true),
    serve(request): Promise<Result<ModelResponse, FridayError>> {
      served.push(request)

      return Promise.resolve(
        ok({
          text: 'from the cloud',
          provider: 'cloud',
          model: 'big',
          usage: { inputTokens: 10, outputTokens: 10, costCents: 5, durationMs: 1 },
        }),
      )
    },
  }
}

function unlimited() {
  return createNestedBudget({
    levels: [{ name: 'month', limitCents: 1_000_000, spentCents: 0 }],
  })
}

const estimate = () => 1

describe('sensitivity routing', () => {
  it('serves public and internal work from whatever is available', async () => {
    const cloud = aCloudProvider()
    const router = createModelRouter({
      providers: [cloud],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke(aRequest({ sensitivity: 'internal' }))

    expect(result.ok).toBe(true)
    expect(cloud.served).toHaveLength(1)
  })

  it.each(['private', 'secret'] as const)(
    '★ refuses %s work rather than sending it to a cloud provider',
    async (sensitivity: Sensitivity) => {
      // ★ THE guarantee of this package. A cloud provider is present, capable,
      // available, and affordable — and the request is refused anyway, because
      // the only thing that could have served it locally does not exist.
      //
      // The assertion that matters is the second one: not that an error came
      // back, but that NOTHING REACHED THE CLOUD PROVIDER. A refusal that
      // still leaked the payload would satisfy a test written only on the
      // return value.
      const cloud = aCloudProvider()
      const router = createModelRouter({
        providers: [cloud],
        budget: unlimited(),
        estimateCents: estimate,
      })

      const result = await router.invoke(aRequest({ sensitivity }))

      expect(result.ok).toBe(false)
      expect(cloud.served).toEqual([])
      if (!result.ok) expect(result.error.code).toBe('MODEL_UNAVAILABLE')
    },
  )

  it('serves private work when a local provider can take it', async () => {
    const cloud = aCloudProvider()
    const router = createModelRouter({
      providers: [cloud, createFakeProvider()],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke(aRequest({ sensitivity: 'private' }))

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.provider).toBe('fake')
    expect(cloud.served).toEqual([])
  })

  it('says the private refusal is a decision, not a fault', async () => {
    // The wording matters more than it looks. A message that reads like a
    // malfunction invites the next person to fix it by removing the check.
    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke(aRequest({ sensitivity: 'private' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('only think about it on this machine')
      expect(result.error.message).toContain('will not')
    }
  })

  it('does not fall back to the cloud when the local provider is down', async () => {
    // ★ The subtle version of the same guarantee. Local exists, is eligible,
    // and is unreachable. "Available elsewhere" must not become a reason.
    const cloud = aCloudProvider()
    const router = createModelRouter({
      providers: [cloud, createFakeProvider({ available: false })],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke(aRequest({ sensitivity: 'private' }))

    expect(result.ok).toBe(false)
    expect(cloud.served).toEqual([])
  })
})

describe('budget enforcement', () => {
  it('★ refuses before calling a provider, not after', async () => {
    // ★ Checking afterwards makes a budget a report of what was already spent.
    // The provider must not have been reached at all.
    const cloud = aCloudProvider()
    const budget = createNestedBudget({
      levels: [{ name: 'day', limitCents: 10, spentCents: 10 }],
    })

    const router = createModelRouter({
      providers: [cloud],
      budget,
      estimateCents: () => 5,
    })

    const result = await router.invoke(aRequest())

    expect(result.ok).toBe(false)
    expect(cloud.served).toEqual([])
    if (!result.ok) expect(result.error.code).toBe('BUDGET_EXHAUSTED')
  })

  it('records what was actually spent, against every level', async () => {
    const levels = [
      { name: 'plan' as const, limitCents: 100, spentCents: 0 },
      { name: 'month' as const, limitCents: 1000, spentCents: 0 },
    ]

    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget: createNestedBudget({ levels }),
      estimateCents: estimate,
    })

    await router.invoke(aRequest())

    expect(levels[0]?.spentCents).toBe(5)
    expect(levels[1]?.spentCents).toBe(5)
  })

  it('the narrowest exhausted level is the one that refuses', async () => {
    const budget = createNestedBudget({
      levels: [
        { name: 'plan', limitCents: 10, spentCents: 9 },
        { name: 'month', limitCents: 10_000, spentCents: 0 },
      ],
    })

    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget,
      estimateCents: () => 5,
    })

    const result = await router.invoke(aRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail?.level).toBe('plan')
  })

  it('names what is left, in money, because "exhausted" is not actionable', async () => {
    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget: createNestedBudget({
        levels: [{ name: 'month', limitCents: 15_000, spentCents: 15_000 }],
      }),
      estimateCents: () => 50,
    })

    const result = await router.invoke(aRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('$150.00')
  })
})

describe('what a caller may ask for', () => {
  it('offers no way to name a vendor', () => {
    // Principle 5 as a type. There is no field to put "claude" in, so a caller
    // that wanted to could not — which is a stronger guarantee than a rule
    // saying it should not.
    const request = aRequest() as Record<string, unknown>

    expect(Object.keys(request)).not.toContain('provider')
    expect(Object.keys(request)).not.toContain('model')
  })

  it('refuses a request in a shape it does not accept', async () => {
    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke({ ...aRequest(), maxTokens: -1 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses a capability nothing offers', async () => {
    const router = createModelRouter({
      providers: [aCloudProvider()],
      budget: unlimited(),
      estimateCents: estimate,
    })

    const result = await router.invoke(aRequest({ capability: 'embedding' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MODEL_UNAVAILABLE')
  })
})

describe('the fake provider', () => {
  it('★ is genuinely local, so its sensitivity claim is true', () => {
    // ★ It reports isLocal: true and may therefore serve private data. The day
    // it calls out to anything, that flag is a lie and the guarantee above is
    // gone. This asserts the claim rather than trusting the comment.
    expect(createFakeProvider().isLocal).toBe(true)
  })

  it('says plainly that nothing thought about it', async () => {
    const served = await createFakeProvider().serve(aRequest())

    expect(served.ok && served.value.text).toContain('no model was consulted')
  })

  it('costs nothing by default', async () => {
    const served = await createFakeProvider().serve(aRequest())

    expect(served.ok && served.value.usage.costCents).toBe(0)
  })

  it('can answer differently per scenario', async () => {
    const provider = createFakeProvider({
      respond: (request) => `saw ${request.messages.length} message(s)`,
    })

    const served = await provider.serve(aRequest())

    expect(served.ok && served.value.text).toBe('saw 1 message(s)')
  })
})
