import { describeConnectorContract } from './conformance.js'
import {
  createExampleConnector,
  EXAMPLE_MANIFEST,
  EXAMPLE_SAMPLES,
  exampleFixtures,
} from './example-connector.js'

/**
 * The conformance suite, run against a connector for a service that does not
 * exist.
 *
 * This proves the suite runs end to end before any real connector depends on
 * it. `conformance.test.ts` is the other half: it proves the suite FAILS when
 * a connector misbehaves, which is the part that makes passing mean anything.
 */
describeConnectorContract({
  manifest: EXAMPLE_MANIFEST,
  samples: EXAMPLE_SAMPLES,
  respond: exampleFixtures,
  create: createExampleConnector,
})
