# operations — System Health and Maintenance

**FRIDAY's first department.** Milestone: **M5**

## Charter

Keeps FRIDAY healthy. Chosen as the first department because it exercises the entire framework —
manifest, capabilities, events, policies, the Guardian — with **zero external risk**. It touches no
personal data and calls no external service.

## The two capabilities, and why this pair

| Capability | Risk | Behaviour |
|---|---|---|
| `run-self-check` | `low` | Runs without asking |
| `compact-event-log` | `high` | **Asks every time.** No standing grant can cover it |

★ **The pair is the point.** Between them they prove both halves of M5's done-when: work that
proceeds, and work that stops for the owner. And the second is a real approval rather than a
contrived one — compaction rewrites the record of everything FRIDAY has done, which is the record
the owner would use to check up on her.

## ★ This department decides nothing

A capability describes what it would do and asks. **The Guardian decides.** Nothing here reads a
policy, and nothing here checks its own permission — `departments/README.md` makes that a boundary
rule rather than a convention: *no department implements authorization.*

That matters most for `compact-event-log`. A capability that authorised itself would be a second
authority, and the one that edits the audit trail is the worst possible place to start.

## What it does NOT own

- Deciding whether to *apply* an improvement — she proposes; you decide
- Anything touching personal data
- Any external service

## Owns, eventually

Chapter 23 lists twelve scheduled checks and this department will run them. **One is built** — the
audit chain, which Chapter 23 calls the most important check in the system. The rest need
subsystems that arrive at M7.

Reference: [Chapter 23](../../docs/01-bible/23-diagnostics-system.md),
[Chapter 13](../../docs/01-bible/13-department-architecture.md)
