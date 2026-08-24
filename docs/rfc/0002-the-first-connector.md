# RFC-0002 — The first connector

- **Status:** **closed — resolved 2026-08-24 by [ADR-0048](../adr/0048-the-first-connector-is-weather.md)**
- **Date:** 2026-08-24
- **Author:** FRIDAY Engineering (AI contributor)
- **Asking for:** a product decision, not a review of code
- **Related:** [Chapter 14](../01-bible/14-connector-framework.md) · [Chapter 19](../01-bible/19-approval-system.md) · [ADR-0047](../adr/0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md) · [Roadmap M6](../01-bible/39-roadmap.md)

---

## Resolution

**Closed 2026-08-24.** The owner chose **weather**, not calendar, and accepted the §1 argument
against this document's own recommendation: calendar is a much more consequential privacy surface
than it first appears, and read-only does not make the data low-risk.

Recorded in [ADR-0048](../adr/0048-the-first-connector-is-weather.md).

**Calendar is deferred, not rejected** — everything below about its manifest, scopes, credential
lifecycle, approval points, and success semantics stays accurate and is the starting point whenever
calendar is revisited. That is why this document is kept rather than deleted.

[ADR-0047](../adr/0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md) was accepted
in the same decision, with the condition that wildcard egress is never added for shared
multi-tenant namespaces.

**Two things this document did not settle and that weather still needs:** which provider, and how
precisely the owner's location is disclosed. Both come back as their own package.

---

## What this is, and what it is not

The connector SDK is built: the manifest, the egress boundary, the lifecycle, rate limiting, retry,
the circuit breaker, the conformance suite, and the credential-broker boundary. **All of it against
a service that does not exist.**

This document is the decision that has been deliberately deferred through all of it: **which real
service FRIDAY connects to first, and on exactly what terms.**

Google Calendar is the roadmap's recommendation. It is not approved, and nothing in the repository
assumes it. **No credentials have been obtained, nothing has been enrolled, and no request has been
made to any provider.**

**What I am asking for is a yes, a no, or a different service** — plus, if yes, agreement on the
terms below, because they are the connector's actual contract with you.

---

## 1 · Recommendation

**Google Calendar, read-only, as a first release.** Write operations become a **second, separate
decision** once the read path has been in daily use.

**Why calendar.** The data is structurally simple and the value is immediate and daily — *"what does
my week look like?"* is the milestone's own done-when. It exercises OAuth, the credential broker,
rate limiting, and the egress allowlist **without risking anything irreversible.**

**Why read-only first, and why I would hold that line harder than the roadmap does.** A read-only
connector cannot produce a wrong outcome in the world. If the plumbing is subtly wrong — a scope too
wide, a retry that should not have happened, a preview that does not match — the cost is a bad
answer, not a deleted meeting. Every one of those mistakes is one I would rather find on the read
path.

**Why it is a good fit for [ADR-0047](../adr/0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md).**
Calendar moves JSON. It needs four exact hosts and never a CDN, so **it does not depend on the
wildcard question being settled.**

### The honest case against

Calendar data is **not low-sensitivity**. Your calendar reveals who you meet, when you are away from
home, your medical appointments, and who you are interviewing with. "Read-only" bounds what FRIDAY
can *change*, not what she can *see* — and this connector sends event data to a model whenever it
answers a question about your week. If a first connector should be *boring* rather than merely
*reversible*, weather or public transit would be a better exercise of the same machinery. They are
also much less useful, which is why I still recommend calendar — but the trade is real and yours.

---

## 2 · Proposed manifest

