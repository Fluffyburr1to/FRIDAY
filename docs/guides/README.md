# Guides

Task-oriented documentation, organized by what the reader is trying to do
(**Diátaxis**).

| Folder | Reader | Answers |
|---|---|---|
| **tutorials/** | Learning, new to this | "Take me through it step by step" |
| **how-to/** | Working, has a goal | "How do I accomplish X?" |
| **reference/** | Working, needs a fact | "What are the parameters?" |

**Explanation — "why is it like this?" — does not live here.** It lives in the
[Project Bible](../01-bible/) and in [ADRs](../adr/).

Keeping these separate matters. A document that tries to be all four overwhelms the learner, buries
the fact, and hides the reasoning.

## Rules

1. **Reference documentation is generated from code**, never hand-written. Hand-written signatures
   go stale silently.
2. **Tutorials are tested.** A tutorial with a broken step is worse than none — it teaches that the
   documentation cannot be trusted.
3. **How-tos assume competence**; tutorials assume nothing.
4. **Plain language throughout.** The owner does not program.

Reference: [Chapter 38](../01-bible/38-documentation-standards.md)
