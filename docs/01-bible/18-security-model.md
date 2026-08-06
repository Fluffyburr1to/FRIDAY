# 18 — Security Model

> **Governing provisions:** Constitution **Article V** (Security), Article IV (Privacy), Article III
> (Approval), Article VII (Reliability); Manifesto Principle 4 (Privacy Is Fundamental); Core Value
> 4 (Security by Design).

---

## In plain language

FRIDAY will hold more sensitive material than any other software you run: your correspondence, your
calendar, your financial picture, your home controls, your private notes, and credentials to
services that hold the rest. She is, by design, a single place where all of it converges.

That convergence is her value and her risk. The security model exists to make sure the convergence
does not become a single point of catastrophic failure.

The organizing idea is **assume breach**. Not "prevent all attacks" — that is not achievable — but
"when something does go wrong, ensure the damage is bounded, detectable, and recoverable." Every
control below is chosen to limit blast radius rather than to promise prevention.

Three properties follow from that, and they run through everything:

- **Nothing has more power than its current task requires.** Not agents, not connectors, not
  departments. A compromised component holds a ticket, not a master key.
- **Everything is recorded before it happens.** A breach you can reconstruct is survivable. One you
  cannot is not.
- **The most valuable secrets are not in the system at all.** Your credentials live in the macOS
  Keychain. FRIDAY's database holds pointers.

---

## Threat model

Security work without a threat model is theatre. These are the threats FRIDAY is designed against,
in descending order of realistic likelihood.

| # | Threat | Likelihood | Impact | Primary defenses |
|---|---|---|---|---|
| **T1** | **Prompt injection** — malicious content in an email, document, or web page redirects an agent | **High** — this will happen | High | No ambient authority; capability tokens; Guardian; approvals; egress allowlist; plan-deviation detection |
| **T2** | **Supply chain compromise** — a malicious or hijacked npm dependency | Medium | **Critical** | Lockfiles, pinned versions, provenance checks, dependency review, minimal dependencies, egress allowlist |
| **T3** | **Credential theft** — tokens or keys extracted from disk or memory | Medium | Critical | Keychain-only storage; short-lived tokens; Credential Broker; no secrets in DB, logs, or git |
| **T4** | **Device theft** — the Mac or phone is stolen | Medium | High | FileVault; field-level encryption; biometric step-up; remote revocation |
| **T5** | **AI-authored vulnerability** — an assistant introduces a flaw | **High** | Medium–High | Human review of every merge; CODEOWNERS on sensitive paths; automated scanning; size caps on AI PRs |
| **T6** | **Runaway cost or resource loop** | Medium | Medium | Nested hard budgets, fail-closed ceilings, circuit breakers |
| **T7** | **Data exfiltration by a component** | Low | Critical | Egress allowlists; declared data categories; outbound audit |
| **T8** | **Malicious plugin** | Low (deferred) | Critical | Process sandbox; restricted permissions; signature verification; trial period |
| **T9** | **Network attacker on your LAN** | Low | Medium | TLS everywhere including localhost; authenticated APIs; Tailscale rather than exposed ports |
| **T10** | **Compromised update channel** | Low | **Critical** | Signed updates; offline signing key; explicit user consent for every update |

**Explicitly out of scope:** a nation-state adversary with physical access and unlimited resources;
a compromised macOS kernel; hardware implants. Defending against those is not achievable for a
personal system, and pretending otherwise would misallocate effort.

### T1 deserves special attention

Prompt injection is the threat most specific to this kind of system and the one with no complete
solution. Any content FRIDAY reads may contain instructions aimed at her.

The architecture's answer is not to prevent injection — it is to **make a successful injection
unable to cause harm**:

- The injected agent has no credentials and no network access ([Chapter 11](11-agent-framework.md)).
- Its capability token covers only its current step ([Chapter 17](17-authentication-authorization.md)).
- Any consequential action it requests goes to the Guardian, and to you ([Chapter 19](19-approval-system.md)).
- Any outbound request goes to a declared host or is blocked ([Chapter 14](14-connector-framework.md)).
- Actions inconsistent with the plan's stated intent raise a diagnostic.

A fully captured agent can produce a bad draft. It cannot send your money, because it never could.
**This is the strongest justification for the no-ambient-authority design**, and it is why that
design is not negotiable even when it is inconvenient.

---

## Defense layers

