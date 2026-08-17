# ADR-0042 — HUD vitals are FRIDAY-scoped, per Chapter 29

- **Status:** proposed
- **Date:** 2026-08-12
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **implements one row** of
  [ADR-0041 §5](0041-one-hud-is-the-dashboard-grown-up.md)
- **Related:** [Chapter 29 — Monitoring & Observability](../01-bible/29-monitoring-observability.md)
  — the metric contract this decision reads from,
  [Chapter 23 — Diagnostics System](../01-bible/23-diagnostics-system.md),
  [ADR-0029 — `apps/core` begins at Milestone 2 to serve the dashboard](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md),
  [`packages/diagnostics/README.md`](../../packages/diagnostics/README.md) — the charter this fills in

---

## Context

[ADR-0041](0041-one-hud-is-the-dashboard-grown-up.md) settled that the HUD is `apps/web` grown up and
that **no panel may display anything FRIDAY did not record or produce.** Its §5 table lists System
Vitals as unbuildable against an empty `packages/diagnostics`.

Asked on 2026-08-12 whether to build the HUD now or wait for M5, the owner chose to build it now and
to make vitals genuinely real. This ADR fills in that one row.

### The question that turned out to matter: *whose* vitals?

The brief asks for **"the important system metrics FRIDAY currently tracks"**, and lists CPU, memory,
storage, temperature, network among its examples. Read alone, that sounds like the machine.

[Chapter 29](../01-bible/29-monitoring-observability.md) is the document that defines what FRIDAY
tracks, and its system-health group is **not host-scoped**:

> `friday_up`, `friday_uptime_seconds`, `friday_memory_bytes`, `friday_cpu_percent`,
> `friday_db_size_bytes`, `friday_event_log_size_bytes`, `friday_disk_free_bytes`

Every one of those is scoped to FRIDAY's own process. Chapter 29 defines **no host-CPU metric and no
host-memory metric at all.**

### ★ The conflict, stated rather than smoothed over

Brief §11's ASCII sketch of the layout shows:

```
CPU       18%  ↘
MEMORY    42%  →
DISK      61%  →
TEMP      48°C ↗
```

`TEMP 48°C` can only be the machine. So the sketch is host-scoped and Chapter 29 is FRIDAY-scoped,
and both are authoritative documents.

**Chapter 29 governs, and the brief's own words are why.** It asks for the metrics *FRIDAY currently
tracks* — a phrase that defers to whatever the system tracks, and Chapter 29 is the document that
says. The sketch is explicitly labelled "only a conceptual layout … improve it where appropriate";
the metric contract is not labelled that way. When a picture and a contract disagree about semantics,
the contract wins.

This was nearly decided the other way. A first implementation measured host CPU and host memory
without ever consulting Chapter 29, and produced a memory figure of **98.9%** on a healthy Mac —
because `os.freemem()` counts only genuinely free pages and excludes cache. Reading Chapter 29 showed
the metric was never meant to be host memory, and that the one it *does* specify —
`friday_memory_bytes` — is trivially and truthfully measurable.

**The lesson is recorded because the failure was silent:** substituting a host metric for a
FRIDAY metric produced a number that was plausible, prominent, wrong, and pinned to red.

---

## Decision

### 1. Measurement lives in `packages/diagnostics`, never in the HUD or in `apps/core`

`apps/web` calls `vitals.current` over tRPC and renders what it is given. `apps/core` translates and
does not compute — its composition-only rule
([ADR-0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md)) is unchanged.

This is the first content in `packages/diagnostics`, and it sits inside its charter: health is the
first of the three functions the charter names.

### 2. ★ Vitals are FRIDAY-scoped, and the scope must be visible

Every vital describes **the FRIDAY runtime process**, not the machine it runs on:

| Vital | Chapter 29 metric | Source |
|---|---|---|
| CPU | `friday_cpu_percent` | `process.cpuUsage()` delta over wall time |
| Memory | `friday_memory_bytes` | `process.memoryUsage().rss` |
| Disk | `friday_disk_free_bytes` | `statfs` on the configured data directory |
| Uptime | `friday_uptime_seconds` | `process.uptime()` |

**The HUD must make this scope obvious.** A row labelled `MEMORY` showing 90 MB, on a panel the owner
reads as his Mac's vitals, is the same substitution this ADR exists to prevent — merely in the other
direction. The panel names the runtime it is describing.

