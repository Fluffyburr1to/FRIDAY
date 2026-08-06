# 19 — Approval & Consent System

> **Governing provisions:** Constitution **Article III** (Approval) — this chapter is its
> implementation; Article I (The User), Article II (Transparency), Article IX (Respect); Manifesto
> Principle 1 (The User Is Always In Command), Principle 7 (Explainability).

---

## In plain language

This chapter implements the single most important sentence in your Constitution:

> *"Actions that could materially affect the user's data, finances, security, software, or physical
> environment require explicit approval unless the user has intentionally granted permission in
> advance."*

Every other safety mechanism in FRIDAY exists to make this sentence enforceable.

There is a failure mode I want to name at the start, because it is the one that actually happens and
it is not the one people design against. The danger is not that the approval system will be
bypassed. The danger is that it will work *too often*.

If FRIDAY asks permission for forty things a day, you will stop reading the requests. You will
develop a reflex: glance, tap approve, move on. At that point the system still shows a perfect audit
trail of you approving everything, and you are no longer actually in command — you are a rubber
stamp with a nice interface. **This is worse than having no approval system, because it produces
the appearance of oversight without the substance.**

So this chapter is designed around two requirements that pull against each other:

1. **Nothing consequential happens without you.** (Article III)
2. **You are asked rarely enough that you still read the requests.** (Article IX — respect for
   attention)

Everything below is an attempt to satisfy both.

---

## Risk classification

Every action in FRIDAY carries a risk class, assigned by the Guardian from a static policy table —
**never by an agent or a model**. This is the anti-manipulation property from Chapter 12: a confused
or injected model cannot classify a wire transfer as low risk, because it is not consulted.

| Class | Definition | Default | Examples |
|---|---|---|---|
| **`low`** | Reversible, no external effect, no data leaves | Auto | Read calendar, recall memory, draft text |
| **`medium`** | External effect, reversible, or sends data out | Approve; standing grant allowed | Create a calendar event, post a note, call a read API |
| **`high`** | Irreversible, or materially affects data/environment | Approve + step-up auth; narrow standing grants only | Send email, delete a file, change the thermostat |
| **`critical`** | Financial, security, or safety consequence | **Approve + step-up, every time. No standing grant may fully satisfy it.** | Move money, unlock a door, rotate credentials, change Guardian policy |
| **`self_modification`** | FRIDAY changing her own code or configuration | Approve, **desktop only**, full diff shown | Merge a pull request, change a prompt, alter a policy |

Two rules here are absolute:

