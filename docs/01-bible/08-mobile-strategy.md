# 08 — Mobile Strategy

> **Governing provisions:** Constitution Article III (Approval), Article IV (Privacy), Article IX
> (Respect); Manifesto Principle 1 (The User Is Always In Command), Principle 2 (Transparency),
> The User Experience.

---

## In plain language

The phone is not a smaller dashboard. It has one job that matters more than everything else
combined:

> **FRIDAY needs your approval, and you are not at your desk.**

Your Constitution's Article III says consequential actions require your explicit approval. That
creates an obvious practical problem: if approvals can only be granted at your Mac, then FRIDAY
stops being useful the moment you leave the house. Either she waits hours for you to return, or the
approval requirement quietly erodes into "approve everything in advance," which defeats its
purpose.

**The phone exists to make strict approval practical.** Everything else it does is secondary.

That framing produces a very different app than "the dashboard, but small." The phone app is
optimized for a specific moment: a notification arrives while you are walking; you have fifteen
seconds and one thumb; you need enough context to decide well and no more. Get that right and the
whole approval model works. Get it wrong and you will start rubber-stamping, which is worse than
having no approval system at all — because it *looks* like oversight while providing none.

---

## Recommendation

**Tauri 2 mobile**, loading the same React application from `apps/web` in a mobile-adaptive layout,
with native push notifications and biometric authentication.

**Primary fallback: Capacitor.** If Tauri mobile proves inadequate, Capacitor wraps the identical
React app with zero Rust and a much more mature mobile plugin ecosystem. The switch costs days, not
weeks, because the React app is unchanged.

**Secondary fallback: React Native.** Only if a webview-based approach proves fundamentally
unsuitable. This one is expensive — screens must be rewritten — so it is a last resort.

### Validation before commitment

Milestone 7 begins with a **two-week spike**, timeboxed, that builds one screen — the approval
screen — on real Tauri mobile, on a real iPhone, and answers four questions:

1. Do push notifications work reliably through APNs, including when the app is closed?
2. Does Face ID authentication work through Tauri's plugin?
3. Is the approval screen responsive enough to feel native (see Chapter 35)?
4. Does the build and signing pipeline work without excessive pain?

**If any answer is no, we switch to Capacitor immediately** and lose two weeks rather than two
months. This is written into the roadmap as a formal go/no-go gate. Betting a milestone on a
young technology without a checkpoint would be exactly the kind of decision Principle 6 warns
against.

---

## What the phone app does

Deliberately narrow. Scope creep on mobile is how the approval experience gets diluted.

### Tier 1 — the reason it exists

| Capability | Why |
|---|---|
| **Receive approval requests** as push notifications | Article III is impractical without this |
| **Approve or decline**, with full explanation visible | Principle 7 — informed consent, not a reflex tap |
| **Biometric confirmation** for high-risk approvals | A stolen unlocked phone must not be able to move money |
| **See what FRIDAY is doing right now** | Article II, at a glance |

### Tier 2 — genuinely useful

| Capability | Why |
|---|---|
| Ask FRIDAY something (text or voice) | The most common non-approval use |
| Review recent activity and explanations | Article II away from the desk |
| System health at a glance | Confidence |
| Manage quiet hours and notification settings | Article IX — respect for attention |

### Tier 3 — explicitly not on the phone

| Excluded | Why |
|---|---|
| Full audit log exploration | Needs screen space; use the Mac |
| Memory browsing and editing | Consequential and detailed; deserves a large screen |
| Department and connector configuration | Rare, complex, and high-stakes |
| Approving changes to FRIDAY's own code | **Never on mobile.** Reviewing a code change on a phone is not real review, and pretending otherwise would undermine the entire self-modification safety model. |

That last exclusion is a security control, not a scoping decision. It is enforced by the Guardian:
approvals in the `self_modification` risk class are rejected outright when the request originates
from a mobile client.

---

## The approval screen

This is the most important screen in the entire product, so it is specified here rather than left
to design later.

```
┌─────────────────────────────────┐
│  ⚠️  Approval needed             │
│                                  │
│  Send email to Sarah Chen        │  ← what, in plain language
│  about "Q3 budget review"        │
│                                  │
│  Because you asked me to         │  ← why, traced from the plan
│  follow up on yesterday's        │
│  meeting notes.                  │
│                                  │
│  Risk: Medium                    │  ← the Guardian's classification
│  • Sends data outside your Mac   │  ← what it actually costs you
│  • Cannot be undone once sent    │
│                                  │
│  ▸ Read the full message         │  ← progressive disclosure
│  ▸ How I decided this            │  ← the causal chain
│                                  │
│  ┌───────────┐  ┌─────────────┐  │
│  │  Decline  │  │   Approve   │  │
│  └───────────┘  └─────────────┘  │
│         Ask me later             │
└─────────────────────────────────┘
```

Five rules govern this screen, and they are not negotiable:

1. **What, why, and risk are visible without scrolling.** If a decision requires scrolling to
   understand, the summary failed.
2. **Approve is never the default action** and is never triggered by a notification swipe. A
   deliberate tap, always.
