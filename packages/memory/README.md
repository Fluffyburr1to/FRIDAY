# @friday/memory

**What FRIDAY knows, and where every piece of it came from.**

Milestone: **M5**

## Charter

Four layers — working, episodic, semantic, procedural — with one absolute rule:

> **Every memory points back to the specific event where FRIDAY learned it. No provenance, no
> storage.**

A confidently wrong memory is worse than no memory. Provenance is what lets FRIDAY distinguish what
she *knows* from what she *inferred*, and it is what makes "why did you think that?" answerable.

## What lives here

- The four layers, with a common storage shape
- Extraction (a bounded agent proposing candidate facts)
- Conflict detection and resolution — **genuine conflicts are presented, not silently overwritten**
- Hybrid recall: semantic (sqlite-vec) + lexical (FTS5) + recency, permission-filtered
- Supersession, decay, consolidation, and cascading user deletion
- Local embedding for anything classified `private` or above

## What does NOT

- Credentials, or anything classified `secret`
- Any decision to *act* on a remembered pattern — see below

## The Article VIII line

| Learning | Requires approval? |
|---|---|
| Recording a fact | No |
| Recording an observed pattern | No |
| **Acting on a pattern** | **Yes, always** |
| Storing a procedure | **Yes** |

**Observing is free; acting is not.** FRIDAY may notice anything. The moment a memory would change
what she *does* without you asking, it becomes a proposal that waits.

Reference: [Chapter 16](../../docs/01-bible/16-memory-system.md)
