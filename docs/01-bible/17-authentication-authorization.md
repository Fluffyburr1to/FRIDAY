# 17 — Authentication & Authorization

> **Governing provisions:** Constitution Article I (The User), Article III (Approval), Article V
> (Security — least privilege), Article IV (Privacy); Manifesto Principle 1, Principle 4.

---

## In plain language

Two different questions, constantly confused, and it is worth separating them clearly because the
whole chapter depends on the distinction:

- **Authentication** — *who is this?* Proving you are you.
- **Authorization** — *may they do that?* Deciding what a proven identity is allowed to do.

FRIDAY has an unusual profile here. There is essentially one human user, so authentication is
comparatively simple. But there are *many* non-human actors — agents, departments, connectors,
scheduled jobs, and eventually plugins — all asking to do things, and authorization for them is
where the difficulty lives.

The design principle that resolves this:

> **Being authenticated grants you nothing. Every action requires a specific, narrow, expiring
> permission that was issued for that purpose.**

Most systems work the other way: you log in, and now you are "the user," and the user can do
anything the user can do. That model cannot work here. If an agent that has been manipulated by a
malicious email inherits your full authority, then your authority is what the attacker now holds.

Instead, FRIDAY uses **capabilities**. A capability is like a single-use ticket: it names one
action, on one resource, valid for a few minutes. An agent drafting an email gets a ticket that
says "you may read the contacts namespace of memory, until 14:35." It does not get "you are Tyler."

---

## Authentication

### The human user

| Context | Method | Why |
|---|---|---|
| **Desktop app on the host Mac** | OS-level session + device keypair in Keychain | You already authenticated to macOS. Requiring a second password to reach a local service you own is friction without security benefit. |
| **Web dashboard on the host** | Same device credential | Same reasoning. |
| **Web dashboard from another machine** | **Passkey (WebAuthn)** | Phishing-resistant, no shared secret, hardware-backed. |
| **iPhone app** | Device-bound keypair, unlocked by Face ID | Standard, strong, and it is what the platform does well. |
| **High-risk approvals, any surface** | **Re-authentication via biometric** | An unlocked device is not sufficient authorization to move money. |
| **CLI** | Local Unix socket, file permissions | Only a process running as you can connect. |

**Passkeys rather than passwords.** Passwords are the weakest link in nearly every breach: reused,
phished, guessed. Passkeys cannot be phished (they are bound to the origin), cannot be reused
(unique per site), and cannot be stolen from a server (the server holds only a public key).

For a system whose entire purpose is holding sensitive things, choosing the strongest available
authentication is not a close call. The cost is that recovery must be designed carefully — see
below.

### Step-up authentication

Sensitive operations require proving it is you *right now*, not that you logged in this morning.

| Trigger | Requirement |
|---|---|
| Approving a `high` or `critical` action | Biometric or passkey, within 60 seconds |
| Changing Guardian policies | Passkey, always |
| Adding or modifying a connector's credentials | Passkey |
| Granting a standing permission | Passkey |
| Exporting all data | Passkey |
| Any approval after 30 minutes of inactivity | Re-authenticate |

This directly addresses the realistic threat: your unlocked laptop, unattended for five minutes.
Session-based authorization alone would let anyone walking past approve anything.

### Non-human actors

Agents, departments, connectors, and scheduled jobs never authenticate as you.

| Actor | Identity | Credential |
|---|---|---|
| Agent | `agent:<department>/<agent-id>` | Capability token issued per invocation |
| Department | `dept:<id>` | Registered at load, verified against manifest |
| Connector | `conn:<id>` | Short-lived token from the Credential Broker |
| Scheduled job | `schedule:<id>` | Runs under the identity that created the schedule |
| Plugin | `plugin:<id>` | Sandboxed identity, restricted permission set |

**Every event, every audit entry, and every Guardian decision records the actor.** When you ask "who
did this," the answer is specific: not "FRIDAY," but `agent:communications/draft-email` acting under
plan `01J8...` on your behalf.

### Recovery — the hardest part

Passkeys have one serious failure mode: lose every device and you are locked out of your own life's
data. This must be solved before it happens, not after.

| Mechanism | Design |
|---|---|
| **Multiple passkeys** | At least two registered devices, required at setup. FRIDAY refuses to complete setup with only one. |
| **Recovery codes** | 10 single-use codes generated at setup, displayed once, intended for paper storage in a safe place |
| **Local override** | Physical access to the host Mac plus its OS login can regenerate credentials — because someone with that access already has the database |
| **Data is never held hostage** | The SQLite files are readable with standard tools. Losing access to FRIDAY never means losing access to your data. |

That last row is the real safety net, and it follows from Article I. Authentication protects the
*interface*, not the *data*. Your data is in a standard file format on a disk you own.

---

## Authorization: capabilities

### Why capabilities rather than roles

Role-based access control — "this actor is an admin, admins can do X" — is the industry default and
it is the wrong model here.

The problem is **ambient authority**: if an agent holds a role, it holds that role's full power for
its entire lifetime, for every action, regardless of what it is currently doing. An agent that was
supposed to draft an email but has been redirected by prompt injection still holds every permission
the role granted.

Capabilities eliminate ambient authority. A token authorizes *one action* on *one resource* for *a
few minutes*, and it was issued because a specific plan step required it.

```
Capability token
├── issuedTo        agent:communications/draft-email
├── plan / step     01J8XKQ.../3          ← tied to specific work
├── action          memory.read
├── resource        memory:contacts/*     ← narrow
├── constraints     { maxCalls: 5 }
├── issuedAt / expiresAt  ← minutes, not hours
└── signature       HMAC, kernel key
```

