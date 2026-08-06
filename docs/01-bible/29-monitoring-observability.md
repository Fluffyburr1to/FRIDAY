# 29 — Monitoring & Observability

> **Governing provisions:** Constitution Article II (Transparency), Article IV (Privacy), Article
> VII (Reliability); Manifesto Principle 2, Principle 9; Core Value 8.

---

## In plain language

Monitoring is knowing what FRIDAY is doing right now and whether it is going well.

FRIDAY has an advantage here that most systems do not: **the audit trail already records everything
she does.** Most software has to add instrumentation as a separate concern — sprinkle in
measurements, hope you added them in the right places, discover during an incident that the one
thing you needed was not measured. FRIDAY's event log is already the complete record, so monitoring
is largely a matter of *reading* it rather than *adding* to it.

The distinction worth holding onto: [Chapter 23](23-diagnostics-system.md) is FRIDAY watching
herself and forming opinions. This chapter is the *instrumentation* — the raw signal that
diagnostics reasons over and that you look at when something is wrong.

And the constraint that shapes everything: **none of it leaves your machine.** Article IV. Every
hosted monitoring service — Datadog, New Relic, Grafana Cloud, Sentry's hosted tier — would mean
continuously exporting operational telemetry that reveals a great deal about your life by inference
alone. When you wake up, when you work, who you contact, how much you spend. That is not acceptable,
so observability is local, and we accept that it will be less polished than what money could buy.

---

## The three signals

Standard practice, applied to FRIDAY's specifics.

| Signal | Question | Where it lives |
|---|---|---|
| **Traces** | Where did the time go in this operation? | OpenTelemetry, local collector |
| **Metrics** | What are the aggregate numbers? | Prometheus format, local |
| **Logs** | What exactly happened at this moment? | Pino ([Chapter 22](22-logging-standards.md)) |

Plus one FRIDAY does not share with ordinary systems:

| **Audit events** | What did FRIDAY do, and why? | `events.db` — the authoritative record |

The `traceId` in the message envelope ([Chapter 21](21-internal-protocols.md)) links all four. From
an audit event you can reach its trace; from a trace you can reach its logs; from a slow span you
can reach the plan it belonged to.

---

## Tracing

**OpenTelemetry**, chosen for one reason above all: it is vendor-neutral. Instrumenting with OTel
means the collector can be swapped, the backend can be changed, and nothing in FRIDAY's code
changes. Principle 5, applied to observability.

Every plan produces a trace. Spans are created for plan execution, each step, each agent invocation,
each model call, each connector call, each Guardian evaluation, and each database query above a
latency threshold.

Span attributes always include: `plan.id`, `step.sequence`, `actor`, `risk.class`,
`model.name`, `tokens.in/out`, `cost.cents`, `guardian.decision`.

**Cost as a span attribute** is unusual and genuinely useful. A trace shows not only where time went
but where money went, which turns "why did this cost $0.40?" into a question with a visual answer.

**Traces are sampled: 100% of errors and slow operations, 10% of routine ones.** Full tracing of
everything would produce more data than the audit trail itself for no additional insight — the audit
trail already has the *what*; traces add the *how long*.

---

## Metrics

Roughly forty metrics, grouped by what they tell you. The ones that matter most:

**System health**
`friday_up`, `friday_uptime_seconds`, `friday_memory_bytes`, `friday_cpu_percent`,
`friday_db_size_bytes`, `friday_event_log_size_bytes`, `friday_disk_free_bytes`

**Work**
`friday_plans_total{status}`, `friday_plan_duration_seconds`, `friday_steps_total{status}`,
`friday_agent_invocations_total{agent,outcome}`, `friday_agent_duration_seconds`

**Trust and safety** — the FRIDAY-specific ones
`friday_approvals_total{risk_class,outcome,via}`
`friday_approval_response_seconds` ← rubber-stamping detector
`friday_approvals_pending`
`friday_guardian_decisions_total{decision,risk_class}`
`friday_standing_grants_active`
`friday_egress_blocked_total` ← should be zero
`friday_audit_chain_valid` ← should always be 1

**Cost**
`friday_model_cost_cents_total{provider,model}`, `friday_tokens_total{direction}`,
`friday_budget_remaining_cents`, `friday_budget_exhausted_total`

**Privacy**
`friday_external_requests_total{connector,category}`
`friday_data_egress_bytes{category}`
`friday_local_model_invocations_total` vs `friday_cloud_model_invocations_total`

That last pair is worth calling out. The ratio of local to cloud inference is a **direct, continuous
measurement of how well FRIDAY is honoring Article IV**. If cloud invocations grow relative to local
ones over time, privacy posture is degrading — and it would degrade invisibly without this metric.
Most privacy commitments have no such instrument.