```
┌─────────────────────────────────────────────────────────────┐
│ 1  DEVICE      FileVault · OS updates · Keychain · biometrics│
├─────────────────────────────────────────────────────────────┤
│ 2  NETWORK     No exposed ports · TLS everywhere · Tailscale │
│                Egress allowlist per connector                │
├─────────────────────────────────────────────────────────────┤
│ 3  IDENTITY    Passkeys · device keys · step-up auth         │
├─────────────────────────────────────────────────────────────┤
│ 4  AUTHORITY   Capability tokens · Guardian policy · approval│
├─────────────────────────────────────────────────────────────┤
│ 5  ISOLATION   Worker threads · sandboxed plugins · bulkheads│
├─────────────────────────────────────────────────────────────┤
│ 6  DATA        Field encryption · Keychain secrets · minimize│
├─────────────────────────────────────────────────────────────┤
│ 7  SUPPLY      Lockfiles · pinned versions · provenance · SBOM│
├─────────────────────────────────────────────────────────────┤
│ 8  OBSERVE     Tamper-evident audit · anomaly detection      │
└─────────────────────────────────────────────────────────────┘
```

No layer is trusted to hold alone. That is the whole point of layering.

---

## Secrets

**Rule: no secret value is ever written to disk by FRIDAY, ever.**

| Secret | Where it lives | How it is used |
|---|---|---|
| Connector refresh tokens | macOS Keychain | Broker exchanges for short-lived access tokens |
| API keys (model providers) | macOS Keychain | Read into memory at startup, never logged |
| Database field encryption keys | macOS Keychain, hardware-backed | Never leave the process |
| Update signing key | **Offline, on removable media** | Used manually at release time only |
| Device identity keys | Secure Enclave where available | Never extractable |

**Enforcement, not intention:**

- `gitleaks` runs in CI and as a pre-commit hook; a commit containing a secret pattern is blocked.
- The logger has a redaction layer that strips known secret shapes before writing
  ([Chapter 22](22-logging-standards.md)).
- `.env.example` documents every variable with no real values; `.env` is git-ignored and checked for.
- A CI job asserts that no secret-shaped string appears in any built artifact.

**The update signing key is the most dangerous key in the system.** Whoever holds it can push
arbitrary code to a machine containing your entire digital life. It is not on your Mac, not in the
repository, and not on a CI runner. It lives on removable media, and releases are signed manually.
This is deliberate friction on a step that should never be automatic.

---

## Data protection

| State | Protection |
|---|---|
| **At rest** | FileVault (whole disk) + field-level AES-256-GCM for `private`/`secret` classifications |
| **In transit — external** | TLS 1.3, certificate validation enforced, no exceptions for convenience |
| **In transit — local** | TLS even on localhost, or a Unix socket with file permissions |
| **In use** | Secrets zeroed after use where the runtime permits; never in error messages |
| **In backups** | Encrypted before leaving the machine; the backup provider never sees plaintext |
| **In logs** | Redacted by classification; `secret` never logged in any form |

### Data minimization (Article IV)

The Manifesto's "external services should only receive the minimum information required" is
implemented at three specific points:

1. **Connectors declare data categories.** Sending an undeclared category is blocked by the runtime,
   not merely discouraged.
2. **The Model Router minimizes context.** Requests to cloud models are stripped of identifiers
   where possible, and `sensitivity: private` requests are **routed to a local model or refused** —
   never downgraded to a cloud provider.
3. **The privacy dashboard reports outbound flow.** "What left my machine this week, to whom, in
   what category" is answerable at any time from recorded events.

That second point is the one that makes Article IV real. A router that silently fell back to a cloud
model when the local one was unavailable would quietly break the guarantee at exactly the moment it
mattered. **The router fails closed.**

---

## Supply chain (T2)

This is, in my assessment, the most underestimated risk in the register. A single compromised
transitive dependency runs with FRIDAY's full process privileges.

| Control | Implementation |
|---|---|
| Exact version pinning | `pnpm-lock.yaml` committed; `--frozen-lockfile` in CI |
| Dependency review | New dependencies require justification in the PR; the owner reviews every addition |
| Minimal dependency count | An explicit goal. Every dependency is attack surface. Prefer writing 50 lines over adding a package. |
| Automated auditing | `pnpm audit` in CI; Dependabot for security updates |
| Provenance verification | npm provenance attestations checked where publishers provide them |
| SBOM generation | Produced for every release; enables answering "am I affected?" quickly |
| **Egress allowlist** | A compromised dependency still cannot reach an undeclared host |
| Delayed adoption | New major versions wait 2 weeks unless the update is a security fix |

The egress allowlist is the control that most limits blast radius here, and it is worth noting that
it was introduced in Chapter 14 for privacy reasons and turns out to be a supply-chain defense as
well. Controls that serve two purposes are the ones worth building.

---

## AI-authored code (T5)

FRIDAY will eventually write her own code, and AI assistants write most of it today. This is a
security-relevant fact, treated as one:

