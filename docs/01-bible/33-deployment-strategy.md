# 33 — Deployment Strategy

> **Governing provisions:** Constitution Article III (Approval), Article IV (Privacy), Article V
> (Security), Article VII (Reliability); Manifesto Principle 8 (never silently implement),
> Principle 9 (Fail Gracefully).

---

## In plain language

Deployment is how code becomes a running FRIDAY on your machines.

FRIDAY's deployment situation is unusual and simpler than most software's. There is no fleet of
servers, no load balancer, no blue/green environment. There is **your Mac**, running one service and
one application, plus a phone app later.

That simplicity is genuine, and it means the interesting questions here are not about
infrastructure. They are about three things:

1. **How does FRIDAY stay running** when your Mac sleeps, wakes, and restarts?
2. **How does she update herself** without violating Article III?
3. **What happens when an update is bad?**

---

## What gets deployed

| Component | Form | Where |
|---|---|---|
| **`friday-core`** | Node.js service supervised by `launchd` | Your Mac, at login, always |
| **FRIDAY.app** | Signed, notarized Tauri app | `/Applications` |
| **Dashboard** | Served by core at `localhost` | No separate deployment |
| **`friday` CLI** | Binary, symlinked to `/usr/local/bin` | Optional |
| **Mobile app** | TestFlight or ad-hoc signed | Your iPhone (M7) |
| **Sidecars** | whisper.cpp, Piper, Ollama | Bundled or installed by setup |

**The core and the app are deployed separately and update independently.** This matters: you can
update the interface without restarting FRIDAY's brain, and vice versa. It also means a broken app
update does not stop FRIDAY from working — you can still reach her from a browser or the CLI.

---

## The core as a supervised service

`friday-core` runs as a `launchd` LaunchAgent, which means macOS starts it at login and restarts it
if it dies.

```
~/Library/LaunchAgents/com.friday.core.plist
  RunAtLoad          true
  KeepAlive          true, with a crash backoff
  ThrottleInterval   10s        ← prevents a crash loop from consuming the machine
  ProcessType        Background
  Nice               5          ← yields to your foreground work
```

**`ThrottleInterval` prevents the worst operational failure mode:** a bug causing an immediate crash
at startup would otherwise produce an infinite restart loop, consuming CPU and filling logs. Ten
seconds between attempts, escalating, and after five consecutive failures within a minute the core
starts in **Safe Mode** instead — which gives you a working dashboard that explains what is wrong
rather than a machine spinning.

**`Nice 5` is a small courtesy with real effect.** FRIDAY yields to whatever you are actually doing.
A personal assistant that makes your laptop feel slow has failed the Manifesto's user-experience
requirements regardless of how well she works.

### Sleep and wake — the laptop problem

Your Mac sleeps. This is the known limitation from [Chapter 01](01-executive-summary.md), and the
deployment layer is where it is handled.

| Event | Behavior |
|---|---|
| Sleep imminent | Core receives a notification; in-flight plans checkpoint and suspend; connections close cleanly |
| Asleep | Nothing runs. Scheduled work does not fire. |
| Wake | Core resumes; **the scheduler computes what was missed and catches up** |
| Long sleep (> 24h) | Catch-up is capped — FRIDAY reports "you were away 3 days; 14 scheduled checks were missed" rather than firing all 14 |

**Catch-up rather than fire-and-forget is the architectural answer to the laptop host.** A scheduler
that simply missed its window would make FRIDAY unreliable in an invisible way. One that computes
missed work and either performs it or reports it is honest about the gap.

The catch-up cap exists because firing 14 missed hourly checks on wake would be both useless and
expensive. FRIDAY tells you what she could not do. Article II.

---

## Updates

### The flow

```
1  You release ([Chapter 27](27-cicd-pipeline.md)) — manually signed
2  FRIDAY checks the update feed (daily, or on demand)
3  Signature verified against the pinned public key
       ↳ FAILS → refuse, alert as a security event, do not retry silently
4  FRIDAY NOTIFIES YOU: version, plain-language changes, size
5  ★ YOU CONSENT                       ← Article III
6  Pre-update snapshot: database + current binaries
7  Download, verify again, stage
8  Core drains: finish in-flight plans, suspend the rest, stop cleanly
9  Swap · run migrations · start
10 Health check within 60s
       ↳ FAILS → AUTOMATIC ROLLBACK to the snapshot
11 Confirm to you; record the update as an audited event
```

### Why updates require consent

Step 5 is where this differs from nearly all modern software, which updates silently by default.

Article III: *"Actions that could materially affect the user's data, security, or software require
explicit approval."* An update replaces **all of FRIDAY's code**. That is the most materially
affecting action possible, and Principle 8 is unambiguous that she should never silently implement
changes.

The counterargument — that silent updates are better for security because they close vulnerabilities
faster — is real. It is addressed by making security updates *prominent* rather than *automatic*:
a security update is marked as such, notified at `urgent` urgency, and explains what it fixes. You
can approve it in one tap. But you approve it.

The one narrow exception, which I recommend you enable: **a "critical security" class of update may
be pre-authorized by a standing grant** you create deliberately, with an expiry, like any other
standing grant ([Chapter 19](19-approval-system.md)). That keeps the decision yours while allowing
fast response to a genuine emergency.

### Automatic rollback

Step 10 is the safety net. If the newly-updated core does not report healthy within 60 seconds, the
previous version and database snapshot are restored automatically and you are told what happened.

