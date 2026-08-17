# @friday/diagnostics

**FRIDAY watching herself — and proposing, never implementing.**

Milestone: **M3**

## Charter

Principle 8: *"She should recommend improvements. **She should never silently implement them.**"*

Three functions: **health** (is she working now?), **self-checks** (is she internally consistent?),
and **improvement proposals** (could she be better?).

## What is built

**Runtime vitals only** — CPU, memory, disk, and uptime for the HUD's vitals panel, scoped to the
FRIDAY process per [Chapter 29](../../docs/01-bible/29-monitoring-observability.md) and
[ADR-0042](../../docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md). Host equivalents —
`os.freemem()`, `os.loadavg()`, `os.uptime()` — are banned, and a test asserts it. A vital that
cannot be measured returns an `absent` reading with its reason, so one unreadable metric degrades one
row rather than blanking the panel.

Self-checks and improvement proposals arrive with the milestone that gives FRIDAY something to check
and something to propose about.

## What lives here

- Health aggregation across all components
- Scheduled self-checks — audit chain integrity, database integrity, orphaned memories, expiring
  credentials and grants, dead-letter depth, stuck plans, disk space, **backup restorability**,
  budget pace, egress violations
- Improvement proposal generation, with **mandatory evidence**
- Approval-fatigue detection (approvals/day, median time-to-decision)

## What FRIDAY may and may not do

| Action | Allowed |
|---|---|
| Observe, measure, analyze | Yes |
| File a proposal | Yes |
| Adjust internal caches, retry timing, her own scheduling | Yes — no user-visible effect |
| Change configuration, prompts, or code | **No — propose** |
| **Change Guardian policies** | **Never. Forbidden outright, not merely gated.** |
| Temporarily disable a failing connector | Yes — reversible and reported |

## Rules

1. **`evidence` is mandatory** and must reference real event IDs and measurements. Without it,
   proposals become a model's intuitions dressed as findings.
2. **`risks` is mandatory.** A proposal listing only benefits is advocacy, not analysis.
3. **Rejected proposals are remembered** and not re-raised unless the evidence changes materially.

Reference: [Chapter 23](../../docs/01-bible/23-diagnostics-system.md)
