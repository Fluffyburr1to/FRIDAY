# 38 — Documentation Standards

> **Governing provisions:** **Core Value 9 (Document Everything — "knowledge should never exist only
> in someone's memory")**; Manifesto Engineering Culture ("documentation over assumptions"),
> Principle 2 (Transparency), Principle 10 (Simplicity Wins).

---

## In plain language

For most software projects, documentation is a supporting artifact — nice to have, usually stale,
written after the fact.

For FRIDAY it is the **primary artifact**, and the reason is structural rather than aspirational:

- **You do not read code.** Documentation is your only interface to the architecture. If it is
  wrong, you are governing a system you cannot see.
- **AI assistants start every session with no memory.** Documentation is the only continuity between
  sessions. An assistant's first act is to read; what it reads determines what it writes.
- **You will be away for weeks at a time.** Documentation is how you return without re-deriving
  everything.

That produces a rule that would be excessive on a normal project and is correct here:

> **If it is not written down, it does not exist.**

A decision made in your head is not a decision the project has. A convention followed by one AI
session and not recorded is not a convention. The Core Value is explicit: *"Knowledge should never
exist only in someone's memory"* — and in this project, "someone's memory" is often a context window
that will be discarded in an hour.

---

## The four kinds of documentation

FRIDAY uses the **Diátaxis** framework, which distinguishes documentation by what the reader is
trying to do. The distinction matters because mixing them produces documents that serve nobody.

| Kind | Reader's situation | Answers | Lives in |
|---|---|---|---|
| **Tutorial** | Learning, new | "Take me through this step by step" | `docs/guides/tutorials/` |
| **How-to** | Working, has a goal | "How do I accomplish X?" | `docs/guides/how-to/` |
| **Reference** | Working, needs a fact | "What are the parameters?" | Generated from code + `docs/guides/reference/` |
| **Explanation** | Understanding | "Why is it like this?" | **This Bible**, and `docs/adr/` |

The common failure is a document that tries to be all four: it starts as a tutorial, drifts into
reference detail, and buries the reasoning in the middle. The reader learning is overwhelmed; the
reader looking up a parameter cannot find it; the reader wanting to understand gets procedure
instead of reasoning.

**Keep them separate. Link between them.**

---

## The documentation map

| Location | Contains | Audience | Changes |
|---|---|---|---|
| `docs/00-foundation/` | The founding documents | Everyone, first | **Owner only, by amendment** |
| `docs/01-bible/` | Architecture, decisions, reasoning | You, contributors, AI | By PR, with ADRs for material change |
| `docs/adr/` | Individual decision records | Anyone asking "why" | **Append-only, immutable** |
| `docs/rfc/` | Proposals under discussion | Discussion | Freely, until resolved |
| `docs/runbooks/` | "It is broken, what do I do" | You, at 2am | After every incident |
| `docs/guides/` | Tutorials, how-tos, reference | You, contributors | With features |
| `docs/diagrams/` | Diagram sources (Mermaid) | Everyone | With architecture |
| `README.md` (every folder) | Charter, boundaries, what does *not* belong | Whoever opens the folder | With the folder |
| `CLAUDE.md` | Standing instructions for AI contributors | AI assistants, every session | As standards evolve |
| Code comments | Why, never what | Whoever reads the code | With the code |

### Every folder has a README — the highest-return rule

Enforced in CI: a directory without a `README.md` fails the build.

This is the rule that most directly serves how FRIDAY is built. When an AI assistant is asked to add
a capability, its first question is *where does this file go?* If every folder states its charter and
its boundaries, the answer is discoverable. If not, the assistant guesses — plausibly, differently
each time — and after twenty guesses the structure is incoherent (R2 in the risk register).

A folder README states three things:
1. **What lives here** — the charter
2. **What does not** — the boundary, with a pointer to where it goes instead
3. **The rules** — any constraints specific to this folder

That third item is why `connectors/README.md` says "connectors may not import anything except the
SDK and contracts" — so the rule is discovered by anyone who opens the folder, not only by whoever
reads Chapter 03.

---

## Writing standards

### Plain language

FRIDAY's owner does not write code. Every document that governs the project must be readable by
someone who does not.

| Rule | Example |
|---|---|
| **Lead with the plain-language explanation.** Every Bible chapter opens with one. | See any chapter above |
| **Define a term the first time it appears** in a document, or link to the glossary | "capability token (a short-lived permission for one action)" |
| **Prefer the concrete** | "waits up to 30 seconds" over "employs a bounded timeout strategy" |
| **Short sentences.** One idea each. | — |
| **Active voice, present tense** | "The Guardian evaluates" not "evaluation is performed by" |
| **Say what it costs**, not only what it does | Every chapter has a trade-offs section |
| **Never write "obviously," "simply," or "just."** If it were obvious it would not need writing. | — |

### The trade-offs requirement

**Every architectural document states what its choice costs.** Not as a formality — the negative
consequences section is often the most valuable part of a document, and a document without one has
not been thought about honestly.

The reason is practical: when someone proposes changing a decision two years from now, the first
question is "what were we trading away?" A document that only lists benefits cannot answer it, and
the change gets made without understanding what it undoes.

### Diagrams

Mermaid, in fenced code blocks. Source-controlled as text, so diagrams appear in diffs and cannot
drift silently from the prose around them.

**A diagram must be readable in plain text.** Rendered images that require a tool to open are
invisible to AI assistants and to anyone reading the raw file, which are two of the three audiences
for this documentation.

ASCII diagrams are used freely where they are clearer than Mermaid — they render everywhere,
including in a terminal.

---

## Keeping documentation true

Documentation drifts. This is the central problem, and the answer is a combination of automation
where possible and specific rules where not.

| Mechanism | What it catches |
|---|---|
| **Docs live with code**, in the same repository and the same PR | The main cause of drift — updating one and not the other |
| **PR template asks: "does this change documentation?"** | Omission at the moment of change |
| **Reference documentation is generated from code**, never hand-written | Signatures and parameters going stale |
| **CI fails on a missing folder README** | Structural gaps |
| **CI fails on broken internal links** | Renamed and deleted files |
| **Quarterly review of one Bible chapter** | Slow semantic drift that automation cannot see |
| **Runbooks updated within 48 hours of any incident** | Procedures that were wrong when needed |
| **The annual disaster drill exercises runbooks** ([Chapter 34](34-disaster-recovery.md)) | Procedures that look right but do not work |

**The quarterly chapter review** is the one that requires discipline. Automation cannot detect that
Chapter 12 describes a planning approach that changed subtly six months ago. Reviewing one chapter
per quarter, in rotation, covers the Bible roughly every ten years — which sounds inadequate until
you note that chapters are also reviewed whenever their review triggers fire, which is the primary
mechanism. The quarterly rotation is the backstop.

**When documentation and code disagree, that is a bug**, and it is filed as one. Which is wrong
depends on the case — sometimes the code drifted, sometimes the document was aspirational — but the
disagreement is never left standing.

---

## `CLAUDE.md`

A file at the repository root, read by AI assistants at the start of every session. It exists
because an assistant that has not been told the conventions will invent its own.

It contains: what FRIDAY is, the reading order for the founding documents, the standards from
[Chapter 30](30-coding-standards.md), the forbidden paths, the rule to match surrounding code, and
the instruction to write an ADR before making an architectural decision.

**It is kept short.** A 3,000-word instruction file is skimmed; a 500-word one is read. Detail lives
in the Bible, which the file links to.

---

## Alternatives considered

### A documentation site (Docusaurus, VitePress, MkDocs)

**Advantages:** better navigation, search, versioning, and a pleasant reading experience.

**Rejected for now** as another thing to build, deploy, and maintain. GitHub renders markdown well,
supports search, and — decisively — is where AI assistants read files directly without a build step.
**Worth revisiting at M8** if the documentation becomes hard to navigate, or if FRIDAY ever has users
beyond you.

### Documentation in a wiki or Notion

**Advantages:** easier editing, better organization tools, no PR overhead.

**Rejected** because documentation must live with the code, in the same commit, reviewed in the same
PR. Separating them guarantees drift — the code changes and the wiki does not, because updating it
is a separate act that is easy to skip. It also puts documentation outside what an AI assistant can
read.

### Literate programming (documentation and code in one file)

**Advantages:** they cannot drift; the reasoning sits with the implementation.

**Rejected** — poor tooling support in TypeScript, and it conflates reference documentation (which
belongs with code, and is generated) with explanation (which belongs in the Bible, and describes
things spanning many files).

### Auto-generated documentation only

**Advantages:** never stale; no manual effort.

**Rejected** — generation produces reference material, which is one of four kinds. It cannot produce
explanation, and explanation is what this project most needs. **Adopted for reference specifically.**

### Minimal documentation; rely on readable code

**Advantages:** less to maintain; common advice.

**Rejected** — it assumes readers who read code. FRIDAY's owner does not, and AI assistants read code
without the context that would make it self-explanatory. "The code is the documentation" fails both
primary audiences.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Documentation is real, ongoing work** and it competes with building. | Accepted — it is the primary artifact for this project's specific constraints, not overhead on top of the real work. |
| **A README per folder** is a maintenance obligation. | Accepted — the highest-return rule in the chapter for an AI-assisted codebase. |
| **Plain-language sections make chapters longer.** | Accepted — a document the owner cannot read does not govern anything. |
| **Markdown on GitHub is a worse reading experience** than a documentation site. | Accepted for now, with a revisit trigger. |
| **Quarterly review requires discipline** and will sometimes be skipped. | Accepted — review triggers are the primary mechanism; the rotation is a backstop. |
| **The trade-offs requirement makes documents longer** and occasionally uncomfortable to write. | Accepted — it is the section future readers need most. |

---

## Review triggers

- Documentation and code disagree more than occasionally → the mechanisms are failing
- AI assistants repeatedly make mistakes documentation should have prevented → `CLAUDE.md` or the
  folder READMEs are inadequate
- You cannot find something you know is written down → navigation problem; consider a docs site
- A runbook proves wrong during an incident → **stop-the-line**; fix within 48 hours
- Documentation exceeds what one person can review → consider generation or pruning

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