This is what makes updates safe enough to accept readily. The failure mode of "I approved an update
and now FRIDAY is broken and I don't know how to fix it" is eliminated — she fixes it herself and
reports.

**Rollback is only automatic for startup failures.** A subtly-wrong update that starts fine but
behaves badly requires you to notice and trigger `friday rollback`, which restores the previous
version and offers to restore the pre-update database snapshot.

### Migrations and rollback

Database migrations are forward-only ([Chapter 09](09-database-design.md)). Rolling back code past a
migration therefore requires restoring the pre-update snapshot, which is why step 6 exists and is
not optional.

The window between the snapshot and the rollback is small (minutes), so data loss is bounded to
whatever happened during the failed update. This is stated explicitly rather than glossed: **rolling
back across a migration loses the minutes of data since the snapshot.** It is the correct trade
against a corrupted database, and it is why migrations are additive by default.

---

## Configuration

Precedence, lowest to highest: built-in defaults → `config.toml` → environment variables → runtime
overrides.

| Rule | Reason |
|---|---|
| **All configuration is validated at startup with Zod.** Invalid config → Safe Mode with a clear message. | A typo in a config file should produce an explanation, not a mysterious failure three hours later |
| **No secrets in configuration files.** Keychain references only. | [Chapter 18](18-security-model.md) |
| **`.env.example` documents every variable** with no real values. | Discoverability |
| **Changing configuration is an audited event.** | Article II |
| **Some configuration requires approval to change** — budgets, retention, Guardian settings. | Article III |
| **`process.env` is read only in `packages/config`.** | One validated place |

---

## Environments

There are three, and only one of them is real:

| Environment | Purpose | Data |
|---|---|---|
| **Development** | Your working copy | Synthetic fixtures only |
| **Staging** | A second FRIDAY instance on your Mac, different port and database | **Copied and anonymized** from production |
| **Production** | The real FRIDAY | Your actual life |

**Staging is not a server — it is a second instance you can run locally.** Its purpose is testing
risky changes (a migration, a new connector, a Guardian policy change) against realistic data
without touching the real thing.

**Staging data is anonymized on copy**, by a script that redacts message bodies, replaces names and
addresses, and strips credentials entirely. Using a raw production copy for testing would mean a bug
in an experimental connector could email your actual contacts. The anonymization script runs as part
of `friday staging refresh` and cannot be skipped.

---

## Alternatives considered

### Cloud deployment (a VPS running the core)

**Advantages:** always on — which directly solves the laptop-sleep limitation. Reachable from
anywhere without a VPN. Not affected by your Mac's state at all.

**Rejected as the primary model** because it means your entire life's data lives on a rented machine
you do not physically control, in direct tension with Article IV. It also adds cost, server
maintenance, and a network dependency for local operations.

**This is the most likely future change**, and it is scheduled: Milestone 5 evaluates moving the
core to always-on hardware. The recommendation there is a **machine you own** (a Mac Mini) rather
than a rented one, which gets the always-on property while keeping the data local. The architecture
supports either because the core is relocatable by design.

### Docker containers

**Advantages:** reproducible environments, clean dependency isolation, easy migration between hosts.

**Rejected** because FRIDAY needs deep macOS integration — Keychain, notifications, microphone, menu
bar — which containers make awkward or impossible. Docker Desktop also consumes substantial memory
on a laptop for no benefit at one instance.

### Automatic silent updates

**Advantages:** security patches land immediately; no user friction; the modern default.

**Rejected** — Article III and Principle 8. Mitigated by making security updates prominent and
one-tap, and by the optional pre-authorized security-update grant.

### Homebrew distribution

**Advantages:** familiar to developers; handles updates; easy install.

**Rejected as primary** because Homebrew's update model is not consent-based, and because FRIDAY's
target user is you, not a general developer audience. **A Homebrew formula may be provided later**
as a convenience for initial installation.

### Mac App Store distribution

**Rejected** — App Store sandboxing would prevent the deep system access FRIDAY requires
(background service, arbitrary file access, keychain, launch at login), and it would subject
FRIDAY's release cadence to Apple's review process.

### Blue/green or canary deployment

**Rejected** as meaningless for a single instance with a single user. The equivalent property —
"revert quickly if the new version is bad" — is provided by snapshots and automatic rollback.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **The core does not run while your Mac sleeps.** | Accepted for now, with catch-up scheduling as the mitigation and an always-on host scheduled for M5. This is the largest known limitation in the architecture. |
| **Manual release signing** means releases require you. | Accepted — the signing key is the most dangerous key in the system. |
| **Update consent adds friction** to security patches. | Accepted, mitigated by urgency marking and an optional pre-authorized security grant. |
| **Rolling back across a migration loses minutes of data.** | Accepted and stated plainly. Better than a corrupted database. |
| **Staging is a second local instance**, not a true replica. | Accepted — sufficient for one user, and it keeps data local. |
| **No containers means environment differences** between your machine and any future one. | Accepted — one machine today; Node version pinning covers most of it. |

---

## Review triggers

- **Milestone 5** → formally evaluate moving the core to always-on hardware
- Sleep-related missed work becomes materially disruptive → accelerate that move
- Update failures requiring manual recovery occur more than once → the rollback mechanism is
  insufficient
- A second person uses FRIDAY → deployment to a second machine needs a real story
- macOS changes `launchd` behavior in a way that affects supervision

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
