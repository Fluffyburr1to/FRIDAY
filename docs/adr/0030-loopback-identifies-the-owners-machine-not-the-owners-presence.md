# ADR-0030 — Loopback identifies the owner's machine, not the owner's presence

- **Status:** accepted
- **Date:** 2026-08-08
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [ADR-0029](0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md),
  [ADR-0005](0005-guardian-sole-authorization.md),
  [ADR-0006](0006-capability-based-authorization.md),
  [Chapter 17 — Authentication and Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 19 — Approval System](../01-bible/19-approval-system.md),
  [Chapter 26 — Dashboard Architecture](../01-bible/26-dashboard-architecture.md)

---

## Context

Milestone 2 is complete when a simulated action requests permission, blocks, appears in the
dashboard with a full explanation, waits across a restart, and executes only after the owner
approves. The first four of those work. The last one does not, because answering an approval
requires knowing **who is answering**, and `apps/core` has no idea.

Its context is one field — the event reader. There is no session, no actor, no identity of any
kind. It is an unauthenticated HTTP server on loopback, which was correct while the dashboard could
only read.

Answering an approval is not reading. `ApprovalResponse` carries an `authenticatedAt`, and
`checkSurfaceAndAuth` enforces it:

| Risk class | `requiredAuth` | What the Guardian demands |
|---|---|---|
| `low`, `medium` | `none` | Nothing beyond the response itself |
| `high` | `biometric` | Proof of identity within the last 60 seconds |
| `critical`, `self_modification` | `passkey` | Proof of identity within the last 60 seconds |

Anything above `medium` without a fresh `authenticatedAt` is refused with `STEP_UP_REQUIRED`.

[Chapter 17](../01-bible/17-authentication-authorization.md) says how each surface proves identity:

| Surface | Method |
|---|---|
| Desktop app on the host Mac | OS-level session + device keypair in Keychain |
| Web dashboard from another machine | Passkey (WebAuthn) |
| iPhone app | Device-bound keypair, unlocked by Face ID |
| **High-risk approvals, any surface** | **Re-authentication via biometric** |

**There is no row for a browser on the host Mac**, which is exactly what Milestone 2 ships. The
desktop row's reasoning — you already authenticated to macOS, and a second password to reach a local
service you own is friction without security benefit — is about the Tauri shell, which arrives at
M4. The M2 dashboard is a page served to Safari or Chrome on the same machine. Close to that row,
and not the same thing.

So two questions have to be answered before the Guardian joins this route, and they are different
questions: **who is asking**, and **how sure are we they are here right now**.

**What we do not know at the time of writing:** whether the M4 Tauri shell will supply Touch ID
cleanly enough that the browser path becomes vestigial, or whether the browser remains a surface
people actually use. That determines whether the restriction below is a temporary scaffold or a
permanent property of one surface.

## Decision

We will **treat a loopback connection as establishing local ownership of the service boundary — the
request came from this machine, under this login — and never as evidence that the owner is
present.**

Two consequences follow, and they are the whole decision:

1. Responses are attributed to the configured principal (`usr_owner`) with a `user` actor and the
   `web` response surface. That is enough for `low` and `medium` approvals, whose `requiredAuth` is
   `none`.
2. **`high`, `critical`, and `self_modification` approvals are displayed in full in the browser and
   cannot be answered there.** `apps/core` never synthesises `authenticatedAt`. The controls render
   disabled, with the reason stated, until a surface exists that can actually prove presence.

## Constitutional review

- **Article III (Approval):** the provision this is about. Article III is satisfied by an approval
  being *informed and genuine*, not by one being *convenient*. Answering a `critical` request on the
  strength of a TCP connection would be a recorded approval that no human necessarily gave, which is
  worse than no approval path at all — it would put the owner's name on something they did not do.
- **Article II (Transparency):** the requests remain fully visible, with explanation, risk class,
  and what authorised them. Hiding what cannot be actioned would be the easier build and the wrong
  one; a pending approval the owner cannot see is the exact failure Article II exists to prevent.
- **Article I (The User):** the owner is told plainly why a control is unavailable and what would
  make it available. An interface that silently omits options decides on the owner's behalf.
- **Article V (Security):** least privilege. The dashboard gains the smallest authority that makes
  M2 demonstrable, and none beyond it.
- **ADR-0005 (Guardian sole authorization):** unchanged and load-bearing here. The UI disabling a
  button is a rendering of `requiredAuth`, which the server computed — not a second authority
  deciding. If the UI were bypassed, the Guardian would still refuse with `STEP_UP_REQUIRED`. **The
  disabled control is a courtesy to the owner, not the enforcement.** Enforcement is where it has
  always been.

**The five questions:**

- [x] **Can the user see it?** Every approval is visible regardless of whether it can be answered
      here, and the response is recorded with its surface.
- [x] **Can the user stop it?** Yes — and the point of this ADR is that the highest-risk actions
      cannot be *started* from this surface either.
- [x] **Can we replace it?** The identity decision is one function producing an actor. A real
      authenticator replaces it without touching the router.
- [x] **Can we explain it?** Yes. The response records who, when, by what surface, and what
      authorised it.
- [ ] **Will this still be right in five years?** **Partly, and the halves differ.** "Local access
      is not presence" should still be right. "The browser cannot answer high-risk approvals" is a
      statement about a missing capability and should stop being true at M4.

**Notes:** The uncomfortable part, stated rather than buried: **any process running as this user can
reach `127.0.0.1:7420`.** Loopback is not a proof of anything about a human. It is meaningfully
weaker than Chapter 17's desktop row, which pairs the OS session with a device keypair. This ADR
extends that row to a neighbouring surface while being explicit that it does not match it.

