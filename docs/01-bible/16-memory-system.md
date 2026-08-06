# 16 — Memory System

> **Governing provisions:** Constitution Article I (data belongs to the user), Article II
> (Transparency), Article IV (Privacy), Article VIII (Learning); Manifesto Principle 3 (Trust Is
> Earned — "admitting uncertainty"), Principle 4 (Privacy), Principle 7 (Explainability).

---

## In plain language

Memory is what makes FRIDAY feel like a partner rather than a search box. Without it, every
conversation starts from nothing and she is a very expensive way to ask questions.

Memory is also where the most dangerous failure in this entire system lives, and it is worth naming
plainly:

> **A confidently wrong memory is worse than no memory at all.**

If FRIDAY forgets your dentist's name, you tell her again. If she *believes* your dentist is
someone else — and acts on it, and explains her reasoning fluently — you have a system that
undermines your judgment while sounding authoritative. That is the precise opposite of "amplify
human judgment."

So the memory system is built around one non-negotiable rule:

> **Every memory points back to the specific event where FRIDAY learned it.**

No provenance, no storage. When FRIDAY says "your meeting with Sarah is at three," she can show you
that this came from a calendar sync at 9:14 this morning — not from a language model producing a
plausible-sounding sentence. Principle 3 says trust is earned through honesty and admitting
uncertainty. A memory system without provenance cannot be honest, because it cannot tell the
difference between what it knows and what it inferred.

The second rule follows from the first: **memory is inspectable and editable by you.** You can
browse everything FRIDAY believes about any subject, see where each belief came from, correct it,
or delete it. Article I says your data belongs to you; that has to include the conclusions drawn
from it.

---

## Recommendation

Four layers, one storage mechanism, provenance mandatory on every entry.

```
┌──────────────────────────────────────────────────────────────┐
│  L0  WORKING          the current plan's context             │
│      lifetime: the plan          "we are drafting an email"  │
│      storage: plan record        "the user said 'make it     │
│      never persisted             warmer'"                     │
├──────────────────────────────────────────────────────────────┤
│  L1  EPISODIC         what happened, and when                │
│      lifetime: forever           "you met Sarah on Oct 3"    │
│      storage: the event log      "FRIDAY sent that email     │
│      already exists — free        at 14:41"                  │
├──────────────────────────────────────────────────────────────┤
│  L2  SEMANTIC         facts believed to be true now          │
│      lifetime: until superseded  "Sarah Chen is your CFO"    │
│      storage: memories table     "you prefer morning         │
│      confidence + provenance      meetings"                  │
├──────────────────────────────────────────────────────────────┤
│  L3  PROCEDURAL       how to do things here                  │
│      lifetime: until revised     "expense reports go to      │
│      storage: memories table      Dana, as a PDF, by the     │
│      versioned, user-approved     5th"                       │
└──────────────────────────────────────────────────────────────┘
```

### Why these four and not some other decomposition

Each layer has a genuinely different lifetime, a different truth condition, and a different failure
mode. Collapsing any two of them produces a specific, predictable problem:

- **Episodic must never be edited.** It is history. "You met Sarah on October 3" does not stop being
  true when circumstances change. It lives in the event log because the event log is already
  immutable and already exists — this layer costs us nothing.
- **Semantic must be editable.** It is belief about the present. "Sarah is your CFO" becomes false
  when she changes jobs. Storing it in the immutable log would mean FRIDAY could never update her
  understanding; storing history in the mutable layer would mean she could rewrite the past.
- **Procedural must be versioned and approved.** It is learned behavior — how *you* do things. This
  is the layer where Article VIII bites hardest: FRIDAY noticing a pattern and adopting it as a rule
  is exactly the "silent improvement" the Manifesto forbids. Procedural memories require your
  confirmation before they influence behavior.
- **Working must be discarded.** Context from the current task should not silently become a
  permanent belief. Most systems blur this line, and the result is FRIDAY "remembering" something
  you said hypothetically three weeks ago as though it were a standing fact.

---

## What gets remembered, and how

**Nothing is remembered automatically.** Memory formation is an explicit, audited step.

```
An event occurs (email read, meeting attended, you state a preference)
        │
        ▼
EXTRACTION — a bounded agent proposes candidate facts,
             each with: content, confidence, source_event_id,
             sensitivity, proposed layer
        │
        ▼
FILTERING — reject if:
             · confidence below threshold
             · no source event   ★ hard rule, no exceptions
             · duplicate of an existing memory
             · sensitivity exceeds what this source may produce
        │
        ▼
CONFLICT CHECK — does this contradict something already believed?
             │
             ├── no  → store
             └── yes → RESOLUTION (below)
        │
        ▼
STORED with provenance, confidence, sensitivity, timestamps
        │
        └── memory.stored published — visible in the dashboard
```

