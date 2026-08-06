# 40 — Founding Document Observations

> **This document proposes. It never amends.**
>
> The founding documents in [`docs/00-foundation/`](../00-foundation/) are unmodified and will
> remain so. Everything below is an observation for the owner's consideration. Nothing here has
> been applied to any founding document, and nothing here may be.

---

## In plain language

You asked me to identify weaknesses or opportunities in the founding documents and list them
separately rather than changing them. This is that list.

First, an assessment, because it matters for reading the rest: **these are unusually good founding
documents.** They are specific where most such documents are vague, they take positions that cost
something, and they are internally coherent. The Manifesto's "she should never silently implement
them" and Article III's approval requirement are the kind of concrete commitments that actually
constrain engineering, which is the entire point of a founding document and something most of them
fail to do.

The observations below are not criticisms of what is there. They are almost entirely about **what is
absent** — questions that will arise during construction and that the documents do not currently
answer. When those questions arise, someone will answer them. Right now that someone is me, in this
Bible, making judgment calls that should probably be yours.

Each observation states: what is missing, why it will matter, what I did in the meantime, and what
an amendment might say.

They are ordered by how soon they will bite.

---

## Tier 1 — Will require a decision before Milestone 4

### O1 — "Materially affect" is undefined, and it is the operative term in Article III

**The gap.** Article III requires approval for actions that "could materially affect the user's data,
finances, security, software, or physical environment." *Materially* is doing all the work in that
sentence, and it is not defined anywhere.

Reading a calendar affects data. Caching a response affects data. Sending an email affects data
differently. Without a definition, the boundary between "auto-approve" and "ask" is decided by
whoever writes each risk classification — and over three years and dozens of capabilities, that will
drift.

**Why it matters.** This is the single most consequential undefined term in the founding documents.
Set the line too low and you get approval fatigue (risk R4), which hollows out Article III while
appearing to satisfy it. Set it too high and FRIDAY takes consequential actions you did not
authorize. Both failures are quiet.

**What I did.** [Chapter 19](19-approval-system.md) defines five risk classes with concrete criteria
— reversibility, whether data leaves the machine, and financial/safety consequence — and assigns
defaults. This is a reasonable reading, but it is **my** reading.

**Possible amendment.** An addition to Article III defining materiality by test rather than by
example:

> *An action materially affects the user when it is irreversible, transmits personal data beyond the
> user's own devices, alters the physical environment, has financial consequence, or changes
> FRIDAY's own behavior. Reversibility is judged by whether FRIDAY can restore the prior state
> without external cooperation.*

That last clause is the part I would most want your input on. "Reversible" is doing subtle work:
deleting a file FRIDAY can restore is different from deleting one only the recipient can restore.

---

### O2 — Nothing addresses the privacy of people who are not the user

**The gap.** Article IV protects "user privacy" thoroughly. But FRIDAY will constantly hold data
about **other people**: everyone who emails you, everyone in your calendar, everyone in your notes.
Their names, their schedules, their words, their inferred relationships.

The founding documents say nothing about them.

**Why it matters.** This is, in my judgment, the most significant genuine gap in the founding
documents, and it becomes concrete the moment the Communications department exists.

Concrete questions with no current answer: When FRIDAY builds a memory that says "Sarah is
frustrated with the vendor," whose data is that? May it be sent to a cloud model for summarization?
When Sarah emails you, has she consented to her words being processed by an AI, indexed, and
retained indefinitely? If Sarah asks you to delete what FRIDAY knows about her, what happens?

There are jurisdictions where some of these have legal answers. More importantly, they have ethical
answers, and a system whose founding document is about respect and service should not be silent on
the people it observes without their knowledge.

**What I did.** [Chapter 16](16-memory-system.md) applies the same sensitivity classification and
provenance to third-party data as to yours, and third-party content inherits the strictest
classification of its source. That is a reasonable default. It is not a principle, and it does not
answer the deletion question.

**Possible amendment.** A new Article:

> **Article XI — Others.** FRIDAY holds information about people who are not the user and who have
> not consented to her existence. She shall treat their information with the same care she gives the
> user's, collect no more of it than the user's own purposes require, never use it for purposes
> unrelated to serving the user, and honor a request from any identifiable person to be forgotten.

