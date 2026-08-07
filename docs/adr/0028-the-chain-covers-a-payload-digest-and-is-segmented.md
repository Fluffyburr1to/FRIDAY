# ADR-0028 — The integrity chain covers a payload digest, and is segmented

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [ADR-0019 — The hash chain is computed inside the append transaction](0019-the-hash-chain-is-computed-inside-the-append-transaction.md),
  [ADR-0024 — Compaction and archival are Milestone 2 work](0024-compaction-and-archival-are-milestone-2.md)

---

## Context

[ADR-0024](0024-compaction-and-archival-are-milestone-2.md) deferred compaction to this milestone
and noted that it "reads and rewrites the event log". Building it surfaces a conflict that neither
document anticipated.

The integrity chain hashes **the payload bytes exactly as stored**. That rule is deliberate and
`event-hash.ts` explains why: hashing a value re-derived from the stored bytes means the chain can
break because a JSON serialiser changed its key order in a minor release, which is a failure nobody
would ever diagnose.

Chapter 10 then asks compaction to do two things that are impossible under that rule:

1. **Collapse and trim payloads.** "Drop large payload bodies that are reproducible from elsewhere,
   keeping a reference." Replacing a payload changes the stored bytes, so the event's hash no longer
   matches and every hash after it fails.
2. **Move cold events out of `events.db` entirely**, into Parquet. A removed row is a removed link;
   a single continuous chain cannot survive it.

So the chain as built at M1 makes the growth management Chapter 10 specifies unimplementable. One of
them has to give, and it should be the mechanism rather than the guarantee.

There is a third thing pulling the same way. `packages/audit` is specified to support "redaction
with tombstones — content removed, chain preserved". That is the same requirement arriving from a
different direction, and it is not a growth concern at all: it is the owner's right to remove
something from their own records without destroying the evidence that the records are intact.

## Decision

Two changes, both to the mechanism and neither to the guarantee.

**1. The chain covers a digest of the payload, not the payload itself.**

`canonicalise` hashes `sha256(payload-bytes)` in place of the payload bytes. Every other field is
unchanged and still covered directly.

The stored row gains a `payload_digest` column, written inside the append transaction alongside the
hash. Verification uses the digest column, and separately checks that the stored payload — when
one is still present — hashes to it.

This gives two independent, separately reportable properties:

| Property | What a failure means |
|---|---|
| The chain verifies | The sequence of events is intact: nothing inserted, removed, or reordered. |
| Each payload matches its digest | The *content* is intact, for events that still have content. |

A compacted or redacted event fails the second by design and is expected to: its row records that
its content was deliberately removed, by whom, and when. It still passes the first. "The content is
gone and here is the proof that nothing else was touched" is exactly the property Chapter 10 and the
audit package both ask for, and it was not expressible before.

**2. The chain is segmented, and segments are sealed.**

Archival removes rows from `events.db`. Rather than pretending a chain can span a gap, a range that
leaves is **sealed**: its first and last sequence numbers and its final hash are recorded in a
`chain_segments` table, and the same values are written into the archive file. The live chain
continues from the sealed hash.

Verification then checks each live segment, checks that each sealed segment's recorded final hash is
the one the live chain continues from, and reports any segment whose events are no longer local as
*archived* rather than as *missing*. A gap that is not accounted for by a sealed segment is still a
broken chain.

**What does not change:** the hash is still computed inside the append transaction (ADR-0019), the
canonical form is still a positional array, and the rule that the chain covers the bytes rather
than a re-derivation still holds — it now covers a digest of those bytes, computed once, at the
moment they are written, and never recomputed from a parsed object.

## Constitutional review

- **Article II (Transparency):** strengthened. Content removal was previously undetectable-by-design
  because it was impossible; it is now recorded, attributable, and provable to have been the only
  thing that changed.
- **Article I (The User — the data is theirs):** this is what makes redaction possible at all. The
  owner can remove something from their own records without that act destroying their ability to
  prove the rest is intact.
- **Article V (Security):** the chain's actual guarantee — "we would know if it changed" — is
  preserved and made more precise, because tampering and deliberate removal are now distinguishable.
