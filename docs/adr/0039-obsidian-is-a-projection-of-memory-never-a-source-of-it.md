# ADR-0039 — Obsidian is a projection of memory, never a source of it

- **Status:** accepted — 2026-08-17. **Binds M7, not M5**; see §0.
- **Date:** 2026-08-12
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 16 — Memory System](../01-bible/16-memory-system.md),
  [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 18 — Security Model](../01-bible/18-security-model.md),
  [ADR-0004 — Event-sourced core](0004-event-sourced-core.md),
  [ADR-0032 — The Guardian's state moves into the event log database](0032-the-guardians-state-moves-into-the-event-log-database.md),
  [`packages/memory/README.md`](../../packages/memory/README.md) — the charter this decision
  constrains, still an empty directory

---

## Context

The owner wants to read what FRIDAY knows in Obsidian: Markdown, wikilinks, folders he can open in
any editor on any machine in twenty years. That is a real requirement and a good one. Article I says
his data belongs to him, and a format that needs FRIDAY running in order to be legible is a weaker
form of ownership than a format that does not.

The question this ADR settles is not whether the vault exists. It is **which artifact is allowed to
be wrong.**

### What Chapter 16 already requires

[Chapter 16](../01-bible/16-memory-system.md) specifies four layers and one rule it calls
non-negotiable:

> **Every memory points back to the specific event where FRIDAY learned it. No provenance, no
> storage.**

Around that rule sit confidence scores, sensitivity classification, supersession that retains the
superseded entry, and conflict resolution that **asks the owner** rather than overwriting. The
chapter names the failure these exist to prevent, and names it as the most dangerous in the system:

> **A confidently wrong memory is worse than no memory at all.**

### What a Markdown vault cannot do

A `.md` file has no provenance, no confidence, no supersession chain, and no sensitivity class. It
has whatever its text says. Those are not gaps to be filled with more frontmatter — a `source_event`
field in YAML is a *claim* about provenance, not provenance, because nothing prevents it being
edited, copied between files, or written by hand.

So if the vault were authoritative, every mechanism Chapter 16 is built from would become
unenforceable at exactly the layer the owner reads from. FRIDAY would answer "why do you think that?"
with "it is written in `wiki/Sarah Chen.md`", which is the fluent, plausible, unfalsifiable answer
Chapter 16 exists to make impossible.

### What we did not know

Whether the owner wanted Obsidian as the store or as the surface. The original brief said *"Obsidian
becomes FRIDAY's long-term memory"* and *"if it is not in the vault, FRIDAY does not permanently
remember it"*, which reads as the store. Asked directly on 2026-08-12, he chose the surface, and
added the constraint this ADR is named after: **the vault must not become a second source of truth
that can contradict the authoritative memory system.**

That answer is what makes this decision cheap. Had it gone the other way, this would be a proposal to
amend Chapter 16, and a much longer document.

### What does not exist yet

`packages/memory` is an empty directory with a charter. There is no memory system to project. This
ADR is therefore written **before** the thing it constrains, deliberately: the projection boundary is
much easier to hold if it is decided before there is code with an opinion about it.

---

## Decision

### 0. When this applies — added at acceptance, 2026-08-17

**This ADR constrains the memory work at M7. It creates no M5 obligation and no M5 deliverable.**

It was drafted on 2026-08-12 alongside [ADR-0040](0040-a-capability-is-a-department-inside-the-guardian-boundary.md),
whose §5 listed a `vault` capability as reachable at M5 and named this ADR's projector as its
dependency. **That linkage is withdrawn** — see ADR-0040 §5, revised at acceptance. `packages/memory`
is empty, the four-layer memory system is M7 in
[Chapter 39](../01-bible/39-roadmap.md), and nothing about a projection is buildable before the thing
it projects.

Accepting it now is deliberate and costs nothing to build: the value of this decision is entirely in
being made *before* there is code with an opinion, which is the argument the Notes below already
make. The owner accepted it on that basis on 2026-08-17, with the M5 linkage removed.

---

We will **treat the Obsidian vault as a one-way, regenerable projection of authoritative memory.
FRIDAY writes it and never reads it as truth.**

The chain is one-directional, and every arrow is a downgrade in authority:

```
  event log            authoritative, immutable, hash-chained
      │                provenance lives here and only here
      ▼
  memory system        authoritative belief: confidence, sensitivity,
      │                supersession, conflict resolution
      ▼
  Obsidian vault       a rendering. Derived. Disposable.
```

### 1. The regeneration test

**The vault can be deleted at any moment and rebuilt from the authoritative stores, and nothing is
lost.** That single property is what makes "not a second source of truth" a fact rather than a
promise, and it is the acceptance test for the projector.

It is worth stating in the inverted form, because that is the form that will be tested: **if
regenerating the vault ever loses something, the projector has a bug and the vault has been holding
state it was not entitled to hold.**

### 2. Structure

The owner's proposed layout is adopted, mapped onto Chapter 16's layers:

| Path | Projects | Chapter 16 layer |
|---|---|---|
| `raw/` | Captured material as recorded — transcripts, imports, dumps | L1 episodic (event log) |
| `wiki/` | One page per subject FRIDAY holds beliefs about, wikilinked | L2 semantic, L3 procedural |
| `outputs/` | What FRIDAY produced for the owner — plans, briefs, reports, dated | plan and department output |
| `index.md` | Every projected page, one line each | — |
| `changes.md` | Append-only log of what the projector wrote and why | — |
| `CLAUDE.md` | The memory contract, for any assistant that opens the vault | — |

`vault/CLAUDE.md` must state plainly that the vault is downstream, that editing a file does not
change what FRIDAY believes, and where the authoritative record is. An assistant that opens the vault
without that sentence will reasonably assume it is the source, and act on it.

**Naming.** `kebab-case.md` throughout, matching the repository's file convention. `outputs/` is
date-prefixed and sorts chronologically: `outputs/2026-08-12-daily-plan.md`. `raw/` is prefixed with
the capture timestamp, because two transcripts on one subject on one day is the normal case, not the
exception. `wiki/` pages are named for their subject and are **stable** — a page that renames breaks
every wikilink pointing at it, and the projector does not get to rename the owner's reading material
because a memory's summary changed.

**Linking.** `wiki/` pages link to each other with `[[subject]]`. The projector may only emit a link
to a page it has projected or is projecting in the same pass; a link to a page that does not exist is
a dead end for the reader, and the graph is the reason the vault is worth having. Links are derived
from relationships the memory system holds, not inferred from text matching — FRIDAY guessing that
two pages are related because they share a word is precisely the confident wrongness Chapter 16
forbids, arriving through a side door.

**`index.md` and `changes.md`.** The index is one line per page — link and hook, nothing more; it is
regenerated whole on every pass. `changes.md` is append-only, and it is a **narrative for the owner,
not an audit trail** — the audit trail is the event log, and `changes.md` must never be cited as
evidence of anything. Historical entries are never rewritten, on the same reasoning as
[ADR-0004](0004-event-sourced-core.md), though with none of the guarantees.

### 2a. Where the vault lives — and where it must not

**The vault root is a single configured path** (`packages/config`, per
[ADR-0022](0022-toml-for-the-configuration-file.md)), defaulting to `${FRIDAY_DATA_DIR}/vault`
alongside the databases. FRIDAY writes nowhere else on the filesystem under this decision — the
owner's safety rule, adopted as a boundary rather than a habit.

**★ The vault must never live inside a git working tree, and this is not a style preference.** The
owner named `~/Projects/friday/vault` on 2026-08-12 — a path inside this repository, which has a
GitHub remote — while §4 permits `private` content in the vault. The failure is one `git add .` away,
it is silent, and **it is not recoverable**: rewriting history on a pushed branch does not un-disclose
anything. `.gitignore` already states the principle for the databases: *"Her databases contain the
owner's life."* The vault holds the same life, in plaintext, in a folder built for syncing.

The vault as actually created that day landed outside the checkout, so nothing was exposed. The rule
is recorded because the near miss was one dialog box wide, and because the next person to place a
vault will not have had this conversation.

If a vault is nonetheless wanted at a path inside the checkout — and there is a fair reason to, since
Obsidian likes a stable folder — then the path is ignored in `.gitignore` **in the same change that
creates it**, never afterwards, and the release audit gains a check that no artifact ever contains
one. The configured default remains outside the tree.

Two smaller consequences of a vault inside the repo, neither fatal and both worth knowing: the docs
gate requires a `README.md` in every directory it walks, so `vault/` would fail `pnpm check` until it
is ignored; and a vault under `packages/` or `apps/` would enter the dependency-cruiser graph.

### 3. Provenance travels, but the vault is not where it lives

Every projected page carries frontmatter naming the events and memory entries it was rendered from,
so that a page can always be traced back:

```yaml
---
title:                          the subject, as the owner would say it
type:            raw | wiki | output
tags:            []             derived from memory, not invented by the renderer
created:                        when the underlying knowledge was first recorded
updated:                        when it last changed — not when the file was rewritten
summary:                        one line; what a reader learns by opening this
sensitivity:     public | internal | private        ★ §4; `secret` never appears
friday_source:   [evt_…]        ★ the events this was rendered from
friday_memory:   [mem_…]        ★ the memory entries, where applicable
friday_rendered: <timestamp>    ★ when the projector last wrote this file
---
```

Every field is filled with a real value or omitted. A projector that writes `summary:` empty, or
`tags: []` because it had nothing, is producing a page that looks classified and is not — and the
vault's whole value is that it can be skimmed. `created`/`updated` describe the *knowledge*, not the
file: a page rewritten by a projector improvement did not change what FRIDAY knows, and must not
claim it did.

The `friday_*` keys are **a convenience for the reader, not a mechanism.** They are how the owner
gets from a sentence in Obsidian to the event that produced it. They are not consulted by FRIDAY, and
a hand-edited one changes nothing, because the authoritative link is held in the memory store in the
other direction.

### 4. Sensitivity: the vault is plaintext on disk

This is the part with a real cost, and it needs stating rather than assuming.

`private` data in the database is encrypted with a Keychain key
([Chapter 09](../01-bible/09-database-design.md)). **The same fact projected into `wiki/` is a
plaintext file** — in whatever Obsidian sync the owner turns on, in Time Machine, in any backup, and
readable by every process running as him. Projection is therefore a genuine downgrade in protection,
not a neutral copy.

The rules:

| Level | Projected? |
|---|---|
| `public`, `internal` | Yes |
| `private` | **Only if the configured ceiling allows it.** Default: yes — the vault's purpose is for the owner to read his own life, and a vault holding only `internal` telemetry is not worth having |
| `secret` | **Never, under any configuration.** It does not reach the database either — storage rejects it |

Credentials, keys, and tokens are never projected, and this is not a matter of classification: the
vault is not a place secrets may exist, and a projector capable of writing one is a defect regardless
of whether it ever does.

### 5. Manual edits are proposals, never beliefs

The owner will edit the vault. He should — that is what it is for. What must not happen is that the
edit silently becomes something FRIDAY believes.

- **The vault is never read back as truth.** No exceptions.
- An edited file is **not** silently overwritten either. The projector detects divergence and reports
  it rather than destroying the owner's writing.
- If an edit *should* become memory, it goes through the same ingestion path as anything else:
  proposed as a candidate, with provenance recorded as *the owner edited this file at this time*,
  through the filtering and conflict checks Chapter 16 specifies.

**The owner saying something is the most authoritative source FRIDAY has** — Chapter 16's conflict
table already ranks it that way. This decision does not lower it. It requires that it arrive through
a door that records it, rather than by a file changing on disk with nothing knowing why.

### 6. What this does not change

- **Chapter 16 stands unamended.** Four layers, mandatory provenance, hybrid recall, supersession.
- **The storage boundary stands.** Nothing outside `packages/storage` touches the database; the
  projector reads through the memory interface, not through SQLite.
- **The event log remains the only immutable record.** The vault is not a backup and must never be
  described as one — `changes.md` is a narrative, not an audit trail.

---

## Constitutional review

- **Article I (Your data is yours):** the strongest argument *for* the vault. Plain Markdown outlives
  FRIDAY, this repository, and this decision.
- **Article II (Transparency):** a vault the owner can read without a running service is inspection
  that does not depend on FRIDAY being honest at the moment he asks.
- **Article IV (Privacy):** in tension, and named rather than reconciled. §4 moves `private` content
  from an encrypted database to a plaintext file. The mitigation is a configured ceiling and a hard
  floor at `secret`; the residual risk is real and is the negative consequence below.
- **Article VIII (Learning):** §5 is what keeps this honest. Adopting a hand-edited file as belief
  would be exactly the silent learning the Manifesto forbids.

**The five questions:**

- [x] **Can the user see it?** — this decision is *entirely* about the user seeing it.
- [x] **Can the user stop it?** — projection is configurable, and deleting the vault costs nothing.
- [x] **Can we replace it?** — the projector sits behind the memory interface; Obsidian is a folder
      of Markdown, which is the least proprietary target available.
- [x] **Can we explain it?** — `friday_source` gets the owner from a sentence to an event.
- [ ] **Will this still be right in five years?** — **the direction will be. The ceiling default may
      not.** §4 defaults to projecting `private`, which is the right call for a single-user machine
      the owner controls and the wrong one the first time the vault syncs somewhere he does not.

---

## Alternatives considered

### A. Obsidian as the authoritative memory

**What it is.** The owner's original brief. The vault is where FRIDAY remembers; there is no separate
memory store.

**Advantages.** One artifact rather than two, so it can never disagree with itself. Radically
portable and inspectable. No projection to write, no divergence to detect, no ADR needed. Genuinely
simpler, and simplicity is Principle 10.

**Why rejected.** It gives up provenance, confidence, supersession, and permission-filtered recall in
one move, and those are not features — they are the entire content of Chapter 16. The failure mode is
the one that chapter names first: a file that reads as fact, is wrong, and can be neither dated nor
sourced nor superseded. **The owner rejected this himself on 2026-08-12**, and this entry exists so
that the next person to propose it finds the argument rather than re-running it.

### B. Two-way sync

**What it is.** Edit in Obsidian, and changes flow back into memory automatically.

**Advantages.** The most pleasant to use by a wide margin — correcting FRIDAY becomes editing a
sentence. Removes the awkwardness of §5, where the owner edits a file and nothing happens.

**Why rejected.** Bidirectional sync between an immutable log and a mutable folder has no correct
conflict rule. Last-writer-wins means a text editor can silently overwrite an audited belief, and any
other rule requires the vault to hold merge state — which makes it exactly the second source of truth
the owner ruled out. §5 keeps the ergonomics available through ingestion, at the cost of a step.

### C. No vault; the dashboard is the only window

**What it is.** Drop Obsidian. Chapter 26 already promises inspection down to the raw event.

**Advantages.** Nothing to project, no plaintext copy of `private` data, no divergence, and one
window instead of two. Article IV is strictly better served.

**Why rejected.** Everything is legible only while FRIDAY runs. The owner's request is for knowledge
he can hold, link, search, and keep, and a React app over tRPC is not that. This alternative is the
strongest one on privacy grounds alone, and §4 is where the price is paid.

### D. Export on demand rather than continuous projection

**What it is.** `friday export --vault` when the owner wants a snapshot.

**Advantages.** No background writer, no divergence detection, no staleness. The cleanest possible
version of "derived".

**Why rejected as the primary mode, but retained.** A vault that is only current when remembered is
one the owner stops trusting, and a knowledge graph nobody opens is not a memory. **This remains the
fallback** if continuous projection proves noisy, and it is the natural first implementation.

---

## Consequences

**Positive**

- Chapter 16's guarantees survive contact with the feature most likely to have eroded them.
- The owner gets Markdown he can read, link, grep, sync, and keep, with a route back to the event
  behind any sentence.
- The vault is disposable, which makes the projector safe to rewrite — a bad render is fixed by
  regenerating rather than by migrating.
- The projector is a pure function of authoritative state, so it is testable without a vault, and the
  vault is inspectable without FRIDAY.

**Negative**

- **`private` content becomes plaintext on disk.** The single real cost. An encrypted database and a
  Keychain key protect the fact in `friday.db`; nothing protects the same sentence in `wiki/`.
- **The same fact exists twice**, and the copy can be stale. Every "why does the vault say something
  different" question is caused by this decision, and there will be some.
- **Editing the vault feels like it should do something, and does not.** This will be counter-
  intuitive exactly when the owner is most engaged — reading his own knowledge and wanting to correct
  it. §5 mitigates it with a path, not with immediacy.
- **A projector is code that must be maintained** against a memory system that does not exist yet, and
  its output is judged aesthetically — which is a category of change request with no natural end.

**Neutral**

- The vault is not a backup and does not affect [Chapter 34](../01-bible/34-disaster-recovery.md).
- Obsidian itself is never a dependency. The output is Markdown; Obsidian is one reader of it.

---

## Reversibility

- **Cost to reverse:** low.
- **How:** stop running the projector and delete the vault. Nothing authoritative lived there, which
  is the whole decision.
- **Point of no return:** if §5 is ever weakened to read the vault back automatically, the vault
  starts holding state that exists nowhere else, and the reversal cost becomes whatever that state is
  worth. That is the line to watch.

---

## Review triggers

- **Any proposal to read the vault as truth**, however narrow. That is a change to this decision, not
  an optimization of it.
- **The owner edits the vault regularly** — the ingestion path in §5 is then needed sooner than
  planned, and the friction is real rather than theoretical.
- **The vault syncs off the machine** (iCloud, Obsidian Sync, a git remote). §4's default ceiling was
  chosen for a local vault and should be re-decided before that happens, not after.
- **Projection cost becomes noticeable** — fall back to Alternative D.
- **`packages/memory` is implemented** and its interface differs from what §1 assumes. This ADR was
  written first on purpose; it should be re-read when the thing it constrains is real.
- **A `secret` value is ever found in the vault.** Not a review trigger so much as an incident.

---

## Notes

**Written before the code, and before the memory system.** That is unusual for this repository, where
most ADRs since 0016 were taken when implementation met the design. The justification is that the
boundary is the decision — once a projector exists and the owner has edited a file that FRIDAY then
acted on, the argument is much harder to have.

**Uncertainty**, ranked by how likely I am to be wrong:

1. **The `private` default in §4.** I have defaulted to projecting it because a vault without the
   owner's actual life in it is not worth building, and this is a single-user Mac. It is also the
   decision that turns an encrypted store into a plaintext folder, and I would not defend it on a
   machine with sync turned on.
2. **That §5's friction is tolerable.** An owner who edits a wiki page, sees nothing happen, and is
   told to phrase it as a request instead may reasonably find that worse than the problem it prevents.
   Alternative B is not foolish; it is just unbounded.
3. **That continuous projection is the right default over Alternative D.** I have less evidence for
   this than for anything else here, and it is the cheapest to change.

**What this ADR does not settle:** what a `wiki/` page looks like, how subjects are chosen, how
wikilinks are generated, and how much of the event log reaches `raw/`. Those are rendering questions,
they belong with the implementation, and none of them can violate this decision.