I want to flag that the last clause has real engineering consequences — it requires entity resolution
and a deletion path keyed on a person rather than on a record. It is achievable, and it is much
cheaper to design for now than to retrofit.

---

### O3 — There is no conflict-resolution rule between Articles

**The gap.** The Constitution states ten Articles as though they are independent. They are not, and
they will conflict.

Real conflicts that will occur:

| Conflict | Example |
|---|---|
| **II (Transparency) vs IV (Privacy)** | The audit trail records everything. Should it record the *content* of a private note, or only that one was accessed? Full transparency argues yes; privacy argues no. |
| **III (Approval) vs VII (Reliability)** | A plan needs approval; you are unreachable; a deadline passes. Does FRIDAY fail the task or act? |
| **IV (Privacy) vs the Vision's capability** | Cloud models are better. Local models are private. Every routing decision is this conflict in miniature. |
| **VIII (Learning) vs I (User authority)** | FRIDAY improving herself is FRIDAY changing what the user relies on. |
| **IX (Respect) vs II (Transparency)** | Telling you everything means interrupting you constantly. |

**Why it matters.** Without a precedence rule, each conflict is resolved ad hoc by whoever
encounters it. Over years, that produces an inconsistent system where the answer depends on which
component you are in.

**What I did.** I have applied an implicit hierarchy throughout this Bible:
**I > III > IV > V > II > VII > IX > VIII > VI > X.** The user's authority outranks everything;
approval outranks privacy (you can consent to disclosure); privacy outranks transparency (the audit
trail records *that* a private thing was accessed, not its content); and reliability never outranks
approval — **timeout means denied**, always.

This hierarchy is my construction. It is defensible and it is not yours.

**Possible amendment.** An Article XII establishing precedence, or a short preamble stating that
where Articles conflict, the user's explicit authority governs and, absent explicit direction,
FRIDAY chooses the more restrictive interpretation and reports the conflict.

That default — **when in doubt, do less and say so** — is what I have implemented, and I think it is
right regardless of the ordering you choose.

---

### O4 — "Significant changes" in Article VIII is undefined

**The gap.** Article VIII: recommendations "should always be presented to the user before significant
changes are made." Like *materially* in Article III, *significant* is undefined and load-bearing.

**Why it matters.** It becomes acute at Milestone 6. Is adjusting a retry timeout significant? A
prompt? A cache size? The line between "FRIDAY tuning herself" and "FRIDAY changing what you rely
on" needs to be drawn somewhere, and it is currently drawn nowhere.

**What I did.** [Chapter 23](23-diagnostics-system.md) draws it at **user-visible behavior change**:
FRIDAY may adjust internal caches, retry timing, and her own scheduling; anything that changes what
she does, how she decides, or what she remembers is a proposal. Guardian policies are excluded
absolutely.

**Possible amendment.** Adding to Article VIII:

> *A change is significant if it alters FRIDAY's observable behavior, her decision-making, her
> retained data, or her permissions. Adjustments with no observable effect on the user are not
> significant. FRIDAY shall never alter the rules governing her own authorization.*

---

## Tier 2 — Will require a decision before Milestone 8

### O5 — "The user" is singular, and you have said family may come later

**The gap.** Every founding document says "the user," singular. You have told me the data model
should support family members eventually.

Unanswered: When your spouse uses FRIDAY, are there two users of equal authority, or an owner and
guests? If your spouse asks FRIDAY something about you, what may she say? Whose approval is required
for an action affecting shared resources — a shared calendar, a home thermostat, a joint account?
May the owner read another principal's private memories?

**Why it matters.** Article I says "the user is the highest authority." With two users, that sentence
has no determinate meaning. The engineering seam exists (`principal_id` from day one, per
[Chapter 09](09-database-design.md)), but the *governance* question is unanswered.

**What I did.** [Chapter 17](17-authentication-authorization.md) proposes separate principals with
isolated memory, explicit revocable sharing, and an owner who may administer but **cannot read
another principal's private memories without a recorded, notified access event.** That last part is
a strong position I took deliberately — being the account owner should not silently mean reading
your family's private data.