```json
{
  "id": "google-calendar",
  "service": "Google Calendar",
  "version": "1.0.0",

  "auth": {
    "type": "oauth2",
    "scopes": ["https://www.googleapis.com/auth/calendar.readonly"],
    "scopeJustification": {
      "https://www.googleapis.com/auth/calendar.readonly":
        "Read your events so FRIDAY can answer questions about your week and spot conflicts. Read-only: this scope cannot create, change, or delete anything."
    }
  },

  "egress": {
    "hosts": [
      "calendar.googleapis.com",
      "oauth2.googleapis.com",
      "accounts.google.com",
      "www.googleapis.com"
    ],
    "dataCategories": ["calendar_events", "contact_emails"],
    "transmitsPersonalData": true,
    "dataRetentionByProvider": "Per Google's terms; not controlled by FRIDAY"
  },

  "operations": [
    {
      "id": "list-events",
      "description": "List your events in a date range",
      "riskClass": "low",
      "idempotent": true,
      "irreversible": false,
      "reads": ["calendar_events", "contact_emails"],
      "writes": [],
      "timeoutMs": 15000
    },
    {
      "id": "get-event",
      "description": "Read one event in full",
      "riskClass": "low",
      "idempotent": true,
      "irreversible": false,
      "reads": ["calendar_events", "contact_emails"],
      "writes": [],
      "timeoutMs": 15000
    },
    {
      "id": "list-calendars",
      "description": "List which calendars you have",
      "riskClass": "low",
      "idempotent": true,
      "irreversible": false,
      "reads": ["calendar_metadata"],
      "writes": [],
      "timeoutMs": 15000
    }
  ],

  "rateLimits": { "requestsPerMinute": 60, "burstSize": 10 },
  "healthCheck": { "operation": "list-calendars", "intervalSeconds": 300 },
  "supportsDryRun": false
}
```

`supportsDryRun` is `false` **only because nothing here writes.** The manifest schema already
refuses a connector that declares a write operation without dry-run support, so this cannot be
carried forward silently into the write release.

---

## 3 · Permissions, and why each one

**One scope.** `calendar.readonly`.

| Scope | Why | What it cannot do |
|---|---|---|
| `calendar.readonly` | Read events to answer questions about your week and detect conflicts | Create, modify, or delete anything; touch any other Google service |

**Scopes deliberately *not* requested:**

- `calendar` — full read/write. Not needed for reading, and it is the scope most integrations ask
  for out of convenience. That convenience is the exact failure Chapter 14's `scopeJustification`
  exists to prevent.
- `calendar.events` — write access to events. Belongs to the write decision, not this one.
- `calendar.settings.readonly`, `calendar.acls` — not needed.
- Anything outside Calendar. One connector per **service**, not per provider: separate scopes,
  separate risk, separate revocation. A "Google" connector would force Calendar, Gmail, and Drive
  into a single grant.

---

## 4 · What actually leaves the machine

Declared as `calendar_events` and `contact_emails`. In plain terms, **outbound** requests carry:

- your OAuth access token
- the calendar id and a date range
- nothing else — no query text, no memory contents, no other events

**Inbound**, Google returns event titles, times, locations, descriptions, and **attendee email
addresses**. That last one is why `contact_emails` is declared separately: your calendar contains
other people's identities, and Article IV's minimum-disclosure applies to them too, not only to you.

**★ The point worth deciding on:** answering *"what does my week look like?"* means event data
reaches a model. If that model is not local, **your calendar contents leave your machine a second
time, to a second party.** Which model tier handles calendar data is a `sensitivity` decision on the
department, not on this connector — but it is the real privacy question behind this proposal, and it
would be dishonest to present the connector as though the egress list were the whole story.

---

## 5 · Operations, and which ones are dangerous

All three are `low` risk, idempotent, reversible, and read-only. **Nothing in this proposal can
change anything in the world.**

For the eventual write decision, so the shape is visible now:

| Operation | Risk | Idempotent | Irreversible | Why |
|---|---|---|---|---|
| `create-event` | medium | no | no | Others are notified immediately; deleting later does not unsend that |
| `update-event` | medium | no | no | Same, plus it overwrites something |
| `delete-event` | **high** | yes | **yes** | Cannot be undone. The manifest schema already forces `high` or above for anything irreversible |

