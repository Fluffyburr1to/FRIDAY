# Runbooks

**Written for someone stressed, at 2am, who does not remember how this works.**

That is the audience, and it should shape every word. Not "restore the database" but the exact
command, the exact expected output, and what to do when it does not appear.

## Format

Every runbook has:

1. **Symptoms** — how you know this is the right runbook
2. **Impact** — what is broken right now, and what still works
3. **Immediate action** — stop the harm first, diagnose second
4. **Diagnosis** — the exact commands, with expected output
5. **Resolution** — numbered steps, no judgment calls left implicit
6. **Verification** — how you know it worked
7. **Follow-up** — what to do in the next 48 hours

## Planned runbooks

| Runbook | Milestone |
|---|---|
| Core will not start | M1 |
| Audit chain integrity failure | M2 |
| Restore from backup | M5 |
| Point-in-time recovery | M5 |
| Suspected credential compromise | M5 |
| Suspected prompt injection | M6 |
| Bad update / migration rollback | M4 |
| Connector authentication failure | M4 |
| Runaway cost | M3 |
| Disk full | M1 |

## Rules

1. **Updated within 48 hours of any incident**, with what actually happened.
2. **Exercised in the annual disaster drill** ([Chapter 34](../01-bible/34-disaster-recovery.md)).
   Runbooks written once and never exercised drift from reality — a command changes, a path moves, a
   step is missing.
3. **Every alert names its runbook.** An alert that says something is wrong without saying what to
   do is an alert you learn to dismiss.
4. **A runbook that proves wrong during an incident is a stop-the-line defect.**