**Possible amendment.** Article I extended to define authority in a multi-person household:
per-principal authority over their own data, joint authority over shared resources, and an
administrative role that is explicitly not a surveillance role.

---

### O6 — Trust can be earned but there is no mechanism for it to be lost

**The gap.** Principle 3 is titled "Trust Is Earned" and describes how FRIDAY builds it. Nothing
describes what happens when she loses it.

FRIDAY will eventually do something wrong — send the wrong email, act on a bad memory, propose a
change that breaks something. What then? Are standing grants revoked? Does she return to asking about
things she was previously trusted with? Is there a probation state?

**Why it matters.** A system that only accumulates trust and never loses it is not earning trust; it
is accumulating permissions. The asymmetry is precisely the failure mode Principle 3 exists to
prevent.

**What I did.** [Chapter 19](19-approval-system.md) makes every standing grant expire, which forces
periodic re-earning. But there is no *incident response* — no automatic tightening after a mistake.

**Possible amendment.** Adding to Principle 3 or Article VII:

> *When FRIDAY causes an outcome the user did not intend, she shall report it unprompted, suspend
> related standing permissions, and explain what she would do differently — before being asked.*

The "unprompted" is the important word. A system that reports its mistakes only when caught is not
being honest; it is being careful.

---

### O7 — There is no amendment process

**The gap.** These are founding documents with no stated procedure for changing them. Who may amend?
Does an amendment require anything beyond the owner's decision? Are amendments versioned and
recorded? May FRIDAY ever propose one?

**Why it matters.** Article X anticipates evolution over decades — "FRIDAY's principles should remain
stable while her capabilities continue to evolve." Over that horizon, some amendment will be
warranted. Without a process, it will be made informally, and the founding documents will quietly
become editable, which removes their force.

**What I did.** [`docs/00-foundation/README.md`](../00-foundation/README.md) states that only the
owner may amend, that amendments go through a pull request titled `amend:`, and that git history is
the constitutional record. That is a procedure I invented.

**Possible amendment.** An Article XIII:

> *These documents may be amended only by the user, deliberately, in a change that states its
> reasoning. Amendments are recorded permanently. FRIDAY may observe that an amendment appears
> warranted and explain why; she may never draft, propose, or apply one.*

That last clause matters more than it seems. A system that can propose changes to the rules
governing it is exerting influence over its own constraints, however politely.

---

### O8 — Nothing states what FRIDAY should refuse

**The gap.** The documents describe extensively what FRIDAY should do and how she should behave. They
say nothing about what she should decline to do **even when the user asks**.

**Why it matters.** Article I makes the user the highest authority, and I have implemented that
faithfully — FRIDAY does not second-guess you. But there are edges. If asked to monitor another
person's communications, should she? To generate content impersonating someone? To act on data
obtained without consent?

More mundanely and more likely: if asked to do something that would clearly harm *you* — delete the
backups, disable the audit trail, grant a permanent unrestricted standing grant — should she comply
immediately, or say so first?

**What I did.** I have implemented a narrow version: FRIDAY warns before actions that reduce her own
safety guarantees (disabling audit, removing backups, granting unbounded permissions) and requires
step-up authentication, but she complies if you confirm. She has no other refusals.

**Possible amendment.** Something modest, consistent with Article I rather than overriding it:

> *FRIDAY serves the user and does not substitute her judgment for theirs. She may state a concern
> once, clearly, before acting on a request she believes is harmful to the user or to others — and
> then she acts as instructed. She shall not conceal, delay, or quietly decline.*

I would recommend against anything stronger. A personal system that refuses its owner is a system
with a second authority, which contradicts the founding premise.

---

### O9 — Nothing addresses FRIDAY's honesty about her own nature

**The gap.** FRIDAY will draft messages sent under your name. She may eventually speak to other
people. The documents do not say whether she should disclose that she is not you, or that she is
software.

**Why it matters.** It becomes concrete at Milestone 8 with Communications. If FRIDAY drafts a reply
and you send it, that is a tool and disclosure is not required. If FRIDAY replies autonomously under
a standing grant, the recipient is corresponding with software and does not know.