**Explicitly outside this contract, and not by oversight:**

- **Host available memory.** `os.freemem()` is banned here. It excludes cached and purgeable pages,
  reports ~99% used on a healthy Mac, and a truthful figure needs `host_statistics64` — a native
  binding. Chapter 29 does not ask for it, so there is nothing to trade away.
- **Host CPU and load average.** `os.loadavg()` and host-wide `os.cpus()` utilisation. Chapter 29
  defines no such metric.
- **Host uptime.** `os.uptime()` is time since the Mac booted, which is a different fact from
  `friday_uptime_seconds` and must not be shown under its label.

Disk is the one honest overlap: the volume is the machine's, but the metric Chapter 29 names is
`friday_disk_free_bytes` — headroom on the volume holding *her* databases — and that is what is
measured.

### 3. Absence is a value the wire can carry

Every reading is one of two things, and both are legitimate:

```
  measured   a number, its unit, and when it was taken
  absent     a machine-readable reason, and what would make it available
```

Two vitals are absent, both named by the brief and neither having a truthful FRIDAY-scoped source:

- **Temperature** — not readable on Apple Silicon without elevated privileges, and no FRIDAY-scoped
  temperature exists in any case.
- **Network** — throughput needs interface counters sampled over time; Chapter 29 defines no
  FRIDAY-scoped network metric.

A metric the owner asked for and cannot have is answered with a reason, never with silence and never
with a zero. Reporting `0` is the option that looks best and is a lie: a measurement nobody took,
rendered in the same typeface as the ones that were.

The same shape gives per-item resilience — an unreadable data directory degrades the disk row alone
rather than blanking a panel the owner is reading three other numbers from.

### 4. There is no `unrated` state. A verdict is optional

`VitalState` is `healthy | warning | critical`, and **`state` is optional on a measured reading.**

Uptime is why. It is measured, it is real, and there is no duration at which it becomes a problem —
so it carries a value and no verdict. An earlier draft of this ADR added a fourth enum member,
`unrated`, for exactly this case. That was wrong: "no rating" is the *absence* of a state, and
modelling absence as an enum member forces every future `switch` over `VitalState` to handle a value
that is not a state.

Optional is the correct shape. Absent state means no verdict was formed; it does not mean healthy.

### 5. Thresholds are judgements, and they live in the package

| Vital | Warning | Critical | Basis |
|---|---|---|---|
| CPU | 50% | 80% | Judgement. A background assistant at sustained half a machine is doing something the owner should know about |
| Memory | 512 MB | 1024 MB | Judgement. A Node service on a personal Mac past these is leaking, not working |
| Disk | 85% used | 95% used | **Chapter 29 alerting** sets `Disk free < 5%` as `critical` — *"this is what stops the audit trail"* |
| Uptime | — | — | No threshold exists (§4) |

Only the disk critical threshold is inherited rather than chosen. The other two are opinions, held in
one testable file so that they can be argued with in one place — and the HUD renders them rather than
forming its own.

---

## Constitutional review

- **Article II (Transparency):** §3 is Article II applied to the absence of data. A surface that
  cannot say "I do not know this" can only say something false.
- **Article IV (Privacy):** vitals are process facts, never personal content. Sensitivity `internal`,
  read over loopback like every other procedure.
- **Principle 10 (Simplicity Wins):** no dependency added; two Node standard-library modules and
  `process`.

**The five questions:**

- [x] **Can the user see it?** — it is a panel whose purpose is being seen.
- [x] **Can the user stop it?** — reading is passive and initiates nothing.
- [x] **Can we replace it?** — the reader is an interface; a different sampler swaps behind it.
- [x] **Can we explain it?** — every number names its Chapter 29 metric and its measurement time.
- [ ] **Will this still be right in five years?** — **§2 will. The threshold table will not.** The
      numbers in §5 are judgements about one Mac running one process, and the first time FRIDAY does
      real work they will be re-argued.

---

## Alternatives considered

### A. Host-scoped vitals, following the brief's sketch

**What it is.** CPU, memory, and disk for the Mac, as the §11 sketch draws them.

**Advantages.** Matches the picture the owner drew, and "how busy is my machine" is a question people
genuinely ask an always-open panel. Temperature would fit naturally beside them.

