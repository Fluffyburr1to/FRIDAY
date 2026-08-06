# apps/mobile

**The approval surface.**

Milestone: **M7** — begins with a two-week go/no-go spike

## Charter

The phone has one job that matters more than everything else combined:

> **FRIDAY needs your approval, and you are not at your desk.**

Article III becomes impractical if approvals can only be granted at your Mac — which pushes you
toward broad standing grants, which weakens the guarantee far more than a notification would.

## Scope

| Tier 1 — why it exists | Tier 2 — useful | Tier 3 — **never on mobile** |
|---|---|---|
| Receive approval requests | Ask FRIDAY something | Full audit exploration |
| Approve/decline with full explanation | Review recent activity | Memory editing |
| Biometric confirmation | System health | Department/connector config |
| See what she is doing now | Quiet hours settings | **Approving code changes** |

The last exclusion is a **security control**, enforced by the Guardian: `self_modification`
approvals are rejected when the request originates from a mobile client. Reviewing a code change on
a phone is not review.

## Rules

1. **Push notifications carry no content.** A silent signal; the app fetches the actual request over
   an encrypted channel. Apple learns FRIDAY pinged you, not what about.
2. **Approve is never the default action** and never triggered by a notification swipe.
3. **Irreversibility is stated explicitly**, never buried.
4. **"Ask me later" is always available.** Article IX — you may decline to decide now.

**The M7 spike must answer four questions.** Failure on any one → switch to Capacitor immediately.

Reference: [Chapter 08](../../docs/01-bible/08-mobile-strategy.md)
