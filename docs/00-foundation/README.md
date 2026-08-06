# Foundation — Immutable Documents

The four documents in this folder are the **founding documents** of Project FRIDAY.
They were authored by the project owner and define FRIDAY's purpose, values, governance,
and long-term destination.

## Rules governing this folder

1. **These documents are not modified by engineering.**
   Not by a contributor, not by an AI assistant, not by the Chief of Staff, not by FRIDAY herself.
   Only the project owner may change them, deliberately, as a versioned amendment.

2. **They outrank every other document in this repository.**
   If the Project Bible, an ADR, a runbook, a code comment, or any piece of code conflicts with
   a founding document, the founding document wins and the other artifact is a defect to be fixed.

3. **Proposed improvements go somewhere else.**
   Observations, gaps, and suggested amendments are recorded in
   [`docs/01-bible/40-founding-document-observations.md`](../01-bible/40-founding-document-observations.md).
   That file may propose. It may never amend.

4. **Amendments are versioned.**
   When the owner does amend a founding document, the change is made as a normal pull request
   titled `amend: <document> — <summary>`, with the reasoning in the PR body. The git history
   of this folder is the constitutional record.

## The documents

| File | Role |
|---|---|
| [`manifesto.md`](manifesto.md) | Why FRIDAY exists, who she is, and the ten Core Principles. The philosophical charter. |
| [`constitution.md`](constitution.md) | Ten Articles of binding law. The enforceable rules. |
| [`core-values.md`](core-values.md) | Twelve values applied to engineering decisions day to day. |
| [`long-term-vision.md`](long-term-vision.md) | The multi-decade destination and the domains FRIDAY should eventually serve. |

## How these are used in practice

Every chapter of the Project Bible cites the specific Article, Principle, or Value it implements.
Every Architecture Decision Record contains a **Constitutional Review** section that names which
founding provisions the decision touches and how it honors them.

This is deliberate. It is how a system stays true to its intent across years of change, many
contributors, and long gaps between sessions. Architecture drifts when nobody remembers why.

## Provenance

Converted verbatim from the owner's original `.docx` files on 2026-08-06:

- `FRIDAY Manifesto.docx` → `manifesto.md`
- `Constituion.docx` → `constitution.md`
- `CORE VALUES.docx` → `core-values.md`
- `LONG-TERM VISION.docx` → `long-term-vision.md`

Text content is unaltered. Only markdown formatting (headings, lists, emphasis) was applied so the
documents render cleanly on GitHub and can be linked to by section.
