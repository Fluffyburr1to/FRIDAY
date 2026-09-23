# ADR-0052 — A native shell is not evidence of a human

- **Status:** proposed
- **Date:** 2026-09-23
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — this is [ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md)'s
  first review trigger, answered. ADR-0030's central holding stands; this decides what the desktop
  shell changes and, more importantly, what it does not.
- **Related:** [ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md) ·
  [ADR-0005](0005-guardian-sole-authorization.md) ·
  [ADR-0006](0006-capability-based-authorization.md) ·
  [Chapter 07 — Desktop Strategy](../01-bible/07-desktop-strategy.md) ·
  [Chapter 17 — Authentication and Authorization](../01-bible/17-authentication-authorization.md) ·
  [Chapter 19 — Approval System](../01-bible/19-approval-system.md)

---

## Context

[ADR-0030](0030-loopback-identifies-the-owners-machine-not-the-owners-presence.md) decided that a
loopback connection establishes *local ownership of the service boundary* and never *the owner's
presence*. Its consequence is the restriction in force today: `high`, `critical`, and
`self_modification` approvals are shown in full in the browser and cannot be answered there,
because `apps/core` never sets `authenticatedAt`.

It recorded its own first review trigger: *"The Tauri shell ships — it can do Touch ID, so the
browser restriction should be re-examined rather than inherited. This is the trigger that
matters."* The shell is now the active milestone, so this is that re-examination.

### What is actually in the code today

Verified against the repository rather than the documentation:

| Fact | Where |
|---|---|
| `apps/core` binds `127.0.0.1` by default | `apps/core/src/server.ts:26,47` |
| The server has no session, no cookie, no token, no client identity of any kind | `apps/core/src/context.ts`, `router.ts` |
| `authenticatedAt` is never set by core, deliberately and with the reason in a comment | `apps/core/src/router.ts:193-217` |
| Enforcement is in the Guardian, not the UI — `STEP_UP_REQUIRED` for anything above `medium` | `packages/guardian/src/approvals.ts:314-342` |
| `self_modification` is additionally barred from `mobile` | `packages/guardian/src/approvals.ts:319-327` |
| `desktop` already exists as a response surface and is **unused** | `packages/contracts/src/approval.ts:128` |
| The whole seam is one optional field on one interface | `packages/guardian/src/approvals.ts:87-98` |

That last row is the important one. **The trust decision reduces to who may set one field**, and
nothing else in the system has to move.

### The trap this ADR exists to avoid

The naive reading of the review trigger is: *a native app is more trustworthy than a web page, so
the native app may answer high-risk approvals.* That reasoning is wrong, and it is wrong in a way
that would be very hard to see afterwards.

**A Tauri shell running as this user, talking to `127.0.0.1`, is exactly as unprivileged with
respect to `apps/core` as the browser is.** Core cannot tell them apart. There is no handshake, no
credential, no attestation. Any process on this machine can open that port, send
`{ via: 'desktop', authenticatedAt: Date.now() }`, and be believed.

So if the shell simply asserted `authenticatedAt`, that would be ADR-0030's explicitly rejected
alternative — *"synthesising the timestamp does not implement the check; it defeats it while leaving
the code that looks like it"* — relocated into a different process and made harder to notice,
because the process is now called FRIDAY.app.

**The native shell is not the thing that creates trust. It is the thing that can host a mechanism
that creates trust.** Those are different, and the difference is this entire decision.

---

## Decision

*Proposed. This changes the trust model and is the owner's to accept or reject.*

### 1. What loopback proves, restated and unchanged

A loopback connection proves that **a process on this machine, running as this login, made this
request.** ADR-0030's holding is unchanged and is not weakened by anything below.

### 2. What loopback does not prove

It does not prove a human is at the keyboard. It does not prove the human is the owner. It does not
prove the request was intended by anyone at all. Any process running as this user — a shell script,
a compromised dependency, another AI agent with terminal access, a piece of malware — reaches the
same port with the same authority. Nothing about the port distinguishes them.

### 3. A native shell does not, by itself, change the trust boundary

