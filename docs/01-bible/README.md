# The FRIDAY Project Bible

**Version:** 1.0
**Status:** Ratified engineering foundation
**Date:** 2026-08-06
**Author:** Engineering Lead
**Supersedes:** nothing (first edition)

---

## What this is

This is the engineering foundation for Project FRIDAY. It is the document a new contributor —
human or AI — reads before touching anything. It explains what we are building, what we chose to
build it with, why we chose those things, what we rejected, and what we gave up in exchange.

It is subordinate to the [founding documents](../00-foundation/). Where this Bible conflicts with
the Manifesto, Constitution, Core Values, or Long-Term Vision, **the founding document wins and
this Bible is wrong**.

## How to read it

Every chapter follows the same shape, because the project owner asked for it and because it is
how real architecture decisions should be recorded:

1. **In plain language** — what this is, with no jargon, for a reader who does not write code.
2. **The recommendation** — what we are doing.
3. **Why** — the reasoning, tied back to specific Articles and Principles.
4. **Alternatives considered** — what else was on the table, honestly described.
5. **Trade-offs** — what this choice costs us. Every choice costs something.
6. **The long-term call** — what happens to this decision in five years, and what would make us
   change it.

If you are the owner and you do not code: **read the "In plain language" and "Trade-offs" sections
of every chapter and skip the rest.** That is enough to govern this project competently.

## The chapters

### Part I — Foundation

| # | Chapter | What it settles |
|---|---|---|
| 01 | [Executive Summary](01-executive-summary.md) | The whole design in ten minutes |
| 02 | [Technology Stack](02-technology-stack.md) | What we build with, and why |
| 03 | [Repository Structure](03-repository-structure.md) | Where every file lives |
| 04 | [Monorepo vs Multi-Repo](04-monorepo-vs-multirepo.md) | One repository or many |

### Part II — System Architecture

| # | Chapter | What it settles |
|---|---|---|
| 05 | [Backend Architecture](05-backend-architecture.md) | The shape of FRIDAY's core |
| 06 | [Frontend Architecture](06-frontend-architecture.md) | How the interface is built |
| 07 | [Desktop Strategy](07-desktop-strategy.md) | Mac, Windows, Linux |
| 08 | [Mobile Strategy](08-mobile-strategy.md) | iPhone, Android |
| 09 | [Database Design](09-database-design.md) | Where data lives and how it is shaped |
| 10 | [Event Bus Architecture](10-event-bus.md) | FRIDAY's nervous system |

### Part III — The Organization

| # | Chapter | What it settles |
|---|---|---|
| 11 | [Agent Framework](11-agent-framework.md) | What an agent is and what it may do |
| 12 | [Chief of Staff Architecture](12-chief-of-staff.md) | How work gets planned and delegated |
| 13 | [Department Architecture](13-department-architecture.md) | How capabilities are grouped |
| 14 | [Connector Framework](14-connector-framework.md) | Talking to the outside world |
| 15 | [Plugin System](15-plugin-system.md) | Extending FRIDAY without forking her |
| 16 | [Memory System](16-memory-system.md) | What FRIDAY remembers and how |

### Part IV — Trust and Safety

| # | Chapter | What it settles |
|---|---|---|
| 17 | [Authentication & Authorization](17-authentication-authorization.md) | Who is asking, and may they |
| 18 | [Security Model](18-security-model.md) | Threats and defenses |
| 19 | [Approval & Consent System](19-approval-system.md) | Article III, made real |
| 20 | [API Standards](20-api-standards.md) | How software talks to FRIDAY |
| 21 | [Internal Communication Protocols](21-internal-protocols.md) | How FRIDAY talks to herself |

### Part V — Operations

| # | Chapter | What it settles |
|---|---|---|
| 22 | [Logging Standards](22-logging-standards.md) | The written record |
| 23 | [Diagnostics System](23-diagnostics-system.md) | How FRIDAY checks her own health |
| 24 | [Notification Framework](24-notification-framework.md) | When FRIDAY is allowed to interrupt |
| 25 | [Voice System Architecture](25-voice-architecture.md) | Speaking and listening |
| 26 | [Dashboard Architecture](26-dashboard-architecture.md) | The window into the organization |
| 27 | [CI/CD Pipeline](27-cicd-pipeline.md) | How code becomes a running system |
| 28 | [Testing Strategy](28-testing-strategy.md) | How we know it works |
| 29 | [Monitoring & Observability](29-monitoring-observability.md) | Knowing what is happening right now |

### Part VI — Process and Governance

| # | Chapter | What it settles |
|---|---|---|
| 30 | [Coding Standards](30-coding-standards.md) | How code is written here |
| 31 | [Git Workflow](31-git-workflow.md) | How changes are proposed and accepted |
| 32 | [Branch Strategy](32-branch-strategy.md) | The branch model |
| 33 | [Deployment Strategy](33-deployment-strategy.md) | Getting FRIDAY onto your machines |
| 34 | [Disaster Recovery](34-disaster-recovery.md) | When things go badly wrong |
| 35 | [Performance Goals](35-performance-goals.md) | The numbers we hold ourselves to |
| 36 | [Risk Register](36-risk-register.md) | What could kill this project |
| 37 | [ADR Process & Template](37-adr-process.md) | Recording decisions forever |
| 38 | [Documentation Standards](38-documentation-standards.md) | How we write things down |
| 39 | [Development Roadmap](39-roadmap.md) | Milestones, in order, with dates |

### Appendix

| # | Chapter | What it settles |
|---|---|---|
| 40 | [Founding Document Observations](40-founding-document-observations.md) | Gaps and proposed amendments — **proposals only, never applied** |
| 41 | [Glossary](41-glossary.md) | Every term, in plain language |

---

## The constraints this Bible was written under

These came from the project owner and are treated as fixed inputs, not open questions.

| Constraint | Value |
|---|---|
| Deployment model | Hybrid — local core, cloud reasoning only when needed |
| Target platforms | macOS desktop, iPhone, web; Windows/Android later |
| Host machine (initial) | The owner's primary Mac |
| Users | One (the owner); data model must support family later |
| Operating budget | $50–200/month |
| Engineering capacity | The owner directing AI assistants, 10–20 hrs/week, multi-year |
| First milestone | **The Core**, not user-facing features |
| Self-modification | FRIDAY proposes, tests, and explains; the owner approves every merge |
| Language policy | One language across the entire stack |

## The one-sentence summary

> FRIDAY is a locally-hosted, event-sourced, plugin-based orchestration kernel written entirely in
> TypeScript, in which every action is authorized by policy, recorded immutably, and explainable on
> demand — and in which the user's approval is a structural requirement of the runtime rather than
> a feature of the interface.

## Change control

This Bible changes by pull request, like code. Material changes require an
[ADR](../adr/). Chapters carry their own version history at the bottom. The Bible is expected to
be wrong about some things within a year; being wrong and correcting the record in public is the
system working as designed.