The practical consequence: **an agent captured by prompt injection cannot exceed what its current
step required.** It holds a ticket to read contacts. That is all it can ever do with that ticket.
This is the single strongest argument for the design, and it is why Article V's "principle of least
privilege" is implemented this way rather than with roles.

### Layered evaluation

Every request passes four checks, in order, and **all must pass**:

```
1. AUTHENTICATION   Who is asking? Unknown → reject.
        ▼
2. CAPABILITY       Does the token cover this exact action and resource,
                    and is it still valid?              → no: reject
        ▼
3. POLICY           Does the Guardian's policy permit this action for
                    this actor on this resource?        → no: deny
        ▼
4. RISK             What risk class? Does it require approval?
                    → yes: NEEDS_APPROVAL (see Chapter 19)
```

**Capabilities and policy are both required, deliberately.** A capability says "this actor was given
permission for this step." Policy says "this kind of action is permitted at all, under current
conditions." A bug in capability issuance cannot bypass policy, and an over-broad policy cannot
grant an agent something its step did not require. Two independent gates.

### Policy language

Policies are declarative data, not code:

```
{
  "id": "connector-write-requires-approval",
  "effect": "require_approval",
  "when": {
    "action": "connector.*.write",
    "actorType": "agent"
  },
  "unless": {
    "standingGrant": { "matches": true, "notExpired": true }
  },
  "riskClass": "medium"
}
```

**Why declarative rather than code:** policies can be listed, diffed, explained, and shown to you in
plain language. When FRIDAY says "I need approval because connector writes require it," she is
naming an actual rule you can go read. Policy expressed as scattered `if` statements cannot be
enumerated, cannot be audited, and cannot be explained truthfully.

Policies live in `packages/guardian/policies/`, are version-controlled, and **changing one is a
`critical` risk-class action requiring your explicit approval**. FRIDAY's Engineering department may
never modify Guardian policies — this is enforced in CODEOWNERS and in the Guardian itself.

---

## Multi-user, from day one

Every row of user data and every event carries `principal_id`. Today there is one value.

**Why now rather than later.** Retrofitting multi-tenancy means auditing every query in the system
and getting isolation right in all of them, under time pressure, after data already exists.
Cross-tenant data leakage is the most common serious bug in systems that added multi-user support
late.

The cost now is one column and one rule enforced in `packages/storage`: every query filters by
principal. The rule is exercised by every query written from Milestone 1, so by the time a second
person exists, the isolation has been under test for years.

Planned model when family is added: separate principals, separate memory namespaces, explicit and
revocable sharing grants, and an owner role that can administer but **cannot read another
principal's private memories without a recorded, notified access event.** Being the account owner
should not silently mean reading your family's private data.

---

## Alternatives considered

### Passwords with TOTP two-factor

**Advantages:** universally understood, no device dependency, easy recovery.

**Rejected** because passwords remain phishable and reusable, and TOTP is phishable in real time.
For a system holding this much, passkeys are meaningfully stronger at comparable convenience.
Recovery codes cover the recovery gap.

### No authentication at all (trust local access)

**Advantages:** zero friction; arguably reasonable for a single-user local application.

**Rejected** because it fails the moment the phone app exists, and because step-up authentication is
required for high-risk approvals regardless. It also fails the unattended-laptop threat, which is
the most realistic one.

### Role-based access control (RBAC)

**Advantages:** familiar, simple, well-understood tooling.

**Rejected** for the ambient authority problem detailed above. RBAC is the correct model when actors
are trustworthy humans doing varied work. It is the wrong model when actors are AI agents that can
be manipulated into doing something other than their assigned task.

### OAuth2 with FRIDAY as her own authorization server

**Advantages:** standard, well-specified, good tooling.

**Rejected** as heavy machinery for one user and internal actors. Capabilities are simpler and
better matched to the requirement. OAuth is used where it belongs: authenticating *to external
services* via connectors.

### A policy engine (Cedar, OPA/Rego)

**Advantages:** genuinely better than a hand-rolled engine — formally analyzable, expressive, and in
Cedar's case with verified semantics.

**Seriously considered.** Rejected for now on grounds of dependency weight and the fact that our
policy set is small and highly specific to FRIDAY's risk model. Our policy format is deliberately
kept simple and declarative, which means **migrating to Cedar later is a translation, not a
redesign.** Flagged for reassessment if the policy count exceeds roughly 50 or if policy
interactions become hard to reason about.

### Full JWT-based sessions

**Rejected** for internal use — JWTs are designed for stateless distributed verification, which is
irrelevant in a single process, and their revocation story is poor. Capability tokens are checked
against kernel state and can be revoked instantly.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Per-step capability issuance adds overhead** (~1ms). | Trivially accepted for the elimination of ambient authority. |
| **Passkey recovery is genuinely harder** than password reset. | Accepted and mitigated: two devices required, recovery codes, local override, and data readable without FRIDAY at all. |
| **Step-up authentication adds friction** on exactly the actions you most want to do quickly. | Accepted — this friction is Article III working. Tuned by risk class so routine actions are unaffected. |
| **`principal_id` everywhere is overhead** for one user. | Accepted deliberately — one column now versus a security audit later. |
| **Hand-rolled policy engine** rather than Cedar. | Accepted with a documented migration trigger; the declarative format keeps the door open. |
| **Capability tokens must be issued correctly** — a bug here is a security bug. | Accepted; mitigated by policy as an independent second gate, and by exhaustive testing of the Guardian. |

---

## Review triggers

- Policy count exceeds ~50, or policy interactions become hard to reason about → evaluate Cedar
- A second human principal is added → full multi-user review before enabling
- Third-party plugins arrive → capability model reviewed for untrusted actors
- Any capability escalation incident, however minor
- WebAuthn support changes materially on any target platform

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