★ Stated as a decision rather than an observation, because it is the thing most likely to be quietly
assumed later. **`via: 'desktop'` is self-asserted and therefore carries no security weight.** The
shell being native, signed, or notarized does not help: signing proves the *artifact on disk* was
built by us, not that the *process on the socket* is that artifact.

### 4. Touch ID unlocks `biometric`, and does not unlock `passkey`

★ The substantive change, and it is deliberately partial.

macOS `LocalAuthentication` is a genuinely new capability the browser does not have. A successful
evaluation proves **someone who can satisfy this Mac's biometric or password prompt was physically
present within the last few seconds.** That is precisely what `requiredAuth: 'biometric'` means.

It is **not** what `requiredAuth: 'passkey'` means. A passkey is hardware-bound, per-credential, and
phishing-resistant; Touch ID through `LAContext` is a local presence check against the login
identity. Treating them as equivalent would flatten a three-rung ladder into two rungs and lose the
distinction Chapter 17 drew on purpose.

| Risk class | `requiredAuth` | Today | Proposed |
|---|---|---|---|
| `low`, `medium` | `none` | answerable anywhere | **unchanged** |
| `high` | `biometric` | answerable nowhere | answerable **in the verified shell, after Touch ID** |
| `critical`, `self_modification` | `passkey` | answerable nowhere | **unchanged — still nowhere** |

`critical` and `self_modification` wait for passkeys and the recovery story Chapter 17 pairs them
with, exactly as ADR-0030 sequenced it.

### 5. Touch ID counts only from a shell the core can identify

★ **§4 does not ship without this, and shipping §4 alone would be worse than shipping neither.**

A Touch ID result is trustworthy only to the process that performed it. When the shell tells core
*"I authenticated the owner at T"*, core is trusting the shell's word — and core currently cannot
tell the shell from any other local process.

So the shell must first prove it is the shell:

1. At first run, provision a **device keypair into the macOS Keychain**, in the credential domain
   established by [ADR-0050](0050-revocation-is-a-credential-domain-operation.md) and never in the
   key domain.
2. The shell signs each step-up assertion — approval id, timestamp, nonce — with that key.
3. `apps/core` verifies the signature before accepting `authenticatedAt`. An unsigned or
   unverifiable assertion is ignored exactly as today, and the Guardian returns `STEP_UP_REQUIRED`.

ADR-0030 considered a device keypair and rejected it *"built at M2 to move nothing."* That reasoning
has expired: it now moves the one thing that matters, and it is the precondition that makes Touch ID
more than a claim.

**This still does not defeat a compromised shell.** A process that has replaced or injected into
FRIDAY.app can use the key. What it defeats is *every other process on the machine*, which is the
realistic threat and the one loopback currently fails against entirely.

### 6. Which actions require explicit presence — unchanged

`high`, `critical`, and `self_modification` require presence. That set is decided by the Guardian's
risk classification in `packages/guardian/policies/`, and **this ADR does not touch it.** What
changes is only which surface can supply the proof, for one of the three.

### 7. Which actions continue through Guardian as they do today — unchanged

`low` and `medium`, with `requiredAuth: 'none'`. The shell gains nothing here and needs nothing.

### 8. Closing the window leaves the core running

The desktop application is a **client of the core, never the core**. Closing the window, quitting
the app, or the app crashing must not stop `apps/core`, which stays under launchd
(`infra/launchd/com.friday.core.plist.tmpl`, `RunAtLoad` + `KeepAlive`).

This is a constitutional requirement rather than a preference: Article III requires an approval to
survive waiting days. If quitting a window ended the process holding pending approvals, closing a
window would silently decline them.

### 9. What the shell may do that the browser may not — the complete list

After §4 and §5 ship together, exactly one thing: **supply a verifiable `authenticatedAt` for
`biometric`-class approvals.**

It does **not** get: broader Guardian authority; the ability to skip, batch, or pre-approve
anything; direct database access; filesystem or network access outside the connector boundary; or
the ability to set `authenticatedAt` for `passkey`-class requests.