**What I did.** Nothing — no autonomous outbound communication exists before M8. This one is
genuinely open.

**Possible amendment.** Adding to Principle 2 (Transparency):

> *FRIDAY shall never represent herself as a person. When she communicates with someone other than
> the user without the user reviewing that specific message, the recipient shall be able to know
> that they are corresponding with an assistant.*

---

## Tier 3 — Worth considering, not urgent

### O10 — No continuity or succession provision

FRIDAY will hold the most complete record of your digital life that exists anywhere. The documents do
not address what happens if you are incapacitated or die. Who may access it? Should there be a
literary-executor equivalent? Should some of it be destroyed rather than inherited?

I have implemented nothing beyond the export mechanism ([Chapter 34](34-disaster-recovery.md)),
which means today the answer is "whoever has your Mac and your recovery card." That is probably not
the answer you want, and it is worth a deliberate decision rather than a default.

### O11 — No economic principle

The documents never mention cost. FRIDAY spends money on your behalf every time she thinks. I have
implemented hard fail-closed budgets ([Chapter 35](35-performance-goals.md)) because it is obviously
correct, but there is no founding principle requiring frugality — and "does this justify its cost"
is a legitimate question to ask of a recommendation, not just of infrastructure.

### O12 — FRIDAY's personality is asserted but not described

The Manifesto refers to FRIDAY as "she," says her personality must remain constant, and describes a
tone (calm, clear, not demanding). But there is no description of *who she is* — how formal, how
warm, whether she has opinions, whether she uses humor, how she handles being wrong.

Personality will emerge from prompts written by different people at different times, and it will
drift. Given that the Manifesto explicitly requires it to remain constant, a short characterization
would be worth writing — and would function as a specification that prompts are tested against.

### O13 — No stated position on exit

Nothing says what happens if you decide to stop using FRIDAY. I have implemented export and open
formats because Article I implies it, but a founding document that explicitly guaranteed the right to
leave — with your data intact and comprehensible — would strengthen the trust argument considerably.
Systems that make leaving easy are more trustworthy than systems that only promise not to trap you.

### O14 — Emergency action is not contemplated

Every mechanism requires approval. There is no provision for a situation where waiting causes harm —
a smoke alarm, a water leak, a security incident.

I have implemented no exception, deliberately: `critical` actions always require live confirmation.
If home automation ever includes safety-relevant devices, this becomes a real question, and the
answer should be yours rather than an emergent property of a risk table.

---

## What the documents get notably right

Worth recording, because these are the parts that made the architecture straightforward and should
be protected in any future amendment:

| Provision | Why it is unusually good |
|---|---|
| **"She should never silently implement them"** (P8) | An unambiguous, testable constraint. Most such documents say "with appropriate oversight." |
| **"Every subsystem should be replaceable"** (VI) | Converts directly into an enforceable architectural rule. |
| **"Prefer local processing whenever practical"** (IV) | Concrete enough to route on, flexible enough to be practical. |
| **"Recommendations without explanations are commands"** (P7) | The clearest statement of why explainability matters that I have seen in a document like this. |
| **The organization metaphor** | It produced the entire department/agent/connector structure. Metaphors that generate architecture are rare. |
| **"Will this still be a good decision five years from now?"** | Directly usable as a review question, and it is in the PR template. |
| **"If a feature does not reduce complexity, improve understanding, protect the user, or save meaningful time, it does not belong"** | A genuine scope constraint with teeth. |

---

## Recommendation

Nothing here blocks Milestone 0. All of it can be decided later.

If you address only three, I would suggest:

1. **O1 (materiality)** — before M2, when the Guardian's risk table is written. This is the
   definition everything else hangs on.
2. **O2 (third-party privacy)** — before M4, when the first connector brings other people's data
   into the system. It is the most significant genuine gap and the most expensive to retrofit.
3. **O3 (conflict resolution)** — whenever convenient, because I have already implemented a
   hierarchy and you should know what it is and whether you agree.

The rest can wait for the milestone that forces them.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial observations |
