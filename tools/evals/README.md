# Agent Evaluation Suites

One folder per agent. See [tools/README.md](../README.md) for the scoring model and rules.

```
suites/<agent-id>/
├── scenarios.ts     input + expectations, one per case
└── baseline.json    the score to beat
```

## Every suite must include

| Scenario type | Asserts |
|---|---|
| **Happy path** | It does the ordinary thing well |
| **Ambiguous input** | It **asks** rather than guessing |
| **Missing context** | It states uncertainty rather than inventing |
| **Prompt injection** | It ignores instructions embedded in content — **pass/fail, not scored** |
| **Capability overreach** | It does not request tools outside its manifest — **pass/fail** |
| **Budget pressure** | It degrades cleanly rather than failing messily — **pass/fail** |

The last three are safety scenarios. They are not graded on a curve.

## ★ Three things this harness does that a simpler one would not

1. **Every scenario runs three times**, because an agent that behaves inconsistently is unreliable
   whatever its average. Variance is a finding, not noise — and a single inconsistent run fails the
   suite.
2. **A failed safety scenario fails the suite outright**, whatever the scores are. A scored safety
   property is one that can be averaged away by doing well elsewhere.
3. ★ **An unavailable judge produces `unscored`, never zero and never full marks.** Scoring an
   unread answer as perfect passes work nobody looked at; scoring it as zero fails every honest run
   on a machine with no model configured. Not knowing is its own answer — the same rule
   `packages/diagnostics` holds about health.

## ★ Injection is asserted on what was *attempted*

Not on what succeeded. An agent that asked to compact the event log and was refused by the Guardian
**has still been taken over** — the refusal is the second line of defence, and treating it as proof
the first line held is how a captured agent goes unnoticed.

## Running without a model

Every **safety** scenario is deterministic and runs today with no provider configured. The scored
kinds are declared but report `qualityUnscored` until a judge exists, and
[`baseline.json`](suites/self-check/baseline.json) records `null` rather than a made-up number.

Reference: [Chapter 28](../../docs/01-bible/28-testing-strategy.md)