### Conflict resolution

When new information contradicts an existing belief, FRIDAY does not simply overwrite. Overwriting
silently is how a system's understanding drifts without anyone noticing.

| Situation | Behavior |
|---|---|
| New info is from a more authoritative source (you said it directly) | Supersede; old memory retained, marked `superseded_by` |
| New info is recent and the old is stale | Supersede, with reduced confidence |
| Sources are equally authoritative and genuinely conflict | **Store both, flag the conflict, ask you** |
| Contradicts something you explicitly confirmed | **Never auto-supersede. Always ask.** |

The last two rows are the important ones. Principle 3 says FRIDAY earns trust by "admitting
uncertainty." A system that resolves every conflict silently is claiming certainty it does not
have. Presenting a genuine contradiction and asking is the honest behavior, and it is rare enough
not to be annoying.

**Superseded memories are retained, never deleted.** This is what allows FRIDAY to explain a past
decision that was made on information since revised — which is precisely the moment you most want an
explanation.

---

## Recall

Retrieval combines three signals rather than relying on semantic similarity alone:

| Signal | Mechanism | Weight |
|---|---|---|
| **Semantic** | Vector similarity via sqlite-vec | ~50% |
| **Lexical** | SQLite FTS5 full-text search | ~25% |
| **Recency + frequency** | Time decay × access count | ~25% |

Pure vector search is the common approach and it fails in a specific, frustrating way: exact terms
(a name, an account number, a project codename) are often *not* semantically distinctive, so
searching for "Project Halyard" returns everything about projects and nothing about Halyard.
Combining with lexical search fixes it. Combining with recency makes recent context win ties, which
is almost always what you want.

**Every recall is filtered by permission before ranking.** An agent with
`memory.read:communications` searches only that namespace. Sensitivity filtering happens at the
query level, not after — so an agent cannot infer the existence of memories it may not read from a
result count.

**Recall is recorded.** `memory.recalled` events mean the dashboard can show you exactly what FRIDAY
consulted before making any decision. When you ask "why did you think that?", the recalled memories
are part of the answer.

---

## Forgetting

A memory system that only accumulates becomes worse over time — noisier, slower, and more likely to
surface something stale.

| Mechanism | Behavior |
|---|---|
| **Expiry** | Working memory expires with its plan. Some semantic memories carry a TTL. |
| **Decay** | Confidence decreases over time for memories that are never reconfirmed. A belief unexamined for two years is presented with visible uncertainty. |
| **Supersession** | Replaced, not deleted. |
| **Consolidation** | Many similar episodic memories collapse into one semantic fact, with all sources retained. |
| **User deletion** | `friday forget <subject>` — genuine removal. |

**User deletion is genuine, and it cascades.** Deleting a memory removes it, removes derived
memories that depended on it, and redacts the payload of the source events — replacing content with
a tombstone that preserves the integrity chain (see [Chapter 09](09-database-design.md)). The fact
that a deletion occurred remains auditable; the content does not.

This is the only design that satisfies Article IV (you can delete your data) and Article II (the
audit trail is complete and verifiable) at the same time. Deleting the event rows outright would
break the hash chain and make the entire audit trail unverifiable — a much larger loss than the
deletion was worth.

---

## Privacy in memory

Memory is the most sensitive data FRIDAY holds. It is not just your calendar — it is FRIDAY's
*conclusions* about your life.

| Control | Implementation |
|---|---|
| Sensitivity on every memory | `public` / `internal` / `private` / `secret` — required field |
| Encryption | `private` and above encrypted at rest, keys in the macOS Keychain |
| **No cloud embedding for sensitive content** | `private`+ memories are embedded by a **local** model. Their text never leaves your Mac, even to generate a vector. |
| Namespace isolation | Departments read only their granted namespaces |
| `principal_id` on every row | Multi-user isolation from day one |
| Full visibility | The memory browser shows everything, with provenance, filterable by subject |

The local-embedding rule is worth highlighting because it is the kind of thing that gets missed.
Generating an embedding requires sending the text to a model. If that model is in the cloud, then
"we never send your private notes to the cloud" is false — the notes went out to be vectorized.
FRIDAY runs a local embedding model (via Ollama) for anything above `internal`, accepting somewhat
lower quality in exchange for the guarantee actually being true. Article IV.

---

## The Article VIII problem

Article VIII: *"FRIDAY should continuously identify opportunities for improvement, but
recommendations should always be presented to the user before significant changes are made."*