### 10. The first shell milestone changes nothing about trust

★ §4 and §5 are **not** part of the first shell. The initial Tauri application loads the existing
`apps/web` build, talks to the existing core over the existing loopback API, and has **exactly the
browser's authority**. High-risk approvals remain unanswerable in it.

That keeps the shell reviewable as a shell, and keeps the trust change a separate decision with its
own diff — rather than arriving as a side effect of a window appearing.

**Sub-decision for the owner, and the one place this is genuinely arguable:** until §5 ships, what
surface should the shell report? Recommended: **`web`**, because `desktop` in the audit trail should
mean *verified desktop*, and a label the core cannot check is not evidence. The alternative — record
the claim and mark it unverified — needs a contracts change to carry the verified bit, which is more
machinery than the first milestone should need.

---

## Constitutional review

- **Article III (Approval):** the provision at stake. §4 widens what can be approved and §5 is what
  keeps that widening honest. §8 protects the "survive waiting days" property against a window
  close. Nothing here makes an approval easier to give *accidentally*.
- **Article II (Transparency):** the response surface and the authentication basis are recorded, so
  the audit trail distinguishes a browser answer from a verified-shell answer. §10's sub-decision is
  about keeping that distinction truthful.
- **Article V (Security — least privilege):** §9 is an exhaustive list rather than a principle,
  because "the desktop app is more trusted" is the kind of sentence that grows.
- **ADR-0005 (Guardian sole authorization):** unchanged and load-bearing. The shell supplies
  *evidence*; the Guardian still decides. The shell never authorises anything, and a shell that
  lied would be refused by `checkSurfaceAndAuth` the same as any other caller.

**The five questions:**

- [x] **Can the user see it?** Every approval remains visible on every surface; the answer records
      where it came from and what proved it.
- [x] **Can the user stop it?** Yes, and the highest two classes still cannot be *started* from any
      surface, which is the stronger guarantee.
- [x] **Can we replace it?** The verification is one function in `apps/core`. Passkeys later
      substitute for it without touching the router or the Guardian.
- [x] **Can we explain it?** *"She asked for your fingerprint because this one needed you to be
      here, and she checked it was really the FRIDAY app asking."*
- [ ] **Will this still be right in five years?** **Partly.** "A native shell is not evidence of a
      human" should still be right. "Touch ID is not a passkey" is true of today's macOS APIs and
      should be re-examined when platform attestation improves.

**Notes:** This ADR raises the authority of one surface by one rung and adds a precondition that did
not previously exist. It does not lower any bar.

---

## Alternatives considered

### A. Inherit the browser restriction unchanged

**What it is.** The shell is a window. No approval capability changes, ever.

**Advantages.** Zero new attack surface. No keypair, no `LAContext`, no verification code. ADR-0030
stands untouched.

**Why rejected — narrowly.** It leaves `high`-risk approvals answerable on no surface at all, which
means in practice they are answered by the owner editing policy or by the action not happening.
Chapter 17 designed a three-rung ladder; refusing to build the middle rung indefinitely is its own
decision and a worse one. **This is the honest fallback if the owner rejects §5's cost**, and it is
better than §4 without §5.

### B. Treat the native shell as trusted because it is signed and notarized

**What it is.** Accept `authenticatedAt` from anything claiming `via: 'desktop'`, on the grounds
that the shipped app is signed.

**Advantages.** No keypair. Trivial to build.

**Why rejected.** Code signing proves provenance of a *file*, not identity of a *socket peer*. Core
sees a TCP connection, not a bundle. This is ADR-0030's rejected alternative wearing a native
costume, and it would make `STEP_UP_REQUIRED` unreachable for `high` while leaving the code that
appears to check it.

### C. Touch ID unlocks everything including `critical` and `self_modification`

**What it is.** One presence check satisfies all three rungs.

**Advantages.** Simplest mental model. Every approval answerable in one place.

**Why rejected.** It collapses a distinction Chapter 17 drew deliberately, and it would let
`self_modification` — changes to FRIDAY's own code — be approved by a fingerprint on an unlocked
laptop. It also arrives before the passkey recovery story, which is the ordering ADR-0030 warned
against: *"shipping the lock before the key-recovery is how the owner gets locked out."*

