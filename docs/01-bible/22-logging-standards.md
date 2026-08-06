# 22 — Logging Standards

> **Governing provisions:** Constitution Article II (Transparency), Article IV (Privacy), Article V
> (Security — audit logs); Manifesto Principle 2 (Transparency Above All), Principle 9 (Fail
> Gracefully); Core Value 9 (Document Everything).

---

## In plain language

There are **three different written records** in FRIDAY, and confusing them is a mistake that causes
real harm. Most systems have one log and use it for everything, which means it is simultaneously too
noisy to read and too incomplete to trust.

| Record | Audience | Question it answers | Mutable? | Retention |
|---|---|---|---|---|
| **Audit trail** | You | *What did FRIDAY do, and why?* | **Never** | Forever |
| **System log** | Whoever is debugging | *Why did the code behave that way?* | Rotated | 30 days |
| **Explanations** | You | *Tell me in plain language* | Derived | With the audit trail |

The distinction matters because they have opposite requirements.

The **audit trail** must be complete, permanent, and tamper-evident, because your Constitution
depends on it. It is not a log in the ordinary sense — it is the event log from
[Chapter 10](10-event-bus.md), and it is the authoritative record of FRIDAY's behavior.

The **system log** must be verbose, cheap, and disposable. It contains stack traces, timing details,
and the kind of noise that is invaluable during debugging and worthless a week later. If we kept it
forever it would dwarf everything else and make the audit trail hard to find.

**Explanations** are generated from the audit trail on demand, in plain language, for you.

**The single most important rule in this chapter:** the audit trail is never written by a logging
call. It is written by the event bus, as part of the transaction that performs the action. Nobody can
forget to log an action, because logging is not a separate step — it is how the action happens.

---

## The audit trail

Covered in Chapters 09 and 10; summarized here for completeness.

- Written **before** the action, in the same database transaction
- Append-only, enforced by a database trigger, not by convention
- Hash-chained for tamper evidence
- Every entry names the actor, the principal, the causation, and the correlation
- Never deleted; redaction replaces content with a tombstone, preserving the chain
- **Compaction may never touch approvals, Guardian decisions, external calls, model invocations, or
  self-modification events**

If FRIDAY cannot write the audit trail, she stops ([Chapter 10](10-event-bus.md)). An unrecorded
action is worse than no action.

---

## The system log

**Pino**, structured JSON, one object per line.

### Why structured JSON rather than readable text

Human-readable log lines are pleasant to read one at a time and useless in aggregate. You cannot ask
a text log "show me every failure in plan 01J8XKQ across all components," which is exactly the
question you need answered when something goes wrong.

JSON lines are queryable. In development, a formatter renders them readably; the stored form stays
machine-parseable. This is the right trade: optimize the stored form for querying, and format for
humans at display time.

### Levels, with actual criteria

Log levels are usually applied by feel, which makes them useless. These have rules:

| Level | Criterion | Example |
|---|---|---|
| `fatal` | The process cannot continue | Database unopenable at startup |
| `error` | An operation failed and someone should know | Connector call failed after all retries |
| `warn` | Something unexpected that was handled | Circuit breaker opened; fell back to cache |
| `info` | A significant state change | Department registered; plan started |
| `debug` | Detail useful when investigating | Model request parameters; query plan |
| `trace` | Very high volume; off by default | Every event dispatch |

**The `error` test:** would you want to be interrupted about this? If not, it is `warn`. A log full
of errors nobody acts on trains you to ignore errors, which is how the real one gets missed.

**Default level is `info` in production, `debug` in development.** Levels are adjustable at runtime
without a restart, per module — so you can turn up detail on the memory system while investigating
without drowning in everything else.

### Every log line carries context

```
{
  "level": "error",
  "time": 1754467200000,
  "module": "connector.gmail",
  "correlationId": "01J8XKQ...",   ← ties to the audit trail
  "traceId": "4bf92f...",           ← ties to OpenTelemetry
  "principalId": "usr_01H...",
  "actor": "agent:communications/send",
  "msg": "Gmail send failed after 3 attempts",
  "err": { "type": "ConnectorError", "code": "RATE_LIMITED", "stack": "..." },
  "durationMs": 4210
}
```

**`correlationId` on every line is the requirement that makes this work.** It is what connects a
cryptic stack trace to the thing FRIDAY was actually trying to do. Without it you have a stack trace
and no idea which of forty concurrent operations produced it. A log line without a correlation ID,
where one is available, is a defect caught in review.

---

## Redaction — the privacy requirement

Logs are the most common accidental data leak in software. A developer logs a request object to
debug something, the object contains an access token, and now the token is in a file, in a backup,
and possibly in a bug report.

**Three layers, because one is not enough:**

**1. Classification at the source.** Every schema in `packages/contracts` declares field
sensitivity. The logger consults it. A field marked `secret` is replaced with `[REDACTED]` before
serialization.

**2. Pattern-based scrubbing.** A redaction layer scans every log line for secret-shaped strings —
bearer tokens, API key prefixes, private key headers, high-entropy strings in suspicious positions —
and replaces them. This catches the case where classification was wrong or absent.

