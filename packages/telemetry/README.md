# @friday/telemetry

**Structured logging, tracing, and metrics — none of which leave your machine.**

Milestone: **M1**

## Charter

The *system log*: verbose, cheap, disposable, for debugging. Distinct from the audit trail, which is
permanent and authoritative and lives in `kernel`.

Conflating them makes both worse — the audit trail becomes unusable noise, or debug logs get
rotated away along with records the Constitution requires.

## What lives here

- Pino structured JSON logging, with level criteria
- **Three-layer redaction:** classification from `contracts`, pattern scanning for secret shapes,
  and a deny-list of field names
- OpenTelemetry tracing setup, with cost as a span attribute
- Prometheus-format metrics
- Log rotation and disk-usage protection — daily, 100 MB per file, 30 files, and a **1 GB ceiling on
  the directory**, enforced by the writer rather than by anyone remembering to look
  ([ADR-0023](../../docs/adr/0023-rotating-file-stream-for-log-rotation.md))

## What does NOT

- The audit trail (`kernel`) or explanations (`audit`)
- Any egress. Nothing is exported off the machine.

## Rules

1. **Every log line carries a `correlationId`** where one is available. A stack trace without one is
   a stack trace you cannot connect to what FRIDAY was doing.
2. **Redaction is tested.** A suite feeds known-sensitive payloads through the logger and asserts
   none appears in the output. Untested redaction silently stops working after a refactor.
3. **Never logged:** credentials, message bodies, note contents, health data, account numbers, raw
   audio, transcripts.

Reference: [Chapter 22](../../docs/01-bible/22-logging-standards.md)