| Control | Rule |
|---|---|
| Human approval | **Every merge.** No exceptions, per your decision. |
| Protected paths | `packages/guardian/`, `packages/model-router/`, `docs/00-foundation/`, `.github/workflows/`, and all policy files require owner review via CODEOWNERS. FRIDAY's Engineering department is forbidden from proposing changes to Guardian policies at all. |
| Size caps | AI-authored PRs capped at 400 changed lines. Larger work is split, because a diff you will not read is not a diff you reviewed. |
| Mandatory plain-language summary | Every AI PR explains, in terms you can evaluate, what changed and what could go wrong. |
| Automated scanning | Semgrep, CodeQL, and dependency audit on every PR |
| Branch labelling | AI work is on `friday/*` branches and labelled `ai-authored`, so provenance is visible forever |
| No self-approval | FRIDAY cannot approve her own PR. Enforced by branch protection. |

The 400-line cap is the control I would defend hardest. Approval that is not review is not approval,
and a 2,000-line diff will not be read — by you or by anyone. Small diffs are the only mechanism
that keeps human oversight meaningful over years.

---

## Detection and response

Prevention fails. Detection is what makes that survivable.

**Detected automatically:**

- Egress to an undeclared host
- Capability token used outside its scope
- An agent requesting a risk class above its manifest ceiling
- Audit chain integrity failure
- Anomalous model spend
- Repeated authentication failures
- Guardian denials clustering unusually
- An action inconsistent with its plan's stated intent

**Response ladder:**

```
ANOMALY  → recorded; visible in the dashboard
   ▼
SUSPICIOUS → the component is suspended; you are notified with specifics
   ▼
CONFIRMED  → SAFE MODE: agents halted, connectors disabled,
             credentials revoked, kernel and dashboard remain up
             so you can see what happened and decide
```

**Safe Mode is a security control, not just a recovery mechanism.** FRIDAY stopping herself and
explaining why is the correct response to an unexplained state. Runbooks in `docs/runbooks/` cover
credential compromise, suspected injection, and dependency compromise. See
[Chapter 34](34-disaster-recovery.md).

---

## Alternatives considered

### Full whole-database encryption (SQLCipher)

**Advantages:** simpler, uniform, protects everything including metadata.

**Rejected** — makes the database opaque to standard tooling, which undermines the Article I property
that you can read your own data without FRIDAY. Also prevents indexing encrypted columns and adds a
native build dependency. Field-level encryption puts strong protection exactly where it is needed.

### Running FRIDAY inside a container or VM

**Advantages:** meaningful isolation from the host.

**Rejected** because FRIDAY needs deep host integration — Keychain, notifications, microphone, menu
bar — which containers make awkward or impossible. It would also add substantial memory overhead on
a laptop. Isolation is achieved instead at the component level, where the untrusted code actually
lives.

### A hardware security key (YubiKey) required for all high-risk operations

**Advantages:** the strongest possible protection against remote compromise.

**Rejected as mandatory** because losing it would be catastrophic and it is impractical for mobile
approvals. **Supported as an optional step-up factor** for `critical` actions — a good choice for
someone who wants it, a poor choice to require.

### Zero-trust networking with mutual TLS between all components

**Rejected** as disproportionate for a single-process application on one machine. Component
authentication is handled by capability tokens, which are checked in-process. Revisit if FRIDAY ever
spans machines.

### A third-party security monitoring service

**Rejected** — sending FRIDAY's telemetry to an external service conflicts directly with Article IV,
and the value for a single-user system is low. Detection is implemented locally in the diagnostics
system.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Prompt injection cannot be prevented,** only contained. | Accepted honestly. Containment is the achievable goal, and the architecture is built for it. |
| **Egress allowlists cause real friction** when providers change domains. | Accepted — a blocked request produces a clear diagnostic naming the host; the fix is a one-line manifest change with an audit record. |
| **Manual release signing** is inconvenient and not automatable. | Accepted deliberately. This is the highest-consequence key in the system. |
| **Human review of every merge is a throughput bottleneck.** | Accepted — it is the decision you made, and it is correct. Managed by the size cap. |
| **The 400-line AI PR cap forces splitting work.** | Accepted — splitting is a feature, not a limitation. |
| **Minimal dependencies means writing more code ourselves.** | Accepted — every dependency is attack surface running with full privileges. |
| **No external monitoring** means detection is only as good as what we build. | Accepted — the privacy cost of the alternative is too high. |

---

## Review triggers

- Any confirmed security incident, however minor → full model review
- A prompt injection succeeds in causing an approved action → the classification model is wrong
- Third-party plugins arrive → complete review of the isolation boundary
- FRIDAY is exposed beyond the local network → network security assumptions no longer hold
- A second human principal is added → data isolation review
- Annual review regardless, on the anniversary of ratification

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
