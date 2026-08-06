# @friday/notifications

**When FRIDAY is allowed to interrupt you.**

Milestone: **M4**

## Charter

Article IX and Core Value 10. The organizing idea is an **attention budget**: your attention is a
finite resource with a daily limit that FRIDAY may spend but not overdraw.

This inverts the usual question. Not *"is this notification worth sending?"* — which is almost always
yes in isolation — but *"is this worth more than the other things competing for the same budget
today?"*

## What lives here

- Urgency classes: `critical` · `urgent` · `normal` · `low`
- The attention budget (default 12 points/day)
- Deduplication and batching — 40 connector failures become one notification with a count
- Quiet hours, focus detection, presence-aware routing
- Channel delivery: dashboard, menu bar, macOS notification, phone push, voice, digest
- The daily digest

## What does NOT

- Deciding an action's importance — that comes from its declared urgency
- Any notification content that reveals sensitive detail on a lock screen or shared display

## Rules

1. **Only `critical` breaks quiet hours**, and the definition is deliberately narrow. If `critical`
   is not rare, it stops working.
2. **The dashboard is the primary channel and is not an interruption.** Push is for `urgent`+.
3. **No manufactured urgency.** No red badges, exclamation marks, or countdowns on things that are
   not urgent. That pattern is the industry norm and this system will not adopt it.
4. **Presence detection is entirely local.**

Reference: [Chapter 24](../../docs/01-bible/24-notification-framework.md)
