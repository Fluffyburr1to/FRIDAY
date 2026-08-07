# ADR-0023 — `rotating-file-stream` for log rotation

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 22 — Logging Standards](../01-bible/22-logging-standards.md),
  [packages/telemetry/README.md](../../packages/telemetry/README.md)

---

## Context

[Chapter 22](../01-bible/22-logging-standards.md) sets four numbers for the system log: daily
rotation, 100 MB maximum per file, 30 days of retention, and — separately, under "disk protection" —
**if the log directory exceeds 1 GB, rotation becomes aggressive and a diagnostic is raised.**

That last rule exists because of the sentence that closes Chapter 10: *if FRIDAY cannot write her
audit trail, she stops.* A disk filled with debug output would stop her recording, and an unrecorded
action is worse than no action. Chapter 22 states the consequence directly: **logs must never be the
reason FRIDAY cannot write her audit trail.**

Milestone 1 shipped without rotation, with `friday status` reporting the log size as a stopgap. The
owner's instruction on reviewing that was explicit: this must not depend on anyone remembering to
watch it. Prefer an in-process solution if one is stable and maintained; otherwise use the
best-maintained alternative and record the deviation.

`pino-roll` is the obvious candidate, being from the Pino organisation. It was evaluated first.

## Decision

We will **use `rotating-file-stream` as the log destination for file logging**, configured with
Chapter 22's four numbers, confined to `packages/telemetry`. Rotation events are surfaced through a
callback so Diagnostics can raise the issue Chapter 22 requires.

This is **a deviation from the owner's suggested `pino-roll`**, recorded here as instructed.

## Constitutional review

- **Article II (Transparency):** a deleted log file emits a `removed` event with a plain-language
  message, rather than disappearing quietly.
- **Article VII (Reliability):** the stream's `error` event is handled rather than left to
  propagate. An unhandled stream error takes the process down, and losing FRIDAY because her *debug
  log* could not rotate would invert the priority Chapter 22 sets.
- **Article IV (Privacy):** unchanged. Redaction happens before anything reaches the stream, and
  there is a test asserting that specifically after rotation was introduced.

**The five questions:**

- [x] **Can the user see it?** Rotation and deletion are observable, and destined for a diagnostic.
- [x] **Can the user stop it?** Not applicable — this is disk hygiene, not an action.
- [x] **Can we replace it?** One file, `rotation.ts`, behind `createLogger`.
- [x] **Can we explain it?** The `removed` message says why the file went and what it implies.
- [x] **Will this still be right in five years?** The policy will. The library is the replaceable part.

## Alternatives considered

### `pino-roll` — the suggested option

**What it is.** The Pino organisation's rotating file transport.

**Advantages.** Designed for Pino, writes through `sonic-boom` (the same fast destination Pino uses
for stdout), and would be the least surprising choice for anyone reading the dependency list.

**Why rejected.** Three reasons, in order of weight:

1. **It cannot express the 1 GB ceiling.** `pino-roll` caps the *number* of retained files
   (`limit.count`), not their total size. Thirty files of 100 MB is 3 GB — so a configuration that
   satisfies Chapter 22's first three numbers actively violates the fourth. That is the exact
   failure the rule exists to prevent, and no combination of its options closes it.
2. **It is maintained less recently** — last published 2025-10-06, against 2026-02-21 for the
   alternative. Neither is abandoned; one is fresher.
3. **It has runtime dependencies** (`date-fns`, `sonic-boom`) where the alternative has none. Chapter
   18 treats every dependency as attack surface running with FRIDAY's full privileges.

Point 1 is decisive on its own. Points 2 and 3 are why the decision was not close.

### An external rotator (`newsyslog`, `logrotate`)

**What it is.** Let the operating system rotate the file, with Pino reopening on `SIGHUP`.

**Advantages.** No dependency at all. The mechanism is the platform's, already tested by everyone.

**Why rejected.** It requires a system configuration file installed outside the repository, which
means FRIDAY's retention guarantee would depend on a step someone has to perform and could forget —
precisely what the owner said they did not want. It also does not travel: the Mac Mini or Linux host
contemplated at Milestone 5 would need a different file.

### Write rotation ourselves

**What it is.** Check the file size on write; rename, compress, and prune when it is exceeded.

**Advantages.** No dependency, and the logic is not conceptually hard.

**Why rejected.** It is far past rule 4's "fifty lines" once compression, atomic rename, boundary
alignment, and directory accounting are real. It is also the wrong place to spend a novel
implementation: this is solved, and the solved version has been read by more people than ours would
be.

## Consequences

**Positive**

- All four of Chapter 22's numbers are enforced by the writer. Nobody has to look at anything.
- Rotated files are gzipped, and the 1 GB budget is measured against the compressed size — so the
  30-day window is realistic rather than nominal.
- Deletion under budget pressure is surfaced, not silent, which is what makes the Chapter 22
  diagnostic possible.
- No runtime dependencies were added transitively.

**Negative**

- **Writes no longer go through `sonic-boom`.** An ordinary Node stream is measurably slower than
  Pino's own destination. At FRIDAY's volume — thousands of lines a day, not thousands a second —
  this is not expected to be visible, but it is a real trade and it is the cost of the decision.
- **The live file is not counted against the total budget** until it rotates. A single runaway file
  can therefore exceed the ceiling by up to `maxFileSize` before anything intervenes. Bounded and
  accepted; closing it would mean checking the directory size on every write.
- **The deviation itself.** The dependency list will read oddly to anyone who expects `pino-roll`
  beside `pino`, and this ADR is the only thing that explains it.
- A `.rotation-history` bookkeeping file now sits in the log directory. Named explicitly, because
  the library's default of `friday.log.txt` looks exactly like a log file somebody should read.

**Neutral**

- Rotation applies only to file destinations. Logging to stdout, which is the development default,
  is unchanged and still uses Pino's own destination.

## Reversibility

- **Cost to reverse:** low.
- **How:** `packages/telemetry/src/rotation.ts` is the whole implementation, behind
  `createLogger({ destination })`. Nothing else in FRIDAY knows rotation exists.
- **Point of no return:** none. Existing rotated files are gzipped text.

## Review triggers

- `pino-roll` gains a total-size limit — the decisive objection disappears, and the Pino-native
  option becomes the better one.
- Log write throughput becomes visible in profiling — reconsider `sonic-boom`.
- `rotating-file-stream` goes unmaintained for more than a year.
- FRIDAY moves to an always-on host (Milestone 5) — log volume changes, and the 1 GB ceiling should
  be re-derived rather than assumed.
- The `removed` event fires in normal operation — retention has outgrown the budget, which is a
  Chapter 22 review trigger in its own right.

## Notes

Chapter 22's numbers live in one exported constant, `CHAPTER_22_ROTATION`, with a test asserting it
equals exactly what the chapter specifies. Those four values are a commitment in a governing
document; the test is what makes changing one a visible decision rather than a diff nobody reads.