**The reason `create-event` is not "low" even though it is reversible:** creating an event sends
invitations. The e-mail has left before you could change your mind. Reversibility of the *record* is
not reversibility of the *effect*, and the risk class should follow the effect.

---

## 6 · Credential lifecycle

1. **One-time grant.** You authorise FRIDAY in a browser, once. **You do this — I never touch it.**
2. **Refresh token → Keychain.** Held by the Credential Broker in the kernel. **Never in the
   database**, so a stolen backup is not a breach of your Google account. Never seen by the
   connector.
3. **Per-operation exchange.** The connector asks the broker for a token scoped to
   `calendar.readonly`, valid ~15 minutes, held in memory only.
4. **Scope minimisation at issuance.** Already built and tested: the broker refuses a scope the
   manifest does not declare, refuses a request naming no scope, and refuses one connector asking
   for another's credential.
5. **Expiry.** The token dies on its own. A compromised connector leaks minutes, not forever.

**Not built, and required before this ships:** the broker itself, the Keychain integration, and the
OAuth exchange. Only the boundary exists today.

---

## 7 · Where the Guardian stands

**For the read-only release, the honest answer is: at the standing grant, and nowhere else per
call.** Reading your calendar every time you ask about your week cannot ask permission each time —
that is the "forty thin requests a day" failure Chapter 19 warns about, which trains you to tap
approve without reading.

So:

- **Connecting the account at all** is the approval that matters, and it is a one-time, explicit,
  human act.
- **Each operation is still authorised** — the Guardian classifies `connector.google-calendar.read`
  against your policy, and a standing grant covers it. It is authorisation without a prompt, not the
  absence of authorisation.
- **Every use is recorded**, so "when did FRIDAY read my calendar?" is answerable.

**For writes, this changes completely**, and that is a large part of why I am proposing to split
them: `create-event` and `update-event` would require per-action approval with a dry-run preview of
the exact event, and `delete-event` — irreversible — is exactly the tier Chapter 14 says a standing
grant must never cover alone.

---

## 8 · Rate limits, retries, and timeouts

Google's published limits are **600 requests/minute per user** and 10,000/minute per project, on a
sliding window.

**Proposed: 60/minute, burst 10 — a tenth of what is allowed.** FRIDAY is one person's assistant and
has no legitimate reason to approach a provider's ceiling. A connector that needs 600 requests a
minute to answer *"what does my week look like?"* is malfunctioning, and the limiter should be the
thing that notices.

- **Timeout: 15s** per operation, tighter than the 30s default. A calendar list that takes longer
  has failed in some way that matters more than the answer.
- **Retries:** every operation is idempotent, so retrying is safe. Three attempts, exponential
  backoff with full jitter.
- **Circuit breaker:** five consecutive failures, sixty seconds.
- **Owed before this ships:** the SDK currently ignores a provider's `Retry-After` header. Google
  sends one. **Our arithmetic should yield to an explicit instruction from the provider**, and that
  gap should close before a real connector exists.

---

## 9 · Side effects, ambiguity, and what "success" is allowed to mean

**Read-only means every operation is side-effect free**, which is most of why this is a safe first
connector. It matters anyway for the write decision:

- **A timeout is not a failure to act.** For a write, the request may have landed and the response
  been lost. The event may exist. **The only honest report is "I do not know", never "it failed".**
- **Google supports client-generated event ids**, which gives real idempotency for `create-event` —
  a retry with the same id collapses. That is what would make retrying a write safe, and it is the
  mechanism the SDK's idempotency-key rule already expects.
- **A 4xx is an answer, not a fault.** `403 rateLimitExceeded` is throttling; `404` means gone.
  These are outcomes to report, not errors to hide.