**Why rejected.** Chapter 29 defines no host CPU or host memory metric, so this would be inventing a
contract rather than reading one — and the memory half of it cannot be measured truthfully in Node at
all. The brief asks for what FRIDAY *tracks*; this is what the *machine* is doing.

### B. Both scopes on one panel

**What it is.** Host CPU beside FRIDAY CPU, host memory beside RSS.

**Advantages.** Nobody has to choose, and the comparison is genuinely informative — FRIDAY at 4% on a
machine at 90% is a different situation from both at 4%.

**Why rejected.** It doubles the densest panel on a screen whose whole argument is calm, and half of
it (host memory) still cannot be measured truthfully. Worth revisiting if host metrics ever earn a
contract of their own.

### C. A native module for accurate host memory and temperature

**Advantages.** Correct memory pressure, and a temperature reading.

**Why rejected.** A compiled dependency running with FRIDAY's privileges, for two numbers Chapter 29
does not ask for. Chapter 18 and rule 4 both point the other way.

### D. Shell out to `vm_stat`, `top`, or `powermetrics`

**Advantages.** Everything the panel could want, immediately, with no native build.

**Why rejected.** Parsing human-formatted output is brittle across OS versions, `powermetrics` needs
root, and spawning processes on a one-second poll is a real cost for an all-day surface. It also puts
shell invocation inside a package whose charter is observation — the "random shell commands" arrow the
brief's own §14 drew and rejected.

---

## Consequences

**Positive**

- Every number on the panel is truthful and traceable to a named Chapter 29 metric.
- Memory is measurable after all, which was not true under the host-scoped reading.
- §3 gives the panel per-item resilience and gives absent metrics an honest rendering.
- `packages/diagnostics` gets its first content along the grain of its charter.

**Negative**

- **`CPU 0.4%` is FRIDAY idling, not the Mac idling**, and an owner glancing at it may read it as the
  machine. §2's labelling requirement is the whole mitigation, and it is a wording rule rather than a
  mechanism.
- **The brief's sketch is not what got built**, and the owner drew that sketch.
- **Two requested metrics are absent**, temperature specifically asked for. He gets a reason.
- **A one-second poll of a stateful reader** is a small ongoing cost nothing currently bounds.

**Neutral**

- `friday_up`, `friday_db_size_bytes`, and `friday_event_log_size_bytes` exist in Chapter 29 and are
  not on the panel. `friday_up` is answered by the HUD's own connection indicator; the two size
  metrics are telemetry detail, and the brief asks for the important metrics rather than the whole
  schema. Revisit when retention lands and the log's growth becomes something the owner must watch.

---

## Reversibility

- **Cost to reverse:** very low. Delete the module and the one procedure; the panel then renders
  through the same absent path as temperature.
- **Point of no return:** none. §2's scope rule and §3's wire shape are the only things other code
  will grow to depend on, and both are additive.

---

## Review triggers

- **Any vital rendered without a measurement time**, or any `absent` without a reason — §3 is lost.
- **A host metric appears under a FRIDAY-scoped label**, or vice versa. This is the failure the ADR
  was written for, and it will be attempted again by someone reading the §11 sketch.
- **`os.freemem()`, `os.loadavg()`, or `os.uptime()` appears in this package.** §2 bans all three.
- **Retention lands** — the event log's growth becomes worth showing, and §5's neutral note reopens.
- **Vitals begin driving a decision** rather than a display — accuracy then matters and Alternative C
  changes from unjustified to necessary.
- **The poll shows up in battery or CPU profiles** on an all-day surface.

---

## Notes

**This ADR was rewritten once, and the first version was wrong in an instructive way.** It measured
the host, defended a 98.9% memory reading as a documented caveat, and invented a fourth vital state to
avoid colouring it red. Every one of those was a workaround for a question never asked: *which
metrics does Chapter 29 actually define?* The answer removed the problem rather than managing it.

**Uncertainty**, ranked:

1. **That FRIDAY-scoped CPU is what the owner wants to see.** He drew a host-scoped sketch. I have
   followed the contract over the picture and said so in §2, and this is the decision most likely to
   come back.
2. **The CPU and memory thresholds in §5.** Chosen for a process that currently does almost nothing.
   The first real agent workload will make them wrong.
3. **That omitting the two size metrics is right.** The event log grows forever and compaction is not
   built; there is a fair argument that its size belongs on the panel today.