---

## Alerting

Alerts go through the notification framework ([Chapter 24](24-notification-framework.md)), so
Article IX applies. An alerting system that ignores the attention budget is a system you mute.

| Condition | Urgency |
|---|---|
| **Audit chain integrity failure** | `critical` — breaks quiet hours |
| Egress blocked (undeclared host) | `critical` |
| Core down > 60s | `critical` |
| Disk free < 5% | `critical` — this is what stops the audit trail |
| Backup failed 2 consecutive days | `urgent` |
| Monthly budget > 90% | `urgent` |
| Connector down > 15 min | `normal` |
| Dead-letter queue > 100 | `normal` |
| Approvals pending > 4 hours | `normal` |
| Plan failure rate > 10% | `normal` |
| Approval median response < 3s | `low` — rubber-stamping signal, goes to the digest |

**Every alert names a runbook.** An alert that tells you something is wrong without telling you what
to do is an alert you will learn to dismiss. Runbooks live in `docs/runbooks/` and are linked
directly from the alert.

---

## The local stack

```
friday-core
   │ OTLP (localhost only)
   ▼
OpenTelemetry Collector          ~50 MB
   ├── traces  → local file / Jaeger (on demand)
   ├── metrics → Prometheus       ~100 MB
   └── logs    → Pino files
                    │
                    ▼
              Grafana            ~80 MB, optional
              (self-hosted, localhost)
```

**Deliberately optional and staged.** At Milestone 1 there is only structured logging. Metrics
arrive at M3. The collector and Grafana arrive at M5, and only if the built-in dashboard proves
insufficient. Running three extra processes on a laptop to observe a system that already has a
complete audit trail is not obviously worth it, and we will find out rather than assume.

**The built-in dashboard covers the common case.** Health, throughput, cost, and pending work are
rendered from the event log directly ([Chapter 26](26-dashboard-architecture.md)). Grafana is for
the deeper questions — correlating latency with memory growth over three months — that a purpose-built
UI should not try to answer.

---

## Alternatives considered

### A hosted observability platform (Datadog, New Relic, Honeycomb, Grafana Cloud)

**Advantages:** far better than anything we will build. Excellent search, correlation, alerting, and
retention with essentially no work.

**Rejected** — continuous telemetry export conflicts directly with Article IV. Operational telemetry
is not anonymous: request timing reveals when you sleep, connector usage reveals what services you
use, cost patterns reveal how much you rely on FRIDAY. Also a recurring cost for one user.

### Sentry for error tracking

**Advantages:** genuinely excellent at what it does; would meaningfully improve crash diagnosis.

**Rejected in hosted form** (stack traces routinely contain user data in variables). **Self-hosted
Sentry is a reasonable option** if crash analysis becomes a real burden, and it is flagged rather
than dismissed.

### No observability beyond the audit trail

**Advantages:** simplest; the audit trail genuinely covers most of what matters.

**Rejected** because the audit trail records *what happened*, not *how long it took* or *how much
memory it used*. Performance regressions and resource leaks are invisible to it. **Partially
adopted** in that observability is staged rather than built up front.

### Custom-built observability entirely

**Rejected** — reinventing OpenTelemetry is a large project with no benefit, and it would forfeit
vendor neutrality. Instrumenting with a standard means the backend stays swappable.

### Metrics in the same database as everything else

**Rejected** — metrics are high-volume, low-value, time-series data with completely different access
patterns. Mixing them with the audit trail would bloat backups and slow the queries that matter.
Prometheus's local storage is designed for exactly this and is disposable.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Local-only observability is less capable** than hosted platforms. | Accepted — Article IV. The gap is real and it is the right trade. |
| **Running a collector, Prometheus, and Grafana costs ~230 MB** on your laptop. | Accepted — optional, staged to M5, and only if the built-in dashboard proves insufficient. |
| **Sampling means some traces are lost.** | Accepted — errors and slow operations are always kept, which is what you need. |
| **No alerting when FRIDAY is completely down** — she cannot alert about her own absence. | Accepted, mitigated by an external `launchd` watchdog that checks liveness independently. |
| **Building alert routing ourselves** rather than using a mature alerting system. | Accepted — it must go through the notification framework anyway to honor Article IX. |
| **Metrics retention is short** (15 days local). | Accepted — long-term trends come from the audit trail, which is permanent. |

---

## Review triggers

- The built-in dashboard cannot answer an operational question you need → deploy the Grafana stack
- Observability overhead exceeds 5% of process CPU
- An incident occurs that existing instrumentation could not diagnose → add the missing signal
- The local/cloud model invocation ratio shifts materially toward cloud → **privacy regression**;
  investigate immediately
- Crash analysis becomes a recurring burden → evaluate self-hosted Sentry

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
