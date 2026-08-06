# 26 — Dashboard Architecture

> **Governing provisions:** Constitution **Article II (Transparency)** — this chapter is its
> primary implementation; Article I (The User), Article IX (Respect); Manifesto Principle 2
> (Transparency Above All), Principle 7 (Explainability), Principle 10 (Simplicity Wins), The User
> Experience.

---

## In plain language

The dashboard is where Article II lives. Your Constitution says:

> *"Every recommendation, automation, and system action should be observable through logs,
> dashboards, or explanations."*

That is a promise, and the dashboard is where it is kept. If FRIDAY does something and you cannot
find out what, why, when, what it cost, and what she was uncertain about — the promise is broken,
regardless of how good the audit trail is internally. **A record nobody can read is not
transparency.**

The design challenge is a genuine contradiction in the founding documents, and it is worth naming
rather than pretending it away:

- The Manifesto wants FRIDAY to feel **calm, simple, and quiet**. "Complex systems should feel
  simple."
- The Constitution requires **everything to be inspectable**. Every action, every decision, every
  cost.

Total inspectability naively implemented produces an overwhelming wall of information — the opposite
of calm. The resolution is **progressive disclosure**: the surface is calm and nearly empty, and
depth is always exactly one click away. You should be able to use FRIDAY for months seeing only the
first layer, and be able to reach the raw event payload of any action in three clicks when you want
it.

Nothing is hidden. Not everything is shown.

---

## The four layers

```
LAYER 1  ── AMBIENT ──────────────────────────────────────
  Menu bar · one glance · zero interaction
  "Is FRIDAY healthy? Does she need me?"
        │
LAYER 2  ── OVERVIEW ─────────────────────────────────────
  The home screen · what is happening now · what needs you
        │
LAYER 3  ── DETAIL ───────────────────────────────────────
  A specific plan, approval, memory, or department
  Full explanation in plain language
        │
LAYER 4  ── FORENSIC ─────────────────────────────────────
  Raw events, exact prompts, exact costs, causal graph,
  the integrity chain
```

Most people live in layers 1 and 2. Layer 4 exists so that the answer to "can I see exactly what
happened?" is always yes.

---

## Layer 1 — Ambient

The menu bar icon, and nothing else:

| State | Appearance |
|---|---|
| Healthy, idle | Quiet outline icon |
| Working | Subtle animated indicator |
| Approvals pending | Badge with count |
| Degraded | Amber |
| Critical / Safe Mode | Red |

Five states. One glance. Deliberately not a mini-dashboard — the Manifesto's "calm, not noisy"
applies most strictly to the thing that is always on your screen.

---

## Layer 2 — Overview

```
┌──────────────────────────────────────────────────────────┐
│  FRIDAY                              ● All systems well  │
│                                                          │
│  NEEDS YOU                                     3         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Send follow-up to Sarah Chen        medium  →      │  │
│  │ Renew: calendar writes (exp. Friday) medium →      │  │
│  │ Improvement: cheaper summarization model    →      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  HAPPENING NOW                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ▸ Preparing Thursday briefing      step 2 of 4     │  │
│  │   Knowledge · started 40s ago · $0.03 so far       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  TODAY                                                   │
│  12 completed · 1 failed · $1.40 · 0 data sent externally │
│                                                          │
│  ORGANIZATION                                            │
│  Operations ●   Knowledge ●   Engineering ●   Comms ◐    │
│                              Comms: Gmail rate-limited,  │
│                              retrying in 4 min           │
└──────────────────────────────────────────────────────────┘
```

Design rules for this screen:

1. **"Needs you" is always first.** Article III depends on you noticing.
2. **Live, never stale.** Streamed over WebSocket. No refresh button exists.
3. **Cost is always visible.** Both so surprises do not happen and because it is genuinely
   informative about what FRIDAY is doing.
4. **"0 data sent externally" is a first-class metric.** Article IV made visible daily rather than
   buried in a privacy settings page.
5. **Degraded components explain themselves inline.** Not "Comms: error" but "Gmail rate-limited,
   retrying in 4 min." Principle 9.
6. **Nothing blinks, pulses, or demands.** One animated element maximum.

---

## Layer 3 — Detail

### The plan view

The most important detail screen. Shows the plan as its actual step graph, with live status,
per-step cost, and the Guardian's decision on each.