## Alternatives considered

### Treat the loopback session as satisfying step-up

**What it is.** Have `apps/core` set `authenticatedAt` to now on every response, so all approvals
including `critical` can be answered from the browser immediately.

**Advantages.** M2's completion criterion is met in full today. No surface is second-class. No
disabled controls to explain.

**Why rejected, and this is the one that matters.** It would make `STEP_UP_REQUIRED` unreachable —
a constitutional guarantee reduced to a field the server fills in for itself. Chapter 17 is explicit
that session-based authorization alone "would let anyone walking past approve anything," and that
the 60-second window exists because *an unlocked device is not sufficient authorization to move
money*. Synthesising the timestamp does not implement the check; it defeats it while leaving the
code that looks like it. That is invisible in a diff and would be discovered, if ever, by an
approval that should not have happened.

### Add a device keypair to `apps/core` now

**What it is.** Issue a keypair into the Keychain at first run and have the dashboard prove
possession, matching Chapter 17's desktop row properly.

**Advantages.** Genuinely stronger than loopback. Closer to the ratified design. Would justify a
larger set of approvals.

**Why rejected.** It proves the *browser* is the browser, not that the *owner* is present — so it
does not unlock `high` or above either, which is where the restriction actually bites. It is real
authentication machinery built at M2 to move nothing.

### Implement WebAuthn passkeys in the browser now

**What it is.** Chapter 17's answer for a web dashboard, brought forward: register a passkey and
require it for step-up.

**Advantages.** The correct long-term mechanism, and it *would* unlock high-risk approvals in the
browser. Phishing-resistant, hardware-backed, already the ratified choice.

**Why rejected for M2, and it is the closest call here.** Chapter 17 pairs passkeys with a recovery
story it calls a serious failure mode — two registered devices required, recovery codes, a printed
recovery card — none of which exists until M5. Shipping the lock before the key-recovery is how the
owner gets locked out of their own system. It is the right build, in the wrong order, and it is
recorded as the expected successor rather than a rejected idea.

### Keep the dashboard read-only and defer all approvals to the M4 shell

**What it is.** No mutations at M2. The Tauri shell becomes the first surface that can answer
anything.

**Advantages.** Honours Chapter 17 exactly, with no new row and no partial capability. `apps/core`
stays read-only, so ADR-0029's reversibility holds longer.

**Why rejected.** It re-scopes M2's completion criterion, which is written in terms of the
dashboard, and leaves the approval flow unexercised until M4 — the flow most worth exercising early,
because it is the one Article III depends on. Low and medium approvals are the overwhelming majority
and are exactly the ones `requiredAuth: none` was designed to let through.

## Consequences

**Positive**

- M2 can demonstrate the approval loop end to end for the risk classes that do not require presence.
- The Guardian joins the `apps/core` route, which is where ADR-0005 always said it belonged.
- The step-up rule gets exercised for real rather than being a branch nobody has hit.
- The identity seam exists in one place, so M4's real authenticator is a substitution.

**Negative**

- **Local access is not presence, and this decision knowingly treats it as sufficient for `low` and
  `medium`.** Any process running as this user can reach the port and answer those approvals. The
  mitigation is that `low` and `medium` are precisely the classes the Guardian already decided do
  not warrant interrupting the owner — but it is a real widening of what a local process can do,
  and it is the cost being paid here.
- **The M2 dashboard cannot complete the half of Article III that matters most.** A `critical`
  request will sit visible and unanswerable until M4. That is the correct failure direction and it
  is still a gap.
- **Two surfaces will differ in capability**, and the difference has to be explained in the
  interface every time it comes up.
- `apps/core` stops being read-only. ADR-0029's stated point of no return arrives with this change.

**Neutral**

- The `web` response surface is recorded on every answer, so the audit trail distinguishes a
  browser approval from a desktop one without any new vocabulary.
- `self_modification` is already barred from `mobile` by `checkSurfaceAndAuth`. This adds no new
  surface rule; it declines to grant one.

## Reversibility

- **Cost to reverse:** low while the restriction stands; medium once it is relaxed.
- **How:** identity is produced in one function in `apps/core`. Replacing loopback attribution with
  a real authenticator does not change the router, the Guardian, or the recorded shape of a
  response.
- **Point of no return:** none for the mechanism. The irreversible part is any approval *granted*
  under it — a recorded approval cannot be un-recorded, which is why the classes requiring presence
  are excluded rather than trusted.

## Review triggers

- **The Tauri shell ships (M4)** — it can do Touch ID, so the browser restriction should be
  re-examined rather than inherited. This is the trigger that matters.
- **Passkey recovery exists (M5)** — the WebAuthn alternative above becomes buildable safely, and
  high-risk approval in the browser becomes a real option.
- `apps/core` binds to anything other than loopback — this decision's entire basis disappears and it
  must be revisited before that ships, not after.
- A second principal is added — "the loopback user is the owner" stops being true the moment there
  is more than one.
- Any proposal to set `authenticatedAt` outside a real authenticator. That is this ADR being
  reversed, and it needs to be argued as such.

## Notes

The judgment call is the `low`/`medium` line, and it is worth naming as a judgment rather than a
derivation. The Guardian's own risk classification is what decides which approvals need presence;
this ADR does not invent a threshold, it declines to override one. If that classification is wrong
for some action, the fix belongs in `packages/guardian/policies/`, not here.

What this ADR deliberately does **not** do is add a row to
[Chapter 17](../01-bible/17-authentication-authorization.md)'s surface table. The chapter is a
ratified document, and a browser on the host Mac is a surface it did not contemplate. Recording the
gap here, and pointing at it from the chapter when it is next revised, keeps the Bible honest about
having been written before this case existed.
