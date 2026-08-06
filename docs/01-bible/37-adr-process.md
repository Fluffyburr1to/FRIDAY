# 37 — Architecture Decision Records

> **Governing provisions:** Manifesto Principle 6 (Architecture Is Sacred — "if architecture must
> change, it should be deliberate, documented, and understood"), Principle 2 (Transparency); Core
> Value 9 (Document Everything).

---

## In plain language

An Architecture Decision Record — an ADR — is a short document that captures one significant
decision: what was decided, why, what else was considered, and what it costs.

The reason ADRs matter for FRIDAY more than for most projects comes down to a specific problem.

Eighteen months from now, you or an AI assistant will look at some part of FRIDAY and think: *this
is strange, why is it done this way, let me simplify it.* Without a record, one of two things
happens. Either the strange thing gets "simplified" and something breaks in a way nobody predicted —
because the strangeness was load-bearing and the reason was forgotten. Or nobody dares touch it,
and it calcifies into permanent complexity nobody understands.

An ADR prevents both. It says: *we knew this looked strange, here is the reason, and here is what
would have to be true for it to stop being necessary.*

The Manifesto is explicit about this: architectural change must be "deliberate, documented, and
understood." ADRs are the documentation half, and they are what makes the "understood" half possible
years later.

**The critical property: ADRs are immutable.** You never edit a past decision to reflect what you
now believe. When a decision changes, you write a new ADR that supersedes the old one, and both
remain. The record shows what was true at the time and why it changed — which is far more useful
than a document that has been quietly kept current and now claims you always thought this.

---

## When an ADR is required

| Requires an ADR | Does not |
|---|---|
| Adding, removing, or replacing a technology | Using an already-chosen technology |
| Changing a public interface between packages | Internal refactoring |
| Changing the data model in a non-additive way | Adding a column |
| Changing security, privacy, or approval behavior | Fixing a bug in existing behavior |
| Changing an architectural boundary rule | Ordinary feature work |
| Anything contradicting a Bible chapter | Anything the Bible already specifies |
| Deferring a known problem deliberately | — |
| Adding a dependency with a large surface | Adding a small utility library |

**The test:** *would a competent person joining in two years be confused about why this is the way
it is?* If yes, write one.

**When in doubt, write one.** They are short. A ten-minute ADR that saves an hour of archaeology in
2028 has paid for itself many times over. The failure mode is not writing too many — it is writing
too few.

---

## The template

Copied from `docs/adr/0000-template.md`. **MADR-derived**, adapted for FRIDAY's constitutional
requirements.

```markdown
# ADR-NNNN — <Short, decisive title>

- **Status:** proposed | accepted | rejected | superseded by ADR-NNNN | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <who>
- **Supersedes:** <ADR-NNNN, or none>
- **Related:** <Bible chapter, RFC, issue>

## Context

What is the situation? What forces are at play? What constraints apply?

Write this so someone with no memory of the discussion understands the problem before
seeing the answer. State what you did NOT know at the time — that is often the most
valuable line in the document.

## Decision

We will <do this>.

One or two sentences. Decisive. Not "we might" or "we should consider."

## Constitutional review

Which founding provisions does this touch, and how is each honored?

- **Article __:** <how this decision honors it, or why it does not apply>
- **Principle __:** <same>

The five questions:
- [ ] **Can the user see it?**
- [ ] **Can the user stop it?**
- [ ] **Can we replace it?**
- [ ] **Can we explain it?**
- [ ] **Will this still be right in five years?**

If any answer is uncomfortable, say so here rather than omitting it.

## Alternatives considered

### <Alternative A>
**What it is.**
**Advantages.** — argued fairly, as its advocate would
**Why rejected.**

### <Alternative B>
...

An ADR with no alternatives is a decision that was not made — it was defaulted into.
If there genuinely was only one option, say why.

## Consequences

**Positive:** what gets better.

**Negative:** what gets worse. ★ Every decision has these. An ADR without negative
consequences has not been thought about honestly.

**Neutral:** what changes without being better or worse.

## Reversibility

- **Cost to reverse:** low | medium | high
- **How:** <the actual procedure>
- **Point of no return:** <when this stops being reversible, if ever>

## Review triggers

What would make us revisit this? Be specific and measurable where possible.

- <condition>
- <condition>

## Notes

Anything else. Links. Benchmarks. What we were uncertain about.
```

### Why these sections

Most templates have context, decision, and consequences. Three sections here are additions specific
to FRIDAY and they are the ones that earn their place:

**Constitutional review** exists because FRIDAY's founding documents are binding, and a decision
that quietly violates one is a defect that will be extremely expensive to discover later. Forcing
the question at decision time — while the reasoning is fresh — is far cheaper than an audit.

**Reversibility** exists because it changes how much deliberation a decision deserves. A choice that
takes an afternoon to undo should be made quickly; a choice that becomes permanent after data
accumulates deserves careful thought. Making this explicit stops both over-deliberating cheap
decisions and under-deliberating expensive ones. It also tells a future reader whether they are
allowed to change their mind.

**Review triggers** exist because architectural decisions are correct *for a context*, and contexts
change. An ADR that says "revisit if the event log exceeds 5 GB" turns a decision into something
that can be monitored rather than something that silently becomes wrong.

---

## The process

```
1  RECOGNIZE   Something requires a decision → open a draft as `proposed`
2  RESEARCH    Investigate alternatives honestly. Spike if needed
               (spike/* branches, never merged — Chapter 32)
3  WRITE       The template. Argue alternatives as their advocates would.
4  DECIDE      You decide. Status → accepted or rejected.
               ★ REJECTED ADRs ARE KEPT. See below.
5  IMPLEMENT   Reference the ADR in commits and the PR
6  MONITOR     Review triggers become diagnostics checks where measurable
7  REVISIT     Trigger fires → new ADR, old one → superseded. Never edited.
```

**Rejected ADRs are kept and numbered, permanently.** This is the practice most often skipped and it
is one of the most valuable. Without it, the same rejected idea gets re-proposed every eighteen
months by someone (or some AI assistant) who does not know it was already considered. "We evaluated
LangChain in ADR-0007 and rejected it for these reasons" ends a discussion in thirty seconds that
would otherwise consume an afternoon.

**ADRs are numbered sequentially and never renumbered.** `docs/adr/0014-choose-tauri.md` is a
permanent address that other documents link to.

---

## Seed ADRs

The decisions in this Bible are recorded as ADRs at Milestone 0, so the reasoning is addressable at
the granularity of individual decisions rather than only as chapters.

| ADR | Decision | Chapter |
|---|---|---|
| 0001 | TypeScript everywhere | 02 |
| 0002 | Monorepo with pnpm and Turborepo | 04 |
| 0003 | SQLite as primary datastore | 09 |
| 0004 | Event-sourced core with SQLite-backed bus | 10 |
| 0005 | The Guardian as sole authorization point | 17, 19 |
| 0006 | Capability-based authorization, not RBAC | 17 |
| 0007 | No agent framework — build the runtime | 11 |
| 0008 | Model Router abstraction; no vendor in core | 02, 11 |
| 0009 | Tauri for desktop and mobile shells | 07, 08 |
| 0010 | Departments communicate only via events | 13 |
| 0011 | Plan engine as a durable state machine, not a loop | 12 |
| 0012 | Standing grants must expire | 19 |
| 0013 | Local-only speech processing | 25 |
| 0014 | Human approval on every merge | 27, 31 |
| 0015 | Local-only observability | 29 |

---

## Relationship to RFCs

| Document | Purpose | Lifecycle |
|---|---|---|
| **RFC** | *Should we do this?* Exploratory, discussion, may go nowhere | Temporary — becomes an ADR or is closed |
| **ADR** | *We decided this.* A record | **Permanent, immutable** |

RFCs live in `docs/rfc/` and are for problems where the shape of the solution is not yet clear.
Most decisions skip the RFC stage and go straight to an ADR.

---

## Alternatives considered

### No ADRs; document decisions in the Bible only

**Advantages:** one place to look; less overhead.

**Rejected** because the Bible describes the *current state* and is edited over time. A future reader
cannot see what was considered and rejected, or when and why something changed. The Bible answers
"what is the architecture"; ADRs answer "why, and what else did we think about" — and the second
question is the one that comes up when someone wants to change something.

### Decisions in commit messages and PR descriptions

**Advantages:** zero extra process; already required.

**Rejected** — not discoverable. Nobody searches git history for architectural reasoning, and PR
descriptions are not addressable as documents. Commits *reference* ADRs; they do not replace them.

### Y-Statements (a one-line format)

*"In the context of X, facing Y, we decided Z, to achieve W, accepting V."*

**Advantages:** extremely lightweight; higher compliance.

**Rejected as the primary format** — too compressed for decisions with genuine trade-offs, and it
provides no room for the constitutional review or the alternatives. **Useful as the summary line**
at the top of a longer ADR.

### Full RFC process for every decision

**Rejected** as far too heavy for one person. RFCs exist for genuinely open questions only.

### Editing ADRs when decisions change

**Rejected firmly** — it destroys the historical record, which is the entire value. Superseding
preserves both the old reasoning and the reason it changed. Editing produces a document that
implies you always thought this, which is a small dishonesty that compounds.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Writing an ADR takes 20–60 minutes.** | Accepted — trivial against the archaeology it prevents. |
| **Immutable ADRs mean stale documents accumulate**, and a reader must follow supersession chains. | Accepted — mitigated by a required status header and an index. History is worth the friction. |
| **The template is longer than most.** | Accepted — the added sections are the ones specific to FRIDAY's requirements. |
| **Judgment is required** about when one is needed. | Accepted — "when in doubt, write one," and the failure mode is too few. |
| **Keeping rejected ADRs** means numbers with no implementation. | Accepted — preventing re-litigation is worth more than a tidy sequence. |

---

## Review triggers

- ADRs are not being written for decisions that clearly needed them → the process is too heavy or
  the trigger is unclear
- The same question is re-litigated despite an existing ADR → discoverability problem; improve the
  index
- ADRs are being edited rather than superseded → **correct immediately**; the record's value depends
  on immutability
- A second contributor joins → revisit who decides and how disagreements resolve

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