**What the connector may claim as success:** only that **the provider returned a successful
response for the request it made.** Never that the calendar is now in a particular state, never that
a person saw anything, and never that a read returned *everything* — a paginated result that
stopped early is a partial answer and must say so. **A connector that reports success for work that
did not happen is the worst failure available to it**, worse than crashing, because it corrupts the
audit trail with something that reads like fact.

---

## 10 · Revocation

Three independent levels, and you should have all three:

1. **FRIDAY-side, instant.** Revoke in the broker; every connector loses access at once.
2. **Provider-side.** Remove FRIDAY at `myaccount.google.com` → third-party access. **This works
   even if FRIDAY is compromised or will not start**, which is the property that makes it matter.
3. **Uninstall.** Removing FRIDAY must remove the Keychain entry. Worth stating because a
   half-uninstall that leaves a live refresh token behind is a real hazard.

**Revocation must be visible.** A connector that starts failing with `CREDENTIAL_REVOKED` should
say *"you disconnected this account"* rather than presenting as an outage.

---

## 11 · Audit and events

Nothing here can happen invisibly. Required before this ships:

| Event | When | Carries |
|---|---|---|
| `credential.issued` | broker issues a token | connector, operation, scopes, correlation — **never the token** |
| `credential.revoked` | any revocation | connector, who asked |
| `connector.called` | each operation | connector, operation, outcome, duration, correlation |
| `security.egress.blocked` | undeclared host | connector, host, reason |
| `connector.degraded` | circuit opens | connector, consecutive failures |

**★ The known gap.** The SDK *reports* blocked egress and refusals to its caller, but **nothing is
wired to the event log yet.** Chapter 14 requires `security.egress.blocked` to raise a diagnostic. I
have flagged this on every slice since PR #76, and it must close before a real connector ships — a
connector whose refusals are invisible is a connector you cannot supervise.

---

## 12 · What FRIDAY must never expose to the connector

The connector receives **only** a guarded fetch, a clock, and the inputs of the step it is running.
Explicitly never:

- **Long-lived credentials.** Short-lived scoped tokens only, in memory.
- **Any other connector's credentials**, or its own for another scope.
- **The event log or the audit chain.** A connector must not read the record of what FRIDAY did.
- **Guardian policies.** A component that could read the rules could reason about how to satisfy
  them.
- **Memory contents**, beyond the specific inputs of its step.
- **The plan.** It gets the step's input, not the reasoning, the intent, or the other steps.
- **The owner's identity beyond what the operation needs.** A calendar id, not a life.
- **Anything from another department.**

The dependency rule already enforces most of this structurally: connectors may import only
`@friday/connector-sdk` and `@friday/contracts`, so there is no path to the guardian, the storage
layer, or the kernel. **That is the boundary doing the work rather than a promise.**

---

## 13 · What I need from you

1. **Google Calendar, yes or no** — or name a different service.
2. **Read-only first, with writes as a separate decision later?** I recommend yes.
3. **Is the single `calendar.readonly` scope the right ask?**
4. **Are you comfortable that answering questions about your week sends calendar contents to a
   model** — and if so, does that force a local model for this data?
5. **Apple Developer Program** — still unapproved, still unpurchased, and not needed for this.

**Blocking work before any real connector ships**, regardless of which service you pick:

- The Credential Broker itself: Keychain, OAuth exchange, revocation.
- Event-log wiring for the five events in §11.
- `Retry-After` handling.
- The OAuth consent flow, which is yours to perform.

**I will not begin any of it against a real provider until you decide.**

---

## Notes

**What I am uncertain about.** Whether calendar is genuinely the right *first* choice given how
revealing calendar data is (§1). Whether 60/minute is too tight for a heavy calendar week — it is
easy to raise and I would rather start low. And whether per-call authorisation for reads is really
as unworkable as I have argued in §7; I believe it is, but it is the argument here that most
deserves your challenge.

Sources: Google Calendar API usage limits and OAuth 2.0 scope documentation.