- **Principle 6 (Architecture Is Sacred):** this changes a load-bearing format at M2 rather than at
  M6. That is the argument for doing it now: the log is currently a few hundred events on one
  machine, and this becomes progressively harder every month.

**The five questions:**

- [x] **Can the user see it?** Compaction, archival, and redaction each record an event naming what
      was affected. Retention changes are `critical` and require approval.
- [x] **Can the user stop it?** Retention is owner-only configuration; nothing compacts without a
      policy the owner approved.
- [x] **Can we replace it?** The chain is confined to `event-hash.ts` and the verifier.
- [x] **Can we explain it?** "The chain proves nothing was inserted, removed, or reordered. A second
      check proves each event's content is the content that was recorded. Removing content fails the
      second on purpose, and says so."
- [x] **Will this still be right in five years?** Yes, and it will be increasingly expensive to
      adopt later. Doing it before there is a decade of log is the whole point.

## Alternatives considered

### Never compact; let the log grow forever

**Advantages.** No change to anything. The chain stays maximally simple, and simple is worth a lot
in the component that proves the audit trail is intact.

**Seriously considered.** At FRIDAY's actual volume this is defensible for years. It was rejected
because it does not solve redaction, which is not a size problem — Article I says the data is the
owner's, and "you may never remove anything from your own records" is not a position this project
can hold. Once tombstones are required, the chain has to tolerate content removal regardless of
whether anything is ever compacted for size.

### Recompute the chain forward from each compaction

**What it is.** Compact, then recompute every hash after the compacted event.

**Advantages.** No format change at all.

**Why rejected, firmly.** It makes the chain worthless. The property being bought is "we would know
if it changed", and a routine maintenance job that rewrites every hash after an arbitrary point is
indistinguishable from an attacker doing exactly that. It would also mean the one operation that
rewrites the audit log is the one operation that erases the evidence of rewriting.

### Keep the payload forever, compress it instead

**Advantages.** Smaller, and the bytes are recoverable, so the chain is untouched.

**Why rejected.** It addresses size and nothing else. Redaction still cannot be expressed, and
Chapter 10's "drop bodies reproducible from elsewhere" still cannot be done. Worth revisiting as a
*complement* — compressing warm payloads is orthogonal and cheap.

### A Merkle tree over segments rather than a linear chain

**Advantages.** Genuinely better for partial verification: proving one event belongs without reading
the whole range.

**Why rejected for now.** More machinery than a single-user log needs, and the linear chain plus
sealed segments already supports verifying a range without reading the others. Revisit if
verification time becomes a real cost, which it is nowhere near being.

## Consequences

**Positive**

- Compaction, archival, and redaction all become expressible without weakening the chain.
- Tampering and deliberate removal are distinguishable, which they were not before.
- Verification reports more precisely: sequence integrity and content integrity separately.

**Negative**

- **Every existing event's hash changes**, so the migration recomputes the chain. That is a rewrite
  of the audit log performed by a migration, which is precisely the operation this ADR argues should
  be visible — so the migration records what it did, and it is the last time the chain is recomputed
  wholesale.
- Verification is more to explain, because there are now two properties rather than one.
- A sealed segment whose archive file is lost is a permanent, detectable hole. That is correct
  behaviour and it is also a new way for the owner to lose something.

**Neutral**

- The digest costs one SHA-256 per append over bytes already being hashed.

## Reversibility

- **Cost to reverse:** high, and rising. Reversing means recomputing the chain again and discarding
  every tombstone's proof.
- **Point of no return:** the first archived segment. Until then, everything is still local and the
  chain could be rebuilt from the events themselves.

## Review triggers

- Verification time becomes noticeable → evaluate the Merkle alternative.
- The first archive file is lost or corrupted → the recovery story needs to be real, not designed.
- Any compaction is ever found to have touched a protected event class → stop-the-line.

## Notes

The order of discovery is worth recording. The chain was built at M1 to hash the stored bytes, for a
good reason that is still true. Compaction was deferred to M2 for a different good reason. Neither
decision was wrong, and together they produced an impossibility that only appeared when someone
tried to write the code. That is the normal way this happens, and it is why ADR-0024 said compaction
should be built against a chain that has been exercised rather than one finished the same week.
