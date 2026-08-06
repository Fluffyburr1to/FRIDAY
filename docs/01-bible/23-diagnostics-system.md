# 23 — Diagnostics System

> **Governing provisions:** Constitution Article VII (Reliability), **Article VIII (Learning)**,
> Article II (Transparency); Manifesto Principle 8 (Continuous Improvement), Principle 9 (Fail
> Gracefully); Core Value 7, Core Value 8.

---

## In plain language

Diagnostics is FRIDAY checking her own health and noticing when she could be better.

Your Manifesto's Principle 8 is unusually specific about this:

> *"FRIDAY should constantly look for better ways to operate. She should discover bugs, performance
> issues, architectural improvements, new technologies, better workflows, repetitive tasks. She
> should recommend improvements. **She should never silently implement them.**"*

That last sentence is the whole design. FRIDAY watches herself, forms opinions about what should
change, and then **stops and tells you**. She does not fix it. She does not "helpfully" adjust a
setting. She writes up what she found and waits.

There is a real tension here that is worth naming. A system that notices a hundred small problems
and reports all of them is a system you will stop listening to — the same rubber-stamp failure as
approvals ([Chapter 19](19-approval-system.md)). So diagnostics has two jobs that pull against each
other: notice everything, and report almost nothing. The design below is mostly about the second.

---

## Recommendation

Three distinct functions in `packages/diagnostics`, plus an Operations department that acts on them:

| Function | Question | Timescale |
|---|---|---|
| **Health** | Is FRIDAY working right now? | Continuous |
| **Self-check** | Is FRIDAY internally consistent? | Scheduled |
| **Improvement** | Could FRIDAY be better? | Continuous observation, periodic reporting |

---

## Health

Every component implements a uniform health interface:

```
health(): { status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown',
            detail: string,        ← plain language
            checkedAt, latencyMs, metrics }
```

Aggregated into a system status the dashboard shows at all times.

**Health checks must be cheap and must not have side effects.** A health check that costs money (a
model call) or writes data is a health check that becomes a problem at scale. Connectors probe with
their cheapest read operation; the kernel checks queue depths and database responsiveness.

**Health status is honest about `unknown`.** A component that has not reported recently is `unknown`,
not `healthy`. Assuming health from silence is how outages go unnoticed.

The dashboard renders this as a live organizational chart — FRIDAY's departments, connectors, and
kernel, each showing status. This is Article II applied to FRIDAY herself: *"is she healthy right
now?"* answerable at a glance without asking.

---

## Self-checks

Scheduled integrity verification. These catch the class of problem that does not announce itself.

| Check | Frequency | Detects |
|---|---|---|
| **Audit chain integrity** | Daily | Tampering, corruption, buggy writes |
| Database integrity (`PRAGMA integrity_check`) | Daily | File corruption |
| Orphaned memories (no `source_event_id`) | Daily | Provenance failures — see [Chapter 16](16-memory-system.md) |
| Expired credentials approaching expiry | Hourly | Auth failures before they happen |
| Standing grants expiring within 7 days | Daily | Silent capability loss |
| Dead-letter queue depth | Hourly | Failing subscribers |
| Stuck plans (`running` beyond deadline) | Every 15 min | Orchestration bugs |
| Disk space on all volumes | Hourly | The failure that stops the audit trail |
| Backup freshness and restorability | Daily | The worst discovery to make during a disaster |
| Dependency vulnerabilities | Daily | Supply chain (T2) |
| Egress allowlist violations | Continuous | Compromise, misconfiguration |
| Budget consumption vs. pace | Hourly | Runaway cost before the bill |

**The audit chain check is the most important one.** If FRIDAY's audit trail can be silently
modified, every guarantee in this Bible is void. Verifying it daily and alerting immediately on
failure is what makes the trail trustworthy rather than merely present.

**Backup restorability is the second most important.** A backup that has never been restored is a
hypothesis. The check performs an actual restore into a temporary location and verifies integrity —
see [Chapter 34](34-disaster-recovery.md).

---

## Improvement proposals — Article VIII implemented

This is where diagnostics becomes what the Manifesto asks for.

### What FRIDAY watches

| Category | Signal | Example finding |
|---|---|---|
| Errors | Recurring failures | "The Gmail connector has failed 14 times this week, always on attachments over 10 MB." |
| Performance | Latency regression | "Memory recall latency has risen 40% over three weeks as the corpus grew." |
| Cost | Spend anomalies | "The summarization agent uses a strong model for a task a cheap one handles as well." |
| Friction | Repeated manual action | "You have approved 23 nearly identical calendar events. A standing grant would save ~20 interruptions/month." |
| Attention | Approval fatigue | "Approvals are averaging 14/day, above the healthy threshold, and median decision time has fallen to 2.1s." |
| Architecture | Structural strain | "Three departments now request the same capability. It may belong in a shared package." |
| Ecosystem | Better options | "A newer model would reduce drafting cost by ~60% at comparable quality on our eval suite." |

### The proposal

Every proposal is a structured record, and the required fields are the discipline:

