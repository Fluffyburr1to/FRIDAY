# ADR-0019 — The hash chain is computed inside the append transaction

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 10 — Event Bus](../01-bible/10-event-bus.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md)

---

## Context

[Chapter 10](../01-bible/10-event-bus.md) places the hash chain in `packages/kernel`: the event log,
"with hash chaining for tamper evidence", is listed among the things the kernel owns. Chapter 09
describes the property the chain provides — each event's hash includes the previous event's, so
altering or deleting a historical event breaks every hash after it.

Neither chapter says where the hash is *computed*, because at the time of writing that looked like an
implementation detail. Milestone 1 made it a real question, for a reason neither chapter anticipated:

**Computing the hash requires reading the previous event, and assigning the sequence number requires
reading the current maximum. Both must happen in the same transaction as the insert, or two
concurrent appends can read the same predecessor and produce two events claiming the same position.**

Only `packages/storage` may open the database ([Chapter 09](../01-bible/09-database-design.md), and
enforced by `.dependency-cruiser.cjs`). So the choice was between giving the kernel a way to run
inside a storage transaction, or moving the hash computation into storage.

There is a second, subtler force. The hash must cover **the bytes that are stored**, not a value
re-derived from them. A `private` payload is encrypted before it reaches the column; if the kernel
hashed the plaintext and storage stored the ciphertext, verification could never reproduce the hash
without the key — and verifying the audit trail would require the ability to decrypt it, which is a
different and much worse property.

## Decision

We will **compute the integrity hash and assign the sequence number inside
`packages/storage`, within the append transaction**, over the exact bytes written to the `payload`
column. The kernel owns the bus semantics — validation, dispatch, the two lanes — and calls
`append` without knowing how the chain is formed.

## Constitutional review

- **Article II (Transparency):** strengthened. The chain is formed at the only point where it can be
  formed atomically, so there is no window in which an event exists unhashed or out of order.
- **Article VI (Modularity):** the kernel no longer needs to know the hash algorithm, and storage no
  longer needs to know what an event means. Each side's surface got smaller.
- **Principle 2 (Transparency Above All):** verification needs no key and no kernel — `friday verify`
  reads the file and recomputes.

**The five questions:**

- [x] **Can the user see it?** `friday verify` reports the result, and a break is a
      `diagnostics.chain.verified` event with `intact: false`.
- [x] **Can the user stop it?** Not applicable — this is a recording mechanism, not an action.
- [x] **Can we replace it?** The canonical form and hash function are one file
      (`packages/storage/src/event-hash.ts`). Changing them requires a chain version, not a rewrite.
- [x] **Can we explain it?** The chain is what makes explanation trustworthy in the first place.
- [x] **Will this still be right in five years?** Yes, unless the bus moves out of process — see
      review triggers.

**Notes:** The one thing given up is that `packages/kernel` cannot unit-test the chain without
storage. That is honest rather than unfortunate: a chain tested against a fake transaction would
prove nothing, because atomicity is the property under test.

## Alternatives considered

### Compute the hash in the kernel, pass it to storage

**What it is.** The kernel reads the last event, computes `seq` and `integrityHash`, and hands
storage a fully-formed row to insert.

**Advantages.** Matches Chapter 10's wording exactly. Keeps the chain logic beside the code that
reasons about events. Would let the kernel test hashing without a database.

**Why rejected.** The read and the write are then two operations, and nothing prevents a second
append between them. On a single-writer SQLite database that race is narrow, but it is real — and
"narrow race in the audit trail" is not a category we want to open. Closing it would mean exposing a
transaction handle from storage to the kernel, which is the boundary rule in everything but name.

### Give the kernel a `withTransaction` callback from storage

**What it is.** Storage exposes `runInTransaction(fn)`; the kernel does the reads, the hashing, and
the insert inside it.

**Advantages.** Keeps hashing in the kernel and keeps atomicity. Genuinely the closest thing to
having both.

**Why rejected.** It moves the boundary without removing it: the kernel would hold a live database
handle, and every future contributor would reasonably read that as permission to query. The rule
that survives a decade is the one with no exceptions, and the encryption problem below is not solved
by this alternative anyway.

### Hash the plaintext payload rather than the stored bytes

**What it is.** Canonicalise and hash the payload object, then encrypt separately for storage.

**Advantages.** The hash would be stable across a re-encryption — a key rotation would not
invalidate the chain.

**Why rejected.** Verification would require the field-encryption key. That makes checking the audit
trail depend on holding the secret that protects its contents, so a lost key would mean an
unverifiable history as well as an unreadable one. Key rotation is better handled by re-encrypting
into a new chain segment, which is a documented operation rather than a silent dependency.

## Consequences

**Positive**

- The sequence is gapless and the chain is unbroken by construction, not by discipline.
- `friday verify` needs no key, no kernel, and no running FRIDAY — it reads the file.
- Encrypted payloads chain exactly as plaintext ones do, and this is tested.
- The rollback semantics fall out for free: a failed sync subscriber rolls back the insert, and no
  sequence number is consumed.

**Negative**

- **Chapter 10's description of the kernel is now slightly wrong**, and this ADR is the only place
  that says so. Someone reading only the Bible will look for the chain in the wrong package.
- The chain cannot be unit-tested without a real database, so those tests are integration tests and
  are correspondingly slower.
- The canonical form lives in storage, which means adding a column to the events table requires
  remembering to add it to `canonicalise()`. A field left out would be outside the chain and
  therefore silently mutable. Guarded by a test, not by the type system.

**Neutral**

- `packages/kernel` gained a dependency on `packages/storage`, which the boundary rules already
  allowed.

## Reversibility

- **Cost to reverse:** medium.
- **How:** move `event-hash.ts` into the kernel and expose a transaction handle from storage. Every
  existing hash stays valid — the canonical form is unchanged by where it is computed — so no data
  migration is needed.
- **Point of no return:** none. The stored hashes do not encode where they were computed.

## Review triggers

- The event bus moves out of process (NATS, Postgres outbox) — the transaction argument changes
  completely, and the chain would have to be formed by whatever owns the write.
- A second writer is introduced to `events.db`.
- Key rotation becomes a real operation, rather than a hypothetical one.
- Any column is added to the `events` table — check it is in `canonicalise()`.

## Notes

The property that made this decision, stated once more because it is the thing to preserve: **the
hash covers the stored bytes.** Verification reads the `payload` column as a string and hashes it
without parsing it. A chain that depends on a JSON serialiser producing identical output years apart
is a chain that will break for a reason nobody can diagnose.
