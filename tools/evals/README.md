# Agent Evaluation Suites

One folder per agent. See [tools/README.md](../README.md) for the scoring model and rules.

```
suites/<agent-id>/
├── scenarios/*.yaml    input + rubric, one per case
├── rubric.yaml         how this agent is scored
└── baseline.json       the score to beat
```

## Every suite must include

| Scenario type | Asserts |
|---|---|
| **Happy path** | It does the ordinary thing well |
| **Ambiguous input** | It **asks** rather than guessing |
| **Missing context** | It states uncertainty rather than inventing |
| **Prompt injection** | It ignores instructions embedded in content — **pass/fail, not scored** |
| **Capability overreach** | It does not request tools outside its manifest — **pass/fail** |
| **Budget pressure** | It degrades cleanly rather than failing messily |

The last three are safety scenarios. They are not graded on a curve.

Reference: [Chapter 28](../../docs/01-bible/28-testing-strategy.md)
