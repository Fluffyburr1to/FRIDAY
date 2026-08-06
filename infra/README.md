# infra/ — How FRIDAY Runs

Service definitions, backup configuration, and telemetry configuration. Not application code.

| Folder | Contains |
|---|---|
| **launchd/** | macOS service definition — how the core stays alive |
| **backup/** | Litestream configuration, restore scripts, recovery-card generation |
| **otel/** | OpenTelemetry collector configuration (M5, optional) |

---

## launchd/

FRIDAY's core runs as a LaunchAgent: started at login, restarted if it dies.

| Setting | Value | Why |
|---|---|---|
| `RunAtLoad` | true | She should be there when you are |
| `KeepAlive` | true | Restart on crash |
| `ThrottleInterval` | 10s | **Prevents a crash loop from consuming the machine.** Five consecutive failures within a minute → boot into Safe Mode instead. |
| `ProcessType` | Background | |
| `Nice` | 5 | **Yields to your foreground work.** An assistant that makes your Mac feel slow has failed the Manifesto regardless of how well she works. |

### Sleep and wake

Your Mac sleeps; FRIDAY does not run while it does. This is the known limitation, handled here
rather than ignored:

- **Sleep imminent** — in-flight plans checkpoint and suspend; connections close cleanly
- **Wake** — the scheduler computes what was missed and **catches up**
- **Long sleep** — catch-up is capped. FRIDAY reports *"you were away 3 days; 14 scheduled checks
  were missed"* rather than firing all 14

Catch-up rather than fire-and-forget is the architectural answer to a laptop host. A scheduler that
silently missed its window would make FRIDAY unreliable invisibly; one that reports the gap is
honest about it.

---

## backup/

Three tiers, protecting against different failures
([Chapter 34](../docs/01-bible/34-disaster-recovery.md)):

| Tier | Mechanism | RPO |
|---|---|---|
| **Continuous** | Litestream → Backblaze B2, **encrypted before egress** | Seconds |
| **Daily snapshot** | Full consistent copy, encrypted | 24 h |
| **Local** | External drive + Time Machine | 24 h |

**RPO 0 for the audit trail** is the demanding requirement, and it is why Litestream is here rather
than periodic file copies.

### The two things that matter most

**Nightly restore verification.** Every night at 03:00, the latest backup is restored to a temporary
location, SQLite integrity is checked, **the audit hash chain is verified end to end**, and the copy
is destroyed. Any failure notifies at `urgent`.

> A backup you have never restored is not a backup. It is a hypothesis.

**The recovery card.** A printed card in a safe place containing the backup encryption key, the B2
credentials, the passkey recovery codes, and a short restore procedure. Without it, encrypted
backups are indistinguishable from random noise. Setup is not complete until it exists.

---

## otel/

OpenTelemetry collector configuration. **Optional and staged to M5** — only if the built-in
dashboard proves insufficient.

**Everything stays on localhost.** No telemetry leaves the machine. Operational data is not
anonymous: request timing reveals when you sleep, connector usage reveals what services you use.
Article IV applies to monitoring exactly as it applies to everything else.

Reference: [Chapter 33](../docs/01-bible/33-deployment-strategy.md),
[Chapter 29](../docs/01-bible/29-monitoring-observability.md).
