# ADR-0024 — Compaction and archival are Milestone 2 work

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md)

---

## Context

Two governing documents disagreed, and the disagreement was only noticed when Milestone 1 was
reviewed for completion.

[Chapter 10](../01-bible/10-event-bus.md) opens its growth-management section with: *"The log grows
forever. This is designed for from Milestone 1, not discovered at Milestone 6."* It then specifies
three storage tiers, compaction rules, a retention policy file with a schema, and an explicit list of
event classes compaction may **never** touch — approvals, Guardian decisions, external calls, model
invocations, self-modification events, and anything in their causation chains.

[Chapter 39](../01-bible/39-roadmap.md)'s Milestone 1 table lists six deliverables. None of them is
compaction, archival, or retention.

Milestone 1 was built to the table. The ledger, the integrity chain, the two dispatch lanes, and the
storage layer all exist and are tested; nothing implements tiering, compaction, or Parquet archival,
and there is no retention policy file.

So the question was not "should we build it" but "which document was right about *when*", and that
had to be answered rather than left as an inconsistency for the next contributor to trip over.

## Decision

We will **treat compaction, tiering, and Parquet archival as Milestone 2 deliverables**, and record
that in both chapters rather than quietly resolving it in one of them.

The *design* in Chapter 10 stands as written and is unchanged. What is deferred is the code.

## Constitutional review

- **Article II (Transparency):** untouched by the deferral. Nothing about compaction affects what is
  recorded — only what is later summarised. The log is complete either way, and at M1 volumes
  nothing needs summarising yet.
- **Article I (The User — data belongs to the user):** the deferral is the *safer* order. Compaction
  is the only routine operation that removes information, and running it before the integrity chain
  has been exercised in real use would mean the first thing to rewrite the log is a feature nobody
  has watched work.
- **Principle 6 (Architecture Is Sacred):** the retained columns and the chain design already
  accommodate compaction. Nothing about deferring it requires a schema change later.

**The five questions:**

- [x] **Can the user see it?** The deferral is recorded in both chapters and here.
- [x] **Can the user stop it?** When it arrives, altering retention is a `critical` risk-class
      action requiring approval — Chapter 10 is explicit and that is unchanged.
- [x] **Can we replace it?** Nothing has been built to replace.
- [x] **Can we explain it?** This document.
- [x] **Will this still be right in five years?** The deferral is a scheduling decision with a named
      milestone, not a permanent exemption.

**Notes:** The risk being accepted is stated plainly under Consequences: the log grows without bound
until M2 ships.

## Alternatives considered

### Build compaction now, to the letter of Chapter 10

**What it is.** Implement tiering, the retention policy file, and Parquet archival as part of M1.

**Advantages.** No inconsistency to record. Chapter 10's sentence stays literally true. Growth is
bounded from the first event, which is the strongest version of "designed for from M1".

**Why rejected.** Every one of those operations reads and rewrites the event log, so all of them
depend on the ledger, the chain, and the storage layer that M1 delivers — they cannot be built
*before* the thing they operate on, only after it, which puts them at the end of M1 or the start of
M2 regardless. Given the choice, the start of M2 is better: it means the first code to rewrite the
audit log does so against a chain that has been verified in real use rather than one that was
finished the same week. It would also have pushed M1 well past its estimate for a capability that
manages a problem FRIDAY does not yet have.

### Amend Chapter 10 to say "designed at M1, implemented later"

**What it is.** Edit the sentence so the documents agree, and write no ADR.

**Advantages.** Cheapest. One line.

**Why rejected.** It would erase the fact that the two documents ever disagreed, which is the part a
future contributor most needs to know. Chapter 37's whole argument for ADRs is that a document
quietly kept current implies you always thought this. A scope note pointing here preserves both the
original intent and the decision.

### Defer without recording it

**What it is.** Ship M1, leave the inconsistency.

**Why rejected.** It is exactly the failure mode the owner identified when reviewing M1: an
undocumented gap between what the Bible says and what the code does. The next person to read Chapter
10 would reasonably assume compaction exists.

## Consequences

**Positive**

- The two chapters agree, and the reason they once did not is preserved.
- M1 closes on its stated scope rather than growing to meet a sentence in another chapter.
- Compaction will be built against a storage layer and an integrity chain that have been exercised,
  which is the right order for the one operation that removes information.

**Negative**

- **`events.db` grows without bound until Milestone 2 ships.** At M1 volumes — a handful of events
  per day from a system that cannot yet act — this is measured in kilobytes, and M2 follows M1
  directly. If M2 slips substantially, this becomes a real cost rather than a theoretical one.
- **The rules about what compaction may never touch are not yet enforced by anything.** They are
  documented in Chapter 10 and nowhere else. When compaction is built, those rules need tests —
  ideally in `tests/constitutional`, which arrives in the same milestone.
- No retention policy file exists, so there is nothing for the owner to review or approve yet.

**Neutral**

- The `events` table already carries every column compaction will need. Deferring costs no migration.

## Reversibility

- **Cost to reverse:** low. Nothing was built that would have to be removed; reversing means
  building it sooner.
- **Point of no return:** none.

## Review triggers

- **Milestone 2 planning** — this is the first item to schedule, and the constitutional tests
  asserting what compaction may never touch should land with it.
- `events.db` exceeds 100 MB before M2 ships — the deferral's cost has become real.
- Milestone 2 slips past its estimate by more than 50% — reassess whether compaction should be
  pulled forward independently.

## Notes

What made this worth an ADR rather than a one-line edit: the inconsistency was found during a
milestone review, by asking "is M1 actually done?" against the documents rather than against the
task list. That question is the one that surfaced it, and Chapter 39's rule 5 — review at every
milestone boundary — is what made it get asked.