```
  "Prepare me for Thursday's board meeting"
  ──────────────────────────────────────────────────
  Started 14:32 · Knowledge dept · $0.11 · running

  ┌─ 1 ─ Find the meeting ────────── ✓ 0.2s   $0.00 ─┐
  │      calendar.list · low · auto-approved          │
  ├─ 2 ─ Locate related documents ── ✓ 1.1s   $0.02 ─┤
  │      memory.search · low · auto-approved          │
  ├─ 3 ─ Summarize prior minutes ─── ▸ running $0.09 ─┤
  │      model · claude-opus · 4,100 tokens           │
  └─ 4 ─ Draft a briefing ────────── ○ pending ───────┘

  ▸ Why this plan?              ▸ What FRIDAY recalled
  ▸ What she was unsure about   ▸ Full event log
```

**Every step shows what authorized it.** "auto-approved" is itself information — it tells you the
Guardian classified it `low` and why. Article II means showing the decisions, not just the actions.

### The "Why?" view

Available from any action. Generated from the causal chain
([Chapter 10](10-event-bus.md)), never from a model recalling its own reasoning.

Answers, in order: what she did, why (traced to your original request), what she knew and where it
came from, what she was uncertain about, what alternatives she considered, what it cost, and what
authorized it.

**Every claim on this screen links to the event that supports it.** That link is what separates an
explanation from a story.

### The memory browser

Everything FRIDAY believes, searchable by subject, each entry showing its content, confidence,
source event, when learned, when last used, and sensitivity — with edit, correct, and forget
actions.

This screen is the practical expression of Article I. Your data includes FRIDAY's conclusions about
you, and you should be able to read and correct them. Most systems make their internal model of you
completely invisible; this one makes it a browsable list.

### The privacy view

"What has left my machine?" — by connector, by data category, by destination, over any time range.
Compiled from recorded events, not from a policy document describing intent.

---

## Layer 4 — Forensic

The audit explorer. Raw events with full payloads, filterable by correlation, actor, type, and time.
The causal graph, navigable. Exact prompts sent to models and exact responses received. Cost
attribution per event. Integrity chain verification status.

**Nothing here is inaccessible.** There is no internal-only view, no hidden telemetry, no
administrator mode you do not have. Article II means the ceiling on what you can inspect is the
same as the ceiling on what was recorded.

Redaction applies only where *you* have redacted something.

---

## Alternatives considered

### A chat-first interface (conversation as the primary surface)

**Advantages:** familiar, low-friction, and the dominant pattern for AI products.

**Rejected as the primary surface.** Your Manifesto says explicitly: *"FRIDAY is not a chatbot."* A
chat log is a poor instrument for the things Article II requires — you cannot see the shape of a
plan, the state of the organization, or what is pending, and finding a past action means scrolling.
Chat is *one input method* into a structured system, present in the command bar. It is not the
system.

### A traditional admin dashboard (charts, tables, metrics)

**Advantages:** dense, powerful, familiar to operators.

**Rejected** because it optimizes for an operator monitoring infrastructure, not a person living with
an assistant. Charts of request rates are not what Article II is asking for — the question is "what
did FRIDAY do and why," which is narrative and causal, not statistical.

Metrics exist in Layer 4 for when you want them.

### Show everything on one screen

**Rejected** — directly contradicts "calm, not noisy" and "complex systems should feel simple." The
strongest argument for it is that hidden information can hide problems; progressive disclosure
answers that by making the path to depth short, obvious, and always available.

### Minimal UI, everything through voice or chat

**Rejected** — Article II requires observability, and a great deal of what must be observable (a plan
graph, a memory corpus, an audit chain) is inherently visual. A conversational interface can report
that something happened; it cannot let you *browse* what happened.

### Separate dashboards per department

**Rejected** — fragments the picture. Article II is about the whole system's behavior. Departments
appear as a status row and as filters, not as separate destinations.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Progressive disclosure means important things can sit one layer down.** | Accepted — mitigated by "needs you" always occupying layer 2, and by degraded states surfacing inline. |
| **Four layers is more to build** than one screen. | Accepted — layers 1 and 2 ship at M4; 3 and 4 grow with the system. |
| **Live streaming adds real-time complexity** and a WebSocket to keep healthy. | Accepted — a dashboard requiring refresh fails Article II in spirit. |
| **The forensic layer exposes raw internals** that could confuse. | Accepted — it is deliberately the deepest layer, and it is what makes "nothing is hidden" true. |
| **Rendering a live plan graph is genuinely hard** to do well. | Accepted — it is the single highest-value screen in the product. |
| **Not chat-first** means a less familiar first impression. | Accepted — the Manifesto is explicit, and the command bar covers the conversational need. |

---

## Review triggers

- Layer 4 is never used → either the system is trusted (good) or it is unusable (investigate)
- "Why?" explanations are consistently insufficient → the audit trail is missing something
- Overview feels cluttered → prune; calm is a requirement, not a preference
- Plan graph rendering degrades above a step count → virtualize
- You find yourself asking a question the dashboard cannot answer → that is a defect, not a feature
  request

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
