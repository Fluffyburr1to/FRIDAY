# operations — System Health and Maintenance

**FRIDAY's first department.** Milestone: **M3**

## Charter

Keeps FRIDAY healthy. Chosen as the first department because it exercises the entire framework —
manifest, capabilities, agents, events, policies — with **zero external risk**. It touches no
personal data and calls no external service.

## Owns

- Running scheduled self-checks and reporting results
- Backup execution and **nightly restore verification** (including audit chain integrity)
- Log rotation, event log compaction, and archival
- Credential and standing-grant expiry warnings
- Assembling the daily digest
- Turning diagnostics findings into improvement proposals

## Does NOT own

- Deciding whether to *apply* an improvement — she proposes; you decide
- Anything touching personal data
- Any external service

## Notable

The nightly restore verification is the highest-value thing this department does. A backup that has
never been restored is a hypothesis, and the failure is always discovered during the disaster.

Reference: [Chapter 23](../../docs/01-bible/23-diagnostics-system.md),
[Chapter 34](../../docs/01-bible/34-disaster-recovery.md)