**`critical` can never be fully pre-authorized.** A standing grant may narrow the question ("you
already said this vendor is fine") but the action still requires a live, biometric-confirmed
approval. If any single grant could authorize moving money unattended, Article III's protection for
finances would be theoretical.

**`self_modification` is desktop-only.** Approving a code change on a phone is not review. The
Guardian rejects these approvals when `responded_via` is `mobile`. This is enforced in code, not
policy — see [Chapter 08](08-mobile-strategy.md).

---

## The approval request

An approval request is a structured object, validated before it can be created. A request missing
any required field is rejected — you cannot be asked to approve something FRIDAY cannot explain.

```
ApprovalRequest
├── title           one plain-language line
├── riskClass
├── explanation
│   ├── what        the concrete action, from the connector's dry run
│   ├── why         traced from the plan and the originating intent
│   ├── confidence  how sure FRIDAY is this is right
│   ├── risks[]     what could go wrong, including irreversibility
│   └── alternatives[]   what else was considered and why not
├── preview         the actual artifact — the email text, the diff, the amount
├── impact
│   ├── reversible          boolean
│   ├── dataLeavesDevice    boolean + categories
│   └── estimatedCost
├── expiresAt
└── requiredAuth    none | biometric | passkey
```

The `explanation` block is Principle 7 rendered as a data structure: *"Every recommendation should
explain what, why, confidence, possible alternatives, potential risks."* Making these required
fields means an agent that cannot articulate its reasoning cannot request approval at all.

**`preview` comes from the connector's dry run, never from a model's description.** You approve the
actual email text that will be sent, not a summary of it. The gap between "send a follow-up to
Sarah" and the actual message is exactly where a mistake hides.

---

## Standing grants: the pressure valve

Article III's own escape clause — "unless the user has intentionally granted permission in advance"
— is what makes strict approval livable. It is also the mechanism most likely to erode the whole
system if designed carelessly, so it is heavily constrained.

```
StandingGrant
├── actionPattern     "calendar.event.create"
├── resourcePattern   "calendar:personal/*"
├── constraints       { maxAmountCents, timeWindow, maxPerDay, requiresDryRunMatch }
├── expiresAt         ★ MANDATORY — no perpetual grants exist
├── maxUses
└── revokedAt
```

### The five rules that keep grants from becoming a back door

| # | Rule | Reason |
|---|---|---|
| 1 | **Every grant expires.** Maximums by class: `medium` 90 days, `high` 30 days, `critical` never fully granted. | A permission granted once and never reviewed is how "the user is in command" quietly becomes false. |
| 2 | **Grants are specific.** No wildcard on both action and resource. `*` / `*` is rejected. | "FRIDAY can do anything" is not a grant, it is an abdication. |
| 3 | **Every use is recorded and visible.** `approval.auto_granted` events appear in the dashboard. | Article II — a pre-approved action is still an observable action. |
| 4 | **Creating a grant requires step-up authentication** and is itself `high` risk. | Granting standing permission is more consequential than the individual action. |
| 5 | **Expiring grants are reviewed, not auto-renewed.** FRIDAY reports use ("used 23 times, saved ~40 interruptions") and asks whether to renew. | Renewal becomes an informed decision with real data. |

Rule 5 is the one I would most defend. Automatic renewal would quietly convert every temporary
grant into a permanent one within a year. A short review with usage data is how a grant stays a
decision.

### How grants are created

Never proactively by FRIDAY as a nag. They arise from the approval flow itself:

> ✅ Approved — send email to Sarah Chen
>
> You have approved 8 similar emails to Sarah this month.
> **Always allow emails to Sarah Chen?** *(expires in 30 days)*

Offered after a demonstrated pattern, with the expiry stated up front. This is Article VIII applied
to permission: FRIDAY notices, proposes, and waits.

---

## Respecting attention (Article IX)

The rubber-stamp failure is prevented by reducing volume, not by making requests prettier.

| Mechanism | Effect |
|---|---|
| **Batching** | Non-urgent approvals accumulate and are presented together at natural moments, not one interruption each. |
| **Plan-level approval** | Approve a plan's shape once rather than each of its six steps. |
| **Standing grants** | The main volume reducer. |
| **Quiet hours** | Non-critical requests wait. `critical` always breaks through. |
| **Bundling** | Similar simultaneous requests presented as one decision with per-item override. |
| **Expiry** | Requests expire rather than accumulating into a backlog you will never face. |

**The monitored metric: approvals per day.** If it exceeds roughly 10 on a normal day, the system is
failing regardless of how correct each request is. The diagnostics system tracks this and raises an
issue — treating approval fatigue as a measurable defect rather than a vibe.

A second metric worth watching: **time-to-decision**. Approvals answered in under three seconds are,
statistically, not being read. A falling median is an early warning that the reflex has set in.

---

## Denial is first-class

Declining must be as easy and as consequential as approving.

| Response | Behavior |
|---|---|
| **Approve** | Step executes; plan continues |
| **Decline** | Step fails with reason `user_denied`; plan applies its `onFailure` policy |
| **Decline with reason** | Reason is recorded and fed into memory as a preference signal |
| **Ask me later** | Plan stays suspended; re-presented at a better time |
| **Never ask again for this** | Creates a **negative** standing grant — a standing denial |

Negative grants are as important as positive ones and are frequently omitted from systems like this.
"Never suggest scheduling anything on Fridays" is a boundary, and a system that cannot record
boundaries will keep asking. Article IX.

**Declining is never treated as a failure to be worked around.** FRIDAY does not rephrase and ask
again, or find another route to the same outcome. A denial is a decision.

---

## What must never happen

Enforced in the Guardian and covered by dedicated tests. These are the properties that, if
violated, mean the system is broken regardless of what else works.

1. An action above `low` executes without an approval record or a matching valid standing grant.
2. An approval request is created without a complete explanation.
3. A `critical` action executes on a standing grant alone.
4. A `self_modification` approval is accepted from a mobile client.
5. A standing grant is created without an expiry.
6. An agent or model assigns its own risk class.
7. An approval is auto-granted because a request timed out. **Timeout means denied.**
8. An approval decision is not recorded in the audit log.

Point 7 deserves emphasis: **failure defaults to inaction.** If the notification system is broken
and you never saw the request, the action does not happen. A system that proceeds when it cannot
reach you is not asking permission.

---

## Alternatives considered

### Approve everything up front (a permissions model like a phone app)

Grant broad permissions at install; act freely within them.

**Rejected** — this is precisely what Article III forbids. It also fails on the specifics: "FRIDAY
may send email" is not meaningful consent to any particular email.

### Trust levels that increase over time

FRIDAY earns autonomy by behaving well; approval requirements relax automatically.

**Superficially attractive** — it matches Principle 3's "trust is earned." **Rejected** because trust
would be granted by the system to itself, based on its own record. Article I says the user is the
highest authority; a system that expands its own permissions has taken authority from you, however
gradually and however well-behaved it has been. Standing grants achieve the same practical outcome
with you making the decision.

### Confidence-based auto-approval (act when the model is sure)

**Rejected** because model confidence is poorly calibrated and, critically, **an injected or confused
model is often highly confident.** Tying authority to self-reported certainty means the failure
modes that most need a human are exactly the ones that would bypass one.

### Undo instead of approval (act, allow reversal)

**Advantages:** far less friction; genuinely better UX for reversible actions.

**Rejected as the general model** because the actions that most need approval are the irreversible
ones. You cannot un-send an email or un-transfer money.

**Adopted where it fits:** for `low` and some `medium` reversible actions, FRIDAY acts and provides a
prominent undo. That is what "low risk means auto-approve" means in practice — combined with the
action being visible in the dashboard as it happens.

### Approval by a delegate or a second agent

**Rejected.** Article I: the user is the highest authority. An AI approving another AI's action is
not oversight, and it would be a security hole shaped like a feature.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Approval friction is real** and will occasionally be annoying. | Accepted — it is Article III functioning. Managed by volume reduction, not by weakening the requirement. |
| **Standing grants weaken the guarantee** — that is their purpose. | Accepted, and heavily constrained: mandatory expiry, no double wildcards, full auditing, no `critical` coverage. |
| **Durable suspension adds real complexity** to the plan engine. | Accepted — it is what makes waiting days for you architecturally free. |
| **Grant expiry means periodic review work** for you. | Accepted — reviews are batched, brief, and carry usage data. |
| **Timeout-means-denied will occasionally lose useful work.** | Accepted without qualification. The alternative is acting without consent. |
| **Rubber-stamping cannot be fully prevented** by architecture. | Accepted and *monitored* — approvals/day and time-to-decision are tracked as health metrics, which is the best a system can do. |

---

## Review triggers

- Approvals per day exceeds ~10 sustained → volume reduction required
- Median time-to-decision falls below 3 seconds → rubber-stamping; investigate
- Standing grants cover more than ~50% of medium-risk actions → the risk table may be miscalibrated
- Any of the eight "must never happen" properties is violated → **stop-the-line incident**
- Users regularly decline the same category → the risk classification or the department is wrong

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