```
ImprovementProposal
├── title, category, severity
├── evidence[]        ← ★ specific events and metrics, with IDs. Never "it seems like."
├── analysis          what is happening and why
├── recommendation    what to do
├── alternatives[]    what else was considered, and why not
├── effort            estimated
├── impact            estimated, with a confidence level
├── risks[]           what could go wrong if we do this
└── status            proposed | accepted | rejected | deferred | implemented
```

**`evidence` is mandatory and must reference real event IDs and measurements.** This is the rule
that keeps proposals from becoming a language model's vague intuitions dressed up as findings. If
FRIDAY cannot point to specific recorded facts, there is no proposal.

**`risks` is mandatory too.** A proposal that only lists benefits is advocacy, not analysis, and
Principle 7 requires that recommendations include potential risks.

### What FRIDAY may and may not do

| Action | Permitted? |
|---|---|
| Observe, measure, analyze | Yes, always |
| File a proposal | Yes |
| Adjust internal caches, retry timing, its own scheduling | Yes — no user-visible effect |
| Change a configuration value | **No — propose** |
| Change a prompt | **No — propose** |
| Change code | **No — propose, as a pull request ([Chapter 31](31-git-workflow.md))** |
| Change a Guardian policy | **Never. Forbidden outright, not merely gated.** |
| Change retention or compaction rules | **No — `critical` approval** |
| Disable a failing connector temporarily | Yes — Article VII, and it is reversible and reported |

The Guardian policy exclusion is absolute and is enforced in CODEOWNERS and in the Guardian itself.
A system that can modify the rules governing it is not governed. This is the one place where I would
override any future argument for convenience.

### Reporting, without becoming noise

The volume problem is solved by batching and thresholds rather than by noticing less:

| Severity | Delivery |
|---|---|
| `critical` (integrity failure, security, data loss risk) | Immediate notification, breaks quiet hours |
| `high` | Next scheduled digest, flagged |
| `medium` / `low` | Weekly digest, grouped by category |
| Informational | Available in the dashboard; never pushed |

**The weekly digest is a single message**, ordered by expected value, with the top three
recommendations stated in plain language. Nothing else is pushed. Article IX: *"communicate when it
matters, avoid unnecessary interruptions."*

**Rejected proposals are remembered.** If you decline something, FRIDAY does not propose it again
unless the evidence changes materially — and if she does re-raise it, she says what changed. A
system that re-asks is a system you stop reading.

---

## Alternatives considered

### No self-diagnostics; rely on external monitoring

**Rejected** — Principle 8 explicitly requires FRIDAY to look for improvements. It is a founding
requirement, not an operational nicety. External monitoring also cannot see FRIDAY's internal
semantics: it can tell you CPU is high, not that an agent is using an expensive model for a trivial
task.

### Allow FRIDAY to auto-apply low-risk improvements

**Advantages:** faster improvement; less of your time consumed; genuinely tempting for things like
prompt tuning.

**Rejected** — Principle 8 says "she should never silently implement them," and Article VIII says
recommendations "should always be presented to the user before significant changes are made." The
line between low-risk and significant is exactly the kind of judgment a system should not make about
its own changes.

The narrow exception — internal caches, retry timing, its own scheduling — is limited to things with
no user-visible behavior change and no persistence beyond a restart. That boundary is written into
the Guardian's policy table rather than left to interpretation.

### AI-generated proposals with no evidence requirement

**Rejected.** Without mandatory evidence, proposals become plausible-sounding suggestions with no
grounding — and given that they are produced by a language model, some fraction would be confidently
wrong. Requiring event IDs and measurements makes proposals checkable.

### Continuous notification of every finding

**Rejected** — guaranteed to produce a system you ignore, at which point the `critical` finding is
missed along with everything else. Article IX.

### A third-party APM tool (Datadog, New Relic, Sentry)

**Advantages:** excellent, mature, far better than anything we will build.

**Rejected** — continuous telemetry export conflicts with Article IV, and the recurring cost is
disproportionate for one user. **Sentry self-hosted** is a reasonable option if crash analysis
becomes a burden; flagged rather than adopted.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Health checks consume resources continuously.** | Accepted — kept cheap and side-effect-free by design. |
| **Proposals require your time to review.** | Accepted — batching and severity thresholds keep it to a weekly digest. |
| **FRIDAY cannot fix even obvious problems herself.** | Accepted without qualification — it is Principle 8, stated explicitly, and it is what makes her trustworthy. |
| **The evidence requirement means some real problems go unreported** because they cannot be quantified. | Accepted — a proposal FRIDAY cannot evidence is one you cannot evaluate. |
| **Self-monitoring has a blind spot:** a broken diagnostics system cannot report itself broken. | Accepted, partially mitigated by an external watchdog — a lightweight `launchd` job that checks the core is alive and alerts if not. |
| **Building this rather than using an APM tool** is real work. | Accepted — the privacy requirement is not negotiable, and FRIDAY-specific semantics are the valuable part anyway. |

---

## Review triggers

- Proposal acceptance rate falls below ~20% → proposals are low quality or poorly targeted
- Any `critical` self-check failure → immediate investigation
- The weekly digest is routinely ignored → the format or the thresholds are wrong
- Health check overhead exceeds 2% of process CPU
- Diagnostics fails to detect an incident found another way → a gap in coverage; add the check

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
