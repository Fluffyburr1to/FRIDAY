# 24 — Notification Framework

> **Governing provisions:** Constitution **Article IX (Respect)**, Article II (Transparency),
> Article III (Approval); Manifesto — The User Experience ("calm, not noisy... only interrupt when
> appropriate... respect attention"), Principle 10; **Core Value 10 (Respect Attention)**.

---

## In plain language

This is the chapter about when FRIDAY is allowed to interrupt you.

It matters more than it sounds. Your Manifesto is emphatic that FRIDAY should feel *calm* and should
*respect attention*. Meanwhile she is a system that watches many things, coordinates many services,
and needs your approval for consequential actions. Left unconstrained, she would become the noisiest
application you own — and every founding document would be violated by a system that was technically
doing its job.

The governing idea is an **attention budget**. Your attention is treated as a finite, spendable
resource with a daily limit. FRIDAY may spend it. She may not overdraw it. When the budget is
exhausted, non-urgent messages wait for the next natural moment rather than interrupting.

This inverts the normal design question. Most software asks "is this notification worth sending?"
and the answer is almost always yes, because each one seems justified in isolation. FRIDAY asks
"**is this worth more than the other things competing for the same budget today?**" — which is a
question that produces a different, much smaller answer.

---

## Urgency classes

Every notification declares one. This determines everything downstream.

| Class | Meaning | Breaks quiet hours? | Breaks focus? | Budget cost |
|---|---|---|---|---|
| **`critical`** | Safety, security, or irreversible loss imminent | **Yes** | Yes | 0 — exempt |
| **`urgent`** | Time-sensitive; delay causes real harm | No | Yes | 3 |
| **`normal`** | Should be seen today | No | No — queued | 1 |
| **`low`** | Informational | No | No | 0 — digest only |

**Only `critical` may break quiet hours**, and the definition is deliberately narrow: a security
incident, a smoke alarm through a home connector, a system failure risking data loss, or a
`critical`-risk approval you explicitly asked to be woken for. Nothing else. Not a meeting, not a
deadline, not an interesting finding.

Assigning `critical` to a routine notification is a defect caught in review. The class exists to be
rare; if it is not rare, it stops working.

**Default budget: 12 points per day.** Roughly eight to twelve interruptions. Tunable, and monitored
— consistently hitting the ceiling is itself a diagnostic finding, because it means FRIDAY is doing
something wrong upstream rather than notifying wrongly.

---

## Delivery decision

Every notification passes through the same evaluation:

```
1  URGENCY        critical? → deliver immediately, all channels, skip everything below
2  DEDUPLICATION  already told you this? → suppress, increment a counter
3  BATCHING       similar pending items? → hold and combine
4  QUIET HOURS    within them and not critical? → queue for the next window
5  FOCUS          Do Not Disturb / in a meeting? → queue unless urgent
6  BUDGET         exhausted? → downgrade to digest
7  CHANNEL        which surfaces, by presence and preference
8  DELIVER        record notification.sent
9  OBSERVE        seen? acted on? → feeds future tuning
```

Steps 2 and 3 do most of the work. **Deduplication** is why a connector failing forty times produces
one notification with a count, not forty notifications. **Batching** is why three approvals arriving
within ten minutes become one message with three items rather than three interruptions.

### Presence-aware routing

FRIDAY delivers to where you are, not to everywhere at once.

| Detected state | Routing |
|---|---|
| Active at the Mac | Desktop only. No phone push. |
| Mac idle > 5 min, phone active | Phone only |
| All devices idle | Queue; deliver when you return |
| Do Not Disturb active | Queue unless `critical` |
| Screen shared / presenting | Queue unless `critical`, and **suppress content previews** |

The presentation case is a small detail with a large embarrassment cost. FRIDAY knowing not to
display "Approval needed: transfer $4,200 to..." while your screen is shared is exactly the kind of
respect Article IX is asking for.

**Presence detection is entirely local.** No third party learns where you are or when you are at
your desk.

---

## Channels

| Channel | Best for | Notes |
|---|---|---|
| **Dashboard (ambient)** | Everything | Always available; never an interruption. The default. |
| **Menu bar badge** | Pending counts | Ambient, glanceable, zero cost |
| **macOS notification** | `normal`+ while at the Mac | Native, respects system DND |
| **Phone push** | `urgent`+ while away | **Content-free signal only** — see [Chapter 08](08-mobile-strategy.md) |
| **Voice** | `critical` only, and only if enabled | Most intrusive; used sparingly |
| **Daily digest** | `low` and batched items | One message at a time you choose |

**The dashboard is the primary channel and it is not an interruption.** Most of what FRIDAY has to
say belongs there, visible when you look, silent when you do not. Reaching for a push notification
should feel like a decision, not a default. This is the practical meaning of "the best interface is
often the one that disappears."

---

## The digest

Once a day, at a time you set, one message:

```
FRIDAY — Tuesday

  3 approvals waiting        oldest: 4 hours
  ─────────────────────────────────────────
  · Send follow-up to Sarah Chen
  · Create calendar event: Design review
  · Renew standing grant: calendar writes (expires Friday)

  Yesterday
  ─────────────────────────────────────────
  12 plans completed · 2 failed (Gmail rate limit, retried OK)
  $1.40 spent · all systems healthy

  1 improvement proposal
  ─────────────────────────────────────────
  · Summarization could use a cheaper model — ~$8/mo saving,
    no measured quality difference across 40 eval scenarios
```

Everything non-urgent lives here. It is one interruption per day carrying what would otherwise have
been twenty.

---

## Notification content

Every notification obeys the same rules, because a notification you cannot act on is noise wearing a
uniform:

1. **Say what it is in the first line**, without opening anything.
2. **Say why you are seeing it.** "Because you asked me to watch for this."
3. **Offer the action inline** where possible — approve/decline from the notification for
   low-complexity items.
4. **Never show sensitive content on a lock screen or shared display.** "Approval needed" — never
   the amount, never the recipient.
5. **Plain language always.** Never `plan.step.failed: ECONNRESET`.
6. **No fabricated urgency.** No red badges, exclamation marks, or countdown timers on things that
   are not urgent. Manufacturing urgency to drive engagement is the opposite of Article IX, and it
   is a pattern this system will never adopt.

Rule 6 is worth stating explicitly because it is the industry norm and it would be easy to drift
into.

---

## Feedback

FRIDAY measures whether her notifications were worth sending:

| Signal | Interpretation |
|---|---|
| Seen and acted on quickly | Well-targeted |
| Seen, dismissed, no action | Possibly not worth an interruption |
| Never seen before expiry | Wrong channel or wrong time |
| Explicitly muted by you | Strong negative signal |

These feed improvement proposals ([Chapter 23](23-diagnostics-system.md)) — *"notifications about
connector health are dismissed 90% of the time; suggest moving them to the digest."* FRIDAY
**proposes** the change and waits. She does not silently retune her own interruption policy, because
that policy is about your attention and you own it.

---

## Alternatives considered

### Notify on everything, let the user filter

**Advantages:** nothing is missed; no risk of over-suppression; simplest to build.

**Rejected** — it is the default behavior of most software and it is precisely what Article IX and
Core Value 10 forbid. It also fails on its own terms: a user who mutes everything misses the
critical notification too.

### AI-decided notification importance

Let a model judge whether each notification is worth sending.

**Rejected as the primary mechanism** for two reasons. It is non-deterministic — the same
notification might interrupt you on Tuesday and not on Wednesday, which makes FRIDAY feel
unpredictable, and Principle 3 says trust is built through predictability. And it is unexplainable:
"why didn't you tell me?" deserves a better answer than "the model judged it unimportant."

Declared urgency plus deterministic rules gives behavior you can predict and inspect. A model may
*suggest* an urgency class at authoring time; the rules decide delivery.

### Per-notification user preferences

**Rejected as the primary model** — it pushes configuration burden onto you for dozens of categories,
which is complexity masquerading as control. Sensible defaults with an attention budget plus simple
overrides (mute a category, change the digest time) achieves the outcome without the settings
screen. Principle 10.

### No push notifications; check the dashboard

**Advantages:** maximally calm; zero interruption; strongest privacy.

**Rejected** because Article III requires timely approval, and approvals that wait until you happen
to open a dashboard make strict approval impractical — which pushes you toward broad standing
grants, which weakens Article III far more than a notification would.

**Partially adopted:** the dashboard *is* the primary channel, and push is reserved for `urgent` and
above.

### Email or SMS as notification channels

**Rejected** — both route your notification content through third parties (mail providers, carriers),
conflicting with Article IV. SMS is additionally unencrypted. The content-free push design exists
specifically to avoid this.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **The attention budget will sometimes delay something you wanted sooner.** | Accepted — the alternative is a system you mute entirely. `critical` is always exempt. |
| **Batching adds latency** to non-urgent items. | Accepted — that is what non-urgent means. |
| **Content-free push requires a round trip** before you see what it is about. | Accepted — Article IV. A second of latency for not routing your life through Apple's servers. |
| **Presence detection is imperfect** and will occasionally route badly. | Accepted — mitigated by delivering to the dashboard always, so nothing is ever lost. |
| **Deterministic rules are less adaptive** than an AI judge. | Accepted — predictability is worth more than optimality here (Principle 3). |
| **A daily digest means some findings wait up to 24 hours.** | Accepted — anything that genuinely cannot wait is `urgent` or above by definition. |

---

## Review triggers

- Notifications routinely exceed the attention budget → an upstream problem, not a notification one
- Dismissal rate for any category exceeds ~70% → that category should be digest-only
- A `critical` notification is missed → channel reliability review; this is a serious failure
- Approval response time degrades → notification delivery may be failing
- You mute a channel entirely → the framework is not working; investigate rather than accept

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