**3. Deny-listed keys.** Field names including `password`, `token`, `secret`, `apiKey`,
`authorization`, `cookie`, and `refresh` are redacted regardless of their declared classification or
their value.

**Absolute rules:**

| Never logged | Logged carefully |
|---|---|
| Credentials, tokens, keys of any kind | Email addresses → hashed, or first-char masked |
| Message bodies, note contents, document text | Personal names → only when necessary |
| Health data, financial account numbers | File paths → home directory replaced with `~` |
| Biometric data, raw audio, transcripts | User input → length and shape, not content |

**Testing this is mandatory.** A test suite feeds known-sensitive payloads through the logger and
asserts none of it appears in the output. Redaction that is not tested is redaction that silently
stops working after a refactor.

---

## Explanations

The third record: audit data rendered in plain language.

Generated by `packages/audit`, on demand, by walking the causation chain. Never generated by asking
a model to recall its reasoning — models confabulate about their own past behavior fluently and
falsely ([Chapter 10](10-event-bus.md)).

A model may be used to *phrase* an explanation more naturally, but only over facts read from the
audit trail, and every claim must map to a recorded event. If the model produces a sentence not
supported by an event, that is a bug, and the explanation generator validates against this.

**Three depths, progressive disclosure:**

| Depth | Content | Where |
|---|---|---|
| Summary | One or two sentences | Notifications, list views |
| Standard | What, why, what it cost, what was uncertain | Approval screens, plan detail |
| Full | The complete causal chain, every event, every prompt, every cost | The audit explorer |

---

## Storage and rotation

| Record | Location | Rotation | Retention |
|---|---|---|---|
| Audit trail | `events.db` → Parquet archive | Compaction at 90d, archive at 2y | **Forever** |
| System log | `~/Library/Logs/FRIDAY/friday.log` | Daily, 100 MB max per file | 30 days |
| Crash reports | `~/Library/Logs/FRIDAY/crashes/` | Per incident | 90 days |

**System logs never leave your machine** unless you explicitly export them for a support request —
and the export runs an additional redaction pass and shows you what it contains before writing the
file. Article IV.

**Disk protection:** if the log directory exceeds 1 GB, rotation becomes aggressive and a diagnostic
is raised. Logs must never be the reason FRIDAY cannot write her audit trail.

---

## Alternatives considered

### One unified log for everything

**Advantages:** simpler; one place to look.

**Rejected** because the requirements are genuinely opposite. The audit trail must be permanent and
immutable; debug logs must be verbose and disposable. A unified log either keeps debug noise forever
(making the audit trail unusable and enormous) or rotates away audit records (violating Article II).

### Winston or Bunyan instead of Pino

**Rejected** on performance — Pino is substantially faster and produces less garbage collection
pressure, which matters for a process that runs continuously on a laptop. The API differences are
minor.

### Plain text logs

**Rejected** — not queryable. The one advantage (readability) is recovered by formatting at display
time.

### A hosted log aggregation service (Datadog, Better Stack, Axiom)

**Advantages:** excellent search, alerting, retention, and dashboards with no work.

**Rejected** because it means FRIDAY's operational telemetry — which includes a great deal about your
life by inference alone — flows continuously to a third party. Direct conflict with Article IV. It
is also a recurring cost for a single-user system.

**Local alternative:** logs are queryable via the CLI and the dashboard's log viewer. If richer
analysis is ever wanted, a local Loki or DuckDB-over-JSONL setup provides it without egress.

### Logging every event to the system log as well as the audit trail

**Rejected** as duplication that would double log volume while adding nothing. The audit trail is
already queryable and already permanent. The system log covers what the audit trail deliberately
does not: implementation detail.

### Sampling logs to reduce volume

**Rejected for errors and warnings** — an error you sampled away is an error you cannot diagnose.
**Adopted for `trace`**, which is off by default and sampled when enabled.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Three records is more machinery** than one log. | Accepted — the requirements genuinely differ, and conflating them makes all three worse. |
| **Structured JSON is harder to read raw.** | Accepted — a formatter handles display; storage is optimized for querying. |
| **Redaction can hide information you needed** while debugging. | Accepted — a leaked credential is far worse than a harder debugging session. Runtime log levels help. |
| **Correlation IDs everywhere is discipline** that will occasionally be forgotten. | Accepted — caught in review; the envelope makes it automatic on most paths. |
| **No hosted aggregation** means weaker search and no alerting out of the box. | Accepted for Article IV. Local tooling covers a single-user system adequately. |
| **The audit trail grows forever.** | Accepted — designed for, with strict rules on what compaction may never touch. |

---

## Review triggers

- Log volume exceeds 1 GB/month → sampling or level review
- A sensitive value appears in a log → **stop-the-line**; redaction failure is a security incident
- Debugging repeatedly requires data that redaction removed → refine classification rather than
  weakening redaction
- FRIDAY runs on multiple machines → centralized (self-hosted) log aggregation becomes necessary

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
