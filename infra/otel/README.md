# OpenTelemetry Collector Configuration

**Optional. Staged to Milestone 5** — and only if the built-in dashboard proves insufficient.

Running three extra processes (~230 MB) on a laptop to observe a system that already has a complete
audit trail is not obviously worth it. We will find out rather than assume.

## The rule

**Everything stays on localhost. No telemetry leaves the machine, ever.**

Operational data is not anonymous. Request timing reveals when you sleep. Connector usage reveals
what services you use. Cost patterns reveal how much you rely on FRIDAY. Article IV applies to
monitoring exactly as it applies to everything else — which is why every hosted observability
platform was rejected.

## What the collector does when enabled

- Receives OTLP traces and metrics from `friday-core`
- Exports traces to a local file or Jaeger, on demand
- Exports metrics to a local Prometheus
- **Exports nothing off the machine**

Reference: [Chapter 29](../../docs/01-bible/29-monitoring-observability.md)
