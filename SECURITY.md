# Security Policy

FRIDAY holds more sensitive material than any other software her owner runs: correspondence,
calendar, financial picture, home controls, private notes, and credentials to the services holding
the rest.

That convergence is her value and her risk. Full model:
[Chapter 18 — Security Model](docs/01-bible/18-security-model.md).

---

## Reporting a vulnerability

**Do not open a public issue.**

Email the repository owner directly with:

- What the issue is
- How to reproduce it
- What an attacker could achieve
- Anything you know about scope or affected versions

You will receive acknowledgement within 72 hours. Fixes are prioritized by realistic impact, not by
severity score.

---

## Design posture

FRIDAY is built on **assume breach**. Prevention is not achievable; every control below limits blast
radius, makes compromise detectable, and makes recovery possible.

| Principle | How it is implemented |
|---|---|
| **No ambient authority** | Agents hold no credentials, no network access, no filesystem access. They can only *request* actions. |
| **Least privilege by construction** | Capability tokens authorize one action on one resource for minutes, not roles that persist. |
| **Nothing acts unrecorded** | Every action is written to a hash-chained audit log *before* it happens. If FRIDAY cannot record, she stops. |
| **Secrets are never on disk** | Credentials live in the macOS Keychain. The database holds pointers. A stolen backup yields no account access. |
| **Egress is allowlisted** | Every connector declares the hosts it may reach. Undeclared destinations are blocked and raise an alert. |
| **Sensitive data stays local** | Content classified `private` or above is processed by local models. The router fails closed rather than falling back to the cloud. |
| **Humans authorize consequences** | Actions above `low` risk require explicit approval. Timeout means **denied**. |

---

## Threats we defend against

Ordered by realistic likelihood. Full analysis in
[Chapter 18](docs/01-bible/18-security-model.md).

| Threat | Primary defense |
|---|---|
| **Prompt injection** — malicious instructions in content FRIDAY reads | Cannot be prevented. Contained: a fully captured agent holds no credentials and can only ask, and you see the ask. |
| **Supply chain compromise** — a malicious npm dependency | Minimal dependencies, pinned lockfiles, provenance checks, delayed major adoption, and the egress allowlist limiting what a compromised package can reach. |
| **Credential theft** | Keychain-only storage; short-lived scoped tokens issued per use; central revocation. |
| **Device theft** | FileVault, field-level encryption, biometric step-up, remote revocation. |
| **AI-authored vulnerability** | Human review of every merge; protected paths; size caps; automated scanning. |
| **Runaway cost or resource loop** | Nested budgets that fail closed at every level. |
| **Data exfiltration** | Egress allowlists, declared data categories, outbound audit visible in the dashboard. |
| **Compromised update channel** | Signed releases; signing key offline on removable media; explicit user consent for every update. |

### Explicitly out of scope

- A nation-state adversary with physical access and unlimited resources
- A compromised macOS kernel
- Hardware implants

Defending against these is not achievable for a personal system, and claiming otherwise would
misallocate effort.

---

## Prompt injection — the honest position

FRIDAY reads content written by other people: emails, documents, web pages, calendar invites. Any of
it can contain instructions aimed at her. **There is no complete defense, and we do not claim one.**

The architecture assumes injection will sometimes succeed, and is built so that success is not
harmful:

- The agent holds no credentials and has no network access
- Its capability token covers only the current step
- Every action it requests is evaluated by the Guardian regardless of its reasoning
- Consequential actions require you, with a preview of the real artifact
- Outbound requests to undeclared hosts are blocked
- Actions inconsistent with the plan's stated intent raise a diagnostic

A captured agent can produce a bad draft. It cannot move money, because it never could.

**Residual risk:** an injection that causes a plausible-looking request you then approve. This is why
approval screens show the actual artifact from a connector dry run rather than a description.

---

## Reporting FRIDAY's own misbehavior

If FRIDAY takes an action you did not expect, or you suspect she has been manipulated:

```bash
friday safe-mode
```

Agents halt, connectors disable, autonomous action stops. The dashboard and audit trail stay up so
you can see what happened.

If credentials may be compromised:

```bash
friday panic --revoke-all
```

Immediate, no confirmation prompt — a confirmation dialog during a compromise is the wrong design.

Runbooks: [`docs/runbooks/`](docs/runbooks/).
Recovery: [Chapter 34](docs/01-bible/34-disaster-recovery.md).

---

## Supported versions

Pre-release. Only the current version receives fixes. This changes at Milestone 4.

---

## Security-relevant contributions

Changes to these paths require the owner's review and cannot be merged from an AI-authored branch:

```
packages/guardian/           authorization
packages/guardian/policies/  the rules themselves — never delegable
packages/model-router/       what leaves the machine
packages/contracts/          data shapes and sensitivity classification
tests/constitutional/        the founding guarantees
.github/workflows/           the pipeline enforcing all of it
infra/                       how she runs
```

Enforced by `CODEOWNERS` and by CI.