### D. WebAuthn passkeys in the shell now, skipping Touch ID entirely

**What it is.** Go straight to the ratified mechanism for all three rungs.

**Advantages.** Correct long-term answer. Would unlock `critical` too.

**Why rejected for now.** Chapter 17 pairs passkeys with two registered devices, recovery codes, and
a printed recovery card. The recovery card is generated at M7 and does not exist. **Recorded as the
expected successor**, exactly as ADR-0030 recorded it, and this ADR is explicitly the intermediate
rung rather than a replacement for it.

### E. Have the shell spawn and own the core

**What it is.** No launchd. FRIDAY runs when the app runs.

**Advantages.** One lifecycle. No "core unavailable" state to design. Nothing to supervise.

**Why rejected.** It breaks Article III's "survive waiting days" — quitting the app would end
pending approvals and any running plan. It also makes the core's availability depend on a UI
process, which inverts the dependency the whole architecture is built on.

---

## Consequences

**Positive**

- `high`-risk approvals become answerable on exactly one surface, by a mechanism that means what it
  says.
- `critical` and `self_modification` stay unanswerable, so the ladder survives.
- Core gains its first way to distinguish one local client from another, which is reusable for
  anything else that later needs it.
- The first shell milestone ships with no trust change at all, so it can be reviewed as a shell.

**Negative**

- **A device keypair is real machinery with a real failure mode.** If the Keychain item is lost or
  the shell is reinstalled, step-up stops working until it is re-provisioned. That is a lockout of
  the middle rung, and it needs a documented recovery path before §5 ships.
- **A compromised FRIDAY.app can use the key.** §5 defeats other processes, not a subverted shell.
  Stated plainly because the mitigation is code signing and notarization, which are later
  milestones, and the gap exists in between.
- **Two surfaces still differ in capability**, and now differ in a more complicated way: the browser
  answers two rungs, the verified shell three-minus-one. That has to be explained in the interface.
- More code on the path that grants approvals, which is the path where bugs are most expensive.

**Neutral**

- `desktop` already exists in `RESPONSE_SURFACES`; nothing in contracts needs adding for §4.
- Chapter 17's surface table still has no row for a browser on the host Mac. This ADR does not add
  one either; it records that the gap persists.

---

## Reversibility

- **Cost to reverse:** low for §4 — remove the verification and core stops accepting
  `authenticatedAt`, returning to today's behaviour exactly. Medium for §5, because a provisioned
  keypair exists on machines and would need removing.
- **How:** verification is one function in `apps/core`; the Guardian and the router are untouched.
- **Point of no return:** any `high`-risk approval actually granted under this. A recorded approval
  cannot be un-recorded — which is why `critical` is excluded rather than trusted.

---

## Review triggers

- **Passkey recovery exists (M7)** — alternative D becomes buildable, and `critical` in the shell
  becomes a real question.
- **Code signing and notarization ship** — the "compromised shell" gap narrows and should be
  re-assessed, not assumed closed.
- **Any proposal to accept `authenticatedAt` without signature verification.** That is §5 being
  reversed and must be argued as such.
- **A second surface asks for step-up** (iPhone, remote web) — §9's list is per-surface and does not
  generalise.
- **`apps/core` binds to anything other than loopback** — inherited from ADR-0030 and still fatal to
  the basis of all of this.

---

## Notes

**What this ADR refuses to do.** It does not grant the desktop shell authority because it is
native, signed, or ours. Every rung it moves is moved by a mechanism that produces evidence the core
can check. If §5 is judged too expensive, the correct outcome is alternative A — inherit the
restriction — and **not** §4 on its own.

**Sequencing, so this does not block the shell.** §10 is the operative instruction for the current
milestone: build the window, change nothing about trust. §4 and §5 are a later change with their own
diff, their own tests, and their own review.

**Open for the owner:** the §10 sub-decision on what surface an unverified shell reports.
