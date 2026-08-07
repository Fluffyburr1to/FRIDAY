# tools/ — Development Machinery

Things that build, check, and evaluate FRIDAY. **None of this ships.** No runtime code imports from
here.

| Folder | Contains |
|---|---|
| **tsconfig/** | Shared TypeScript configurations that every package extends |
| **lint-config/** | Shared Biome configuration |
| **vitest-config/** | Shared Vitest presets — the two test tiers, timeouts, coverage thresholds |
| **scripts/** | Setup, migration, release, staging refresh, maintenance |
| **evals/** | ★ The agent evaluation harness |

**`tools/<tool>-config/` holds shared configuration for one tool, named after that tool.** Adding a
sibling when a new tool needs shared settings follows [Chapter 03](../docs/01-bible/03-repository-structure.md)
and needs no ADR — `playwright-config/` and `vite-config/` are expected at M4. The pattern was
settled in [ADR-0017](../docs/adr/0017-shared-tool-configuration-packages.md).

They exist for one reason: with twenty packages ahead, configuration that is copied rather than
shared drifts — and the drift is invisible, because a package whose coverage threshold has quietly
slipped to 50% still shows a green tick.

---

## tools/evals — the unusual one

This folder has no equivalent in a normal project and it is one of the most important here.

**Ordinary code is deterministic.** Same input, same output — so a test asserts equality.

**Agents are not.** The same request produces different phrasing, different tool sequences, and
occasionally different conclusions. `assert(output === expected)` is not merely inadequate; it is
the wrong instrument entirely. It fails on a perfectly good result and passes on a subtly bad one
that happened to match.

So agents are **graded**, not asserted.

```
tools/evals/suites/<agent>/
├── scenarios/
│   ├── 001-simple-case.yaml
│   ├── 002-ambiguous-input.yaml        ← should ASK, not guess
│   ├── 003-injection-attempt.yaml      ← should IGNORE embedded instructions
│   └── 004-missing-context.yaml        ← should state uncertainty
├── rubric.yaml
└── baseline.json                       ← the score to beat
```

### Scoring

| Method | Checks | Weight |
|---|---|---|
| **Deterministic assertions** | Valid output schema? Within budget? Only permitted tools? **Did it ask rather than guess where required?** | 40% |
| **LLM-as-judge** | Tone, accuracy, appropriate concision | 40% |
| **Regression comparison** | Did this change alter behavior on previously-good cases? | 20% |

The deterministic 40% is weighted heavily on purpose. *"Did the agent ask instead of guessing about
an ambiguous recipient"* is a **checkable fact**, not a judgment call — and it is exactly the
behavior Principle 1 requires. Wherever a quality requirement can be expressed as a deterministic
assertion, it is.

### Rules

- **Every scenario runs three times.** High variance is itself a finding — an agent that behaves
  inconsistently is unreliable regardless of its average score (Principle 3: trust comes from
  predictability).
- **Safety scenarios are pass/fail, not scored.** Prompt injection resistance, staying inside
  declared capabilities, and asking rather than guessing on consequential ambiguity are not graded
  on a curve.
- **Baselines are updated deliberately**, in their own commit, with written justification — never
  silently as part of another change.
- **Cost is capped** at roughly $2 per full run, which is why evals run conditionally rather than on
  every commit.

Without this, there is no way to know whether a change to a prompt made FRIDAY better or worse — and
prompt changes are the changes made most often.

Reference: [Chapter 28](../docs/01-bible/28-testing-strategy.md).
