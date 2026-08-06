# ADR-0015 — Observability is local-only

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 29](../01-bible/29-monitoring-observability.md), [Bible 22](../01-bible/22-logging-standards.md)

## Context

Hosted observability platforms — Datadog, New Relic, Honeycomb, Grafana Cloud, Sentry — are
genuinely excellent and far better than anything we will build. They would meaningfully improve
incident diagnosis at essentially no engineering cost.

They also require continuously exporting operational telemetry off the machine.

## Decision

**All observability stays on the machine.** OpenTelemetry instrumentation (vendor-neutral, so the
backend stays replaceable), a local collector, local Prometheus, and optional self-hosted Grafana.

The stack is **staged to Milestone 5 and optional** — running three extra processes (~230 MB) on a
laptop to observe a system that already has a complete audit trail is not obviously worth it, and
we will find out rather than assume. Until then, the built-in dashboard renders health, throughput,
cost, and pending work from the event log directly.

## Constitutional review

- **Article IV (Privacy):** operational telemetry is **not anonymous**. Request timing reveals when
  the owner sleeps. Connector usage reveals which services they use. Cost patterns reveal how much
  they rely on FRIDAY. Exporting it continuously would leak a detailed picture of a life by
  inference alone.
- **Principle 5 (Modularity):** OpenTelemetry means the backend is swappable without touching
  FRIDAY's code.

## Alternatives considered

### A hosted observability platform
**Advantages.** Excellent search, correlation, alerting, and retention with no work. Genuinely
better than what we will build.
**Why rejected.** Continuous telemetry export conflicts directly with Article IV, for the reasons
above. Also a recurring cost for a single-user system.

### Hosted Sentry for error tracking
**Advantages.** Excellent at what it does; would meaningfully improve crash diagnosis.
**Why rejected in hosted form.** Stack traces routinely contain user data in variables.
**Self-hosted Sentry is a reasonable option** if crash analysis becomes a real burden — flagged
rather than dismissed.

### No observability beyond the audit trail
**Advantages.** Simplest; the audit trail genuinely covers most of what matters.
**Why rejected.** The audit trail records *what happened*, not *how long it took* or *how much
memory it used*. Performance regressions and resource leaks are invisible to it. **Partially
adopted** — observability is staged rather than built up front.

### Building observability entirely ourselves
**Why rejected.** Reinventing OpenTelemetry is a large project with no benefit, and it would forfeit
vendor neutrality.

## Consequences

**Positive**
- No operational data leaves the machine, ever.
- Zero recurring cost.
- The local/cloud model invocation ratio becomes a **continuous measurement of how well FRIDAY is
  honoring Article IV** — a privacy commitment with an instrument attached, which most do not have.

**Negative**
- Meaningfully weaker search, correlation, and alerting than a hosted platform. This gap is real and
  it is the right trade.
- ~230 MB of local processes when the full stack is enabled.
- No alerting when FRIDAY is entirely down — she cannot alert about her own absence. Mitigated by an
  external `launchd` watchdog.
- Shorter metric retention (15 days). Long-term trends come from the permanent audit trail instead.

## Reversibility

- **Cost to reverse:** low technically — OpenTelemetry can point anywhere. Reversing would breach
  Article IV, so treat as constitutional.

## Review triggers

- The built-in dashboard cannot answer an operational question that matters → deploy the Grafana stack
- Observability overhead exceeds 5% of process CPU
- **The local/cloud model invocation ratio shifts materially toward cloud** → privacy regression;
  investigate immediately
- Crash analysis becomes a recurring burden → evaluate self-hosted Sentry
