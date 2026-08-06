# docs/ — The Most Important Folder in This Repository

That is not a figure of speech. For this project, documentation is the **primary artifact**, not a
supporting one:

- **The owner does not write code.** Documentation is the only interface to the architecture.
- **AI assistants start every session with no memory.** Documentation is the only continuity.
- **Work happens in bursts with gaps of weeks.** Documentation is how you return without
  re-deriving everything.

Which produces the governing rule:

> **If it is not written down, it does not exist.**

Core Value 9: *"Knowledge should never exist only in someone's memory."* In this project, "someone's
memory" is often a context window that will be discarded in an hour.

---

## The folders, in reading order

| Folder | Contains | Who changes it |
|---|---|---|
| **[00-foundation/](00-foundation/)** | The founding documents | **Owner only, by amendment** |
| **[01-bible/](01-bible/)** | 41 chapters of architecture and reasoning | By PR, ADR for material change |
| **[adr/](adr/)** | Individual decision records | **Append-only, immutable** |
| **rfc/** | Proposals under discussion | Freely, until resolved |
| **runbooks/** | "It is broken and I do not remember how this works" | After every incident |
| **guides/** | Tutorials, how-tos, reference | With features |
| **diagrams/** | Mermaid sources | With architecture |

The numeric prefixes force reading order in a plain directory listing. Someone landing here sees the
founding documents first and the Bible second, because that is the order in which they must be
understood.

---

## The hierarchy of authority

```
docs/00-foundation/     ← binding. Outranks everything below.
        ▲
docs/01-bible/          ← architecture. Subordinate to foundation.
        ▲
docs/adr/               ← individual decisions. Consistent with the Bible.
        ▲
code                    ← implements all of the above.
```

**If any artifact conflicts with a founding document, the founding document wins and the artifact is
a defect.** This applies to the Bible, to ADRs, to runbooks, and to code.

---

## The four kinds of documentation

FRIDAY uses **Diátaxis**, which separates documentation by what the reader is trying to do. Mixing
them produces documents that serve nobody — the learner is overwhelmed, the person looking up a
parameter cannot find it, and the person wanting to understand gets procedure instead of reasoning.

| Kind | Reader | Answers | Lives in |
|---|---|---|---|
| **Tutorial** | Learning | "Take me through this step by step" | `guides/tutorials/` |
| **How-to** | Has a goal | "How do I accomplish X?" | `guides/how-to/` |
| **Reference** | Needs a fact | "What are the parameters?" | Generated from code |
| **Explanation** | Understanding | "Why is it like this?" | **The Bible**, and `adr/` |

Keep them separate. Link between them.

---

## Standards

| Rule | Why |
|---|---|
| **Lead with plain language.** Every Bible chapter opens with an "In plain language" section. | The owner does not program. A document they cannot read governs nothing. |
| **State what it costs.** Every architectural document has a trade-offs section. | When someone proposes changing a decision in two years, the first question is what was traded away. |
| **Diagrams as text** (Mermaid or ASCII). | Rendered images are invisible to AI assistants and in raw file views — two of the three audiences. |
| **Never write "obviously," "simply," or "just."** | If it were obvious it would not need writing. |
| **Every folder has a README** — enforced in CI. | It is how the next contributor knows where a file goes. |
| **Docs change in the same PR as the code.** | Separating them guarantees drift. |

Reference: [Chapter 38](01-bible/38-documentation-standards.md).