3. **Irreversibility is stated explicitly.** "Cannot be undone" is the single most decision-relevant
   fact and it is never buried.
4. **"Ask me later" is always available.** Article IX — you are allowed to not decide right now.
   The plan suspends and waits.
5. **High-risk approvals require biometrics.** The device being unlocked is not sufficient
   authorization for moving money.

---

## Push notifications

### The privacy problem, and how it is solved

Push notifications on iOS must pass through Apple's servers. There is no alternative — it is how
the platform works. That is in direct tension with Article IV.

**The resolution: the push notification carries no content.** It is a silent signal that says "you
have something waiting," containing no description of what. The app wakes, connects directly to
FRIDAY on your network or through your relay, fetches the actual approval over an encrypted
channel, and renders it locally.

Apple learns that FRIDAY pinged you. Apple does not learn that FRIDAY wants to email Sarah about
the budget. This is the correct architecture, it costs a round trip, and the round trip is worth it.

### Reaching your Mac from outside the house

Your FRIDAY core runs on your Mac at home. Your phone is on cellular. They need to talk. Three
options, in order of preference:

| Approach | Privacy | Complexity | Recommendation |
|---|---|---|---|
| **Tailscale** (private mesh VPN) | Excellent — end-to-end encrypted, no traffic through third parties | Low — install and sign in | **Recommended.** Free for personal use. |
| **Self-hosted relay** on a cheap VPS | Good — you control it, but it is a hop | Medium — a server to maintain | Fallback if Tailscale is unsuitable |
| **Exposing your Mac to the internet** | Poor | Medium | **Rejected.** Do not open a port on your home network to the machine holding your entire digital life. |

Tailscale is the recommendation and is a Milestone 7 dependency. It is worth noting it is a third
party in the connection path, which Article VI notes — but it carries encrypted traffic it cannot
read, and it is replaceable with self-hosted alternatives (Headscale) if that ever matters.

---

## Alternatives considered

### Capacitor

**Advantages:** far more mature mobile ecosystem than Tauri, larger plugin library, zero Rust,
excellent documentation, battle-tested by thousands of shipped apps.

**Why it is the fallback rather than the choice:** it means a second shell technology alongside
Tauri on desktop — two build systems, two plugin models, two sets of platform quirks. If Tauri
mobile works, one shell technology for all four platforms is meaningfully simpler.

**But I want to be clear this is close.** Capacitor is the safer choice today, and if the M7 spike
shows any friction at all, we take it without hesitation. There is no pride investment in Tauri
here.

### React Native

**Advantages:** genuinely native components, best-in-class mobile performance and feel, huge
ecosystem, excellent push notification and biometric support.

**Rejected as the primary path** because it requires rewriting every screen — React Native
components are not web components. That is a second UI codebase, which reintroduces the drift
problem that makes approval screens dangerous.

Reconsidered only if webview-based approaches fail outright, or if the mobile experience becomes a
much larger part of FRIDAY's value than currently anticipated.

### Native Swift (iOS) and Kotlin (Android)

**Advantages:** the best possible mobile experience, full platform capability, best notification
handling.

**Rejected** for the same reasons as native desktop: two more languages, two more codebases, and a
violation of your explicit constraint. For an approval-focused app, the marginal experience gain
does not justify tripling the work.

### Mobile web only (no app at all)

**Advantages:** zero additional work — the dashboard already works in a phone browser.

**Rejected** because iOS Safari's push notification support for web apps is unreliable and requires
the user to have explicitly added the site to their home screen. Given that the entire purpose of
the phone surface is receiving approval requests promptly, unreliable notifications defeat it
entirely. There is also no Face ID access.

**Retained as an interim measure.** Before M7, the responsive web dashboard is genuinely usable
from a phone browser. It just cannot notify you.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Tauri mobile is young.** Real risk of hitting a wall. | Mitigated by the timeboxed go/no-go spike and a ready fallback. This is the main risk in this chapter and it is actively managed. |
| **A webview app will not feel fully native.** | Accepted. For an approval-focused app, clarity matters more than platform polish. |
| **Apple Developer Program, $99/year, plus App Store review** — or TestFlight/sideloading. | Accepted. For a personal app, TestFlight avoids App Store review entirely; the certificate must be renewed annually. |
| **Android is deferred** to M8+. | Accepted. You use an iPhone. Building Android before anyone needs it is unpaid maintenance. |
| **The phone requires connectivity to FRIDAY.** No offline approval queue initially. | Accepted for M7. Approvals genuinely require current context; approving a stale request is worse than waiting. Revisit at M8. |
| **Tailscale is a third party in the connection path.** | Accepted — it carries encrypted traffic it cannot read, and self-hosted replacements exist. |

---

## Review triggers

- **The M7 spike fails any of its four questions** → switch to Capacitor immediately
- Push notification delivery proves unreliable in practice → investigate; this is existential for
  the mobile surface
- The mobile app becomes the primary interface rather than the approval surface → reconsider React
  Native, since the value calculation has changed
- Android becomes needed (a family member on Android, per your multi-user goal)
- Tauri mobile stalls in development or loses maintainer attention

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