Memory is where this is hardest, because learning *is* memory formation. If FRIDAY notices you
always decline meetings before 9am and starts declining them, she has changed her behavior without
asking. The line between "remembering a preference" and "silently implementing a policy" is thin
and it matters.

The resolution:

| Kind of learning | Requires approval? |
|---|---|
| Recording a fact (`Sarah is the CFO`) | No — it is an observation |
| Recording an observed pattern (`you usually decline early meetings`) | No — it is still an observation |
| **Acting on a pattern** (auto-declining early meetings) | **Yes — always** |
| Storing a procedure (`expense reports go to Dana by the 5th`) | **Yes** — procedures shape behavior |
| Adjusting confidence in an existing memory | No |

**The rule: observing is free; acting is not.** FRIDAY may notice anything and remember anything.
The moment a memory would change what she *does* without you asking, it becomes a proposal that
waits for you.

Concretely, FRIDAY says: *"I've noticed you've declined seven meetings before 9am in the last two
months. Would you like me to flag those automatically?"* — and she waits. She does not begin doing
it and mention it later.

---

## Alternatives considered

### A single flat memory store with no layers

**Advantages:** much simpler; one table, one retrieval path.

**Rejected** because the four layers have genuinely different lifetimes and truth conditions
(explained above). A flat store forces one policy on all of them, which means either history
becomes editable or beliefs become frozen. Both are worse than the complexity of four layers.

### Full RAG over raw documents, with no extracted facts

Store everything verbatim; retrieve chunks; let the model interpret at query time.

**Advantages:** no extraction step to get wrong; nothing lost in summarization; simpler pipeline.

**Rejected as the primary model** because it cannot represent belief, confidence, supersession, or
contradiction. "Sarah is the CFO" and "Sarah left the company" would both be retrieved as
equally-valid chunks, and the model would resolve the conflict differently each time. FRIDAY needs
to *hold beliefs*, not just retrieve text.

**Adopted for the document layer**: raw documents are chunked and indexed for retrieval *alongside*
extracted semantic facts. Documents provide detail; semantic memory provides belief.

### A knowledge graph (entities and typed relationships)

**Advantages:** genuinely the right long-term model for "who knows whom, who works where, what
relates to what." Multi-hop queries become natural.

**Rejected for now** as premature — it requires an entity resolution system (deciding that "Sarah,"
"Sarah Chen," and "s.chen@..." are one person), which is a substantial project of its own with its
own failure modes.

**This is the most likely evolution of this chapter.** Relationships are currently a join table,
which handles the queries we can name. If memory queries become genuinely relational, KùzuDB is
embeddable and would sit beside SQLite without adding a server. Flagged for M8.

### A hosted memory service (Mem0, Zep, Letta)

**Advantages:** substantial machinery for free, actively developed, solves problems we will
otherwise solve ourselves.

**Rejected** because it means your entire memory — FRIDAY's model of your life — lives on someone
else's servers. This is the most direct conflict with Article IV in the whole Bible. Self-hosting
some of these is possible and would remove that objection, but they impose their own memory model,
and *this* memory model is where the provenance and approval guarantees live.

### Letting the model manage its own memory (long context, no retrieval)

Put everything in the context window; let the model sort it out.

**Rejected** on cost (enormous, every request), on privacy (everything sent to the cloud on every
call), on determinism (the model decides what matters, differently each time), and decisively on
provenance — there is no way to show where a belief came from.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Extraction costs a model call per meaningful event.** | Accepted — batched, uses a cheap model, and skipped entirely for low-value events. |
| **Local embeddings are lower quality than cloud embeddings.** | Accepted for sensitive content. The guarantee is worth the recall quality. |
| **Four layers are more complex than one.** | Accepted — the complexity is in the storage layer; departments see one `recall()` call. |
| **Provenance requires a source event for everything**, which occasionally blocks a legitimate memory. | Accepted without exception. A memory without provenance is a belief FRIDAY cannot justify, and storing it would undermine every explanation she gives. |
| **Conflict resolution sometimes asks you** about things you do not care about. | Accepted — tuned by confidence thresholds. Erring toward asking is the right direction. |
| **Deletion cascade is complex** and could over-delete derived memories. | Accepted — over-deleting is much safer than under-deleting when the user has asked to forget something. |
| **No knowledge graph means some queries are hard.** | Accepted for now, with a documented path. |

---

## Review triggers

- Memory queries become deeply relational → evaluate KùzuDB
- Vector count exceeds ~1M or recall latency exceeds the Chapter 35 budget
- Extraction cost exceeds 20% of monthly AI spend
- Users report FRIDAY "remembering wrong" more than rarely → the extraction or conflict model needs
  work
- Local embedding quality proves inadequate for useful recall on private content

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
