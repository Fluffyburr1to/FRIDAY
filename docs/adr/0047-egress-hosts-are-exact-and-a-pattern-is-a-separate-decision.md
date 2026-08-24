# ADR-0047 — Egress hosts are exact, and a pattern is a separate decision

- **Status:** proposed
- **Date:** 2026-08-24
- **Deciders:** Tyler Hutson
- **Supersedes:** none
- **Related:** [Chapter 14](../01-bible/14-connector-framework.md) · [Chapter 18](../01-bible/18-security-model.md) · PR #75 · PR #76

---

## Context

[PR #75](https://github.com/Fluffyburr1to/FRIDAY/pull/75) made `egress.hosts` accept only bare,
lowercase hostnames. `*.example.com` is refused, and so is `*`. [Chapter 14](../01-bible/14-connector-framework.md)
does not say that in as many words. It was inferred from the chapter's own review trigger, which
anticipates providers adding CDN domains and calls the fix *"a one-line manifest change with a
visible audit record"* — a sentence that only makes sense if hosts are exact.

**That inference was made while implementing, and it should not become a permanent FRIDAY rule by
having gone unchallenged.** This ADR exists to make it a decision.

### What the allowlist is actually defending against

Chapter 14 calls it *"one of the highest-value controls in the entire security model, and it costs
almost nothing."* It defends three specific things:

1. **A compromised dependency.** A transitive package that starts phoning home. It has FRIDAY's
   full privileges and will not ask permission first.
2. **A manipulated agent.** Prompt injection that persuades a model to send data somewhere. The
   model can be convinced; the allowlist cannot.
3. **Ordinary mistakes.** A copied code sample pointing at the wrong environment.

It also does something quieter and just as important: it makes `dataCategories` **truthful**. The
privacy dashboard's answer to *"what left my machine this week?"* is only itemisable because every
outbound call has a known destination.

### What was not known when the rule was written

Whether real providers can actually be described with exact hosts. That is the empirical question
this ADR answers, and it turns out to have a clean split.

---

## Findings

### Exact hosts are sufficient for API and OAuth surfaces

For the API and authorisation surface — the traffic a connector makes to *do its job* — providers
publish small, stable, documented host sets. Google Calendar, the leading candidate for the first
connector, needs `calendar.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`, and
`www.googleapis.com`. Four exact hosts. Microsoft Graph, GitHub, Slack, and Dropbox are the same
shape: a handful of fixed names.

**This is the important finding, because it means the wildcard question does not block the first
connector.** A calendar connector moves JSON. It never needs a dynamic host.

### Dynamic hosts cluster around bulk content, and that is the worst place for a wildcard

Where providers *do* use dynamic hostnames, it is almost always for content transfer that has been
redirected away from the API host:

| Provider | Dynamic surface | Used for |
|---|---|---|
| Google Drive | `*.googleusercontent.com` | file downloads |
| Microsoft 365 | `<tenant>.sharepoint.com`, `*.blob.core.windows.net` | file and attachment transfer |
| GitHub | `objects.githubusercontent.com` and S3 hosts | release assets |
| Slack | `files.slack.com`, `*.slack-edge.com` | uploaded files |

Two things follow, and they point the same way.

**First: these are exactly the highest-volume, highest-sensitivity flows.** File contents, not
metadata. Widening the allowlist is least affordable precisely where providers make it most
tempting.

**Second — and this is the argument I find decisive — several of these suffixes are shared
multi-tenant namespaces.** Google's own guidance notes that a hostname under `googleusercontent.com`
may represent user-generated or customer-associated content rather than a core Google service, and
that subdomains there are created, retired, and repurposed continuously. `*.blob.core.windows.net`
covers every Azure storage account in the world, belonging to anyone.

So `*.googleusercontent.com` does not read as *"Google, plus some CDN nodes"*. It reads as
**"any content host in a namespace that strangers can obtain a name in."** That is not a narrowed
allowlist. For an exfiltration destination it is close to an open one, and it would be recorded in
the manifest as though it were a privacy commitment.

### Redirects already force the question into the open

The guard from [PR #76](https://github.com/Fluffyburr1to/FRIDAY/pull/76) refuses to follow
redirects. A connector that downloads content must therefore re-enter the guard with the new
location — so **the redirect target must itself be declared.** This is friction, and it is friction
in the right place: the dynamic host becomes visible at the boundary instead of being followed
silently.

### DNS and TLS are a separate trust question, and the answer is adequate but not free

An allowlist matches hostnames, and hostnames are resolved by DNS, which FRIDAY does not control.
Three observations:

- **A hijacked DNS answer does not by itself defeat the allowlist**, because Chapter 18 requires
  TLS with certificate validation. A wrong IP cannot present a valid certificate for the declared
  name. The hostname allowlist plus certificate validation is sound against ordinary DNS tampering.
- **A mis-issued or compromised CA certificate does defeat it.** There is no certificate pinning,
  and I am not proposing any: pinning against providers who rotate certificates freely is an
  outage generator, and the failure it prevents is rarer than the outages it causes.
- **The allowlist controls *where*, never *what*.** A connector permitted to reach a legitimate
  host can still send the wrong data to it — posting a private note into a document the owner
  genuinely owns is not an egress violation. `dataCategories`, the Guardian, and dry-run previews
  are the controls for that. It is worth writing down that this control was never the one doing
  that job.

---

## Decision

We will **keep `egress.hosts` exact** — no wildcards, no patterns, no suffix matching — and treat
support for constrained patterns as a **separate decision, made only when a connector FRIDAY
actually wants presents a case that exact hosts cannot express.**

Until then the conservative behaviour stands, and **it is not weakened to accommodate a provider.**

---

## Constitutional review

- **Article IV (Privacy — minimum necessary disclosure):** directly served. An exact list is what
  makes "what left my machine" itemisable rather than approximate.
- **Article V (Security — least privilege):** directly served. The narrowest expressible
  destination set.
- **Article VII (Reliability — failures should be predictable):** in tension, and honestly so. A
  provider that adds an undocumented host produces a blocked call. That is a real outage caused by
  this decision. It is accepted because the failure is *loud, named, and one line to fix* rather
  than silent.

**The five questions:**

- [x] **Can the user see it?** A block names the host and the reason, and is designed to raise a
      diagnostic once the event wiring exists.
- [x] **Can the user stop it?** Not applicable — this is a refusal, not an action.
- [x] **Can we replace it?** Yes. Loosening later is additive and cheap; tightening later is not.
- [x] **Can we explain it?** *"The connector tried to reach a place it never told you about."*
- [x] **Will this still be right in five years?** The reasoning will. The specific provider host
      sets will drift, which is what the review triggers are for.

**Notes:** The tension with Article VII is the whole cost of this decision, and it is real. I would
rather it be stated here than discovered by someone debugging a blocked download at midnight.

---

## Alternatives considered

### A. Allow full wildcards (`*.example.com`)

**What it is.** Suffix matching, as most firewall allowlists do it.

**Advantages.** Solves the CDN problem outright. Matches what operators expect. Nobody is woken up
by a provider adding a node.

**Why rejected.** On shared multi-tenant suffixes it grants reach to namespaces that strangers can
obtain names in — `*.googleusercontent.com` and `*.blob.core.windows.net` are the concrete cases.
It also makes `dataCategories` unverifiable in principle: the dashboard could no longer say where
data went, only which pattern it matched. That converts an audit answer into an estimate.

### B. Constrained patterns — one leading label, minimum suffix depth, per-pattern justification

**What it is.** Permit `*.googleusercontent.com` but not `*.com`: exactly one wildcard label, a
suffix of at least two labels, written in a separate manifest field with a written justification
per pattern, mirroring `scopeJustification`.

**Advantages.** Much narrower than a general wildcard. Keeps the justification discipline that
makes the manifest a contract rather than configuration. Handles the real CDN cases.

**Why rejected — for now, and this is the alternative worth revisiting.** It does not solve the
shared-tenancy problem at all: the constraint bounds the *shape* of the pattern, not the *ownership*
of what it covers. `*.blob.core.windows.net` satisfies every one of those rules and is still
global. Adopting it would need an additional denylist of shared-tenant suffixes, which is a list
nobody can keep complete.

**It is also not needed yet.** No connector exists. Building the mechanism now means guessing at
constraints without a case to test them against — and a pattern grammar is much harder to narrow
later than to add later.

### C. Per-operation host sets

**What it is.** Declare hosts per operation rather than per connector, so a download operation
carries the content hosts and a read operation does not.

**Advantages.** Genuinely tighter. A compromised read path could not reach the CDN.

**Why rejected.** It does not answer the wildcard question — it makes the same question smaller. It
is a good idea on its own merits and is recorded as a review trigger rather than folded in here.

### D. Treat content download as a distinct capability

**What it is.** Bulk content transfer becomes its own declared capability with its own hosts, its
own risk class, and its own approval path.

**Advantages.** Puts the highest-sensitivity flow behind its own gate, which is where the risk
actually is.

**Why rejected.** Speculative. It presumes connectors that move files, and none is proposed.
Recorded so it is not reinvented.

---

## Consequences

**Positive**

- The allowlist stays a statement of fact, so the privacy dashboard stays truthful.
- Shared-tenant namespaces cannot be admitted by accident.
- The first connector is unblocked: a calendar-shaped connector needs four exact hosts.
- Loosening remains available. Nothing here forecloses B.

**Negative**

- **A provider adding an undocumented host breaks a connector until the manifest is updated.** This
  will happen, and it will happen at an inconvenient moment.
- File-transfer connectors will be harder to write than API connectors, and the difficulty lands
  on whoever writes the first one.
- The manifest for a content-heavy provider may need many exact hosts, which is tedious and looks
  like bureaucracy right up until it prevents something.

**Neutral**

- No code changes. This ratifies behaviour already shipped and tested.

---

## Reversibility

- **Cost to reverse:** **low.** Adding a pattern field is additive; every existing manifest stays
  valid.
- **How:** amend the manifest schema, add the grammar and its justification requirement, extend
  `egressPermits`, and extend the conformance suite.
- **Point of no return:** none for the mechanism. There is one for the *habit*: once a pattern is
  accepted for one provider, refusing the next one is a much harder conversation. That is the real
  reason to make this a deliberate decision rather than a default.

---

## Review triggers

- **A connector FRIDAY actually wants cannot be expressed with exact hosts.** Revisit B, with that
  connector as the concrete case.
- **A blocked egress occurs that was not a mistake** — Chapter 14's own trigger. One is
  information; three from the same provider means the model is wrong for that provider.
- **A manifest needs more than ~12 exact hosts**, which suggests the provider's surface is not
  really enumerable.
- **Per-operation host sets** (alternative C) are worth their own ADR whenever a connector has
  meaningfully different destinations per operation.

---

## Notes

**What I am uncertain about.** The strength of the shared-tenancy argument varies by provider.
`*.blob.core.windows.net` is unambiguously global; `*.slack-edge.com` may well be entirely Slack's.
I have treated the worst case as the rule because the manifest schema cannot tell them apart, but a
per-suffix judgment would be more accurate and less convenient.

**What I did not do.** No exhaustive survey of provider host sets — the four above are the ones I
checked. A provider outside that sample may make exact hosts genuinely impractical, and that is
precisely the trigger that should reopen this.

Sources consulted: Google's OAuth 2.0 and Apps Script allowlist documentation, and Google's guidance
on `googleusercontent.com` subdomains.
