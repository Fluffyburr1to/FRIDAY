# ADR-0050 — Revocation is a credential-domain operation, never a Keychain delete

- **Status:** accepted
- **Date:** 2026-08-24
- **Accepted:** 2026-08-24
- **Deciders:** Tyler Hutson
- **Supersedes:** none
- **Related:** [ADR-0020](0020-key-material-comes-from-an-injected-key-provider.md) · [ADR-0035](0035-first-run-provisioning-is-creation-only.md) · [Chapter 14](../01-bible/14-connector-framework.md) · [Chapter 18](../01-bible/18-security-model.md)

---

## Context

[Chapter 14](../01-bible/14-connector-framework.md) requires that a connector never holds a
long-lived credential, and that **revocation is instant and central**: revoke once, and every
connector loses access at once. The connector-side boundary exists already; the store behind it does
not.

`packages/storage/src/crypto/keychain.ts` is the right foundation. It invokes `/usr/bin/security`
rather than linking a native binding ([ADR-0020](0020-key-material-comes-from-an-injected-key-provider.md)),
it never passes key material on a command line, and its own header states why it is one module
rather than several: *"they are separate interfaces that must not become separate implementations.
Two `execFileSync` call sites drift to two timeouts and two error mappings, and the drift is
invisible until the day one of them behaves differently on a machine nobody is watching."*

It already carries two ports — `KeyProvider` (read) and `KeyProvisioner` (create). A credential
store is a third over the same implementation, which is exactly what that header anticipates.

### ★ What was not known before looking: everything shares one namespace

Today **every secret FRIDAY holds lives under a single Keychain service**, `com.friday.credentials`,
distinguished only by account name:

| Account | What it is |
|---|---|
| `field-encryption-key` | the AES-256-GCM key encrypting every `private` field in the database |
| `anthropic-api-key`, `openai-api-key` | model provider keys |
| `backup-key` | backup encryption |

This matters enormously for this ADR. A deletion primitive scoped to *"the credential service"*
would still be able to reach `field-encryption-key` — and **deleting that key destroys every
encrypted field in the database, irrecoverably.** There is no backup of it inside FRIDAY; the
recovery card exists precisely because losing it is unrecoverable.

So the obvious design — add `delete(service, account)` next to the existing read and write — is not
merely untidy. It puts the single most destructive operation available to FRIDAY one wrong string
away from any caller.

### What ADR-0035 already settled, and where it stops

[ADR-0035](0035-first-run-provisioning-is-creation-only.md) made first-run provisioning
*"structurally incapable of modifying anything that already exists."* For an encryption key that is
a safety property and it stays.

But **revocation requires deletion**, so credentials cannot simply inherit that rule. The question
this ADR answers is how to have both.

---

## Decision

We will **add a third port to `packages/storage` — a connector credential store — in which
revocation is a credential-domain operation with its own lifecycle, and in which no code path can
name an encryption key at all.**

### 1. A separate Keychain service, not a separate account prefix

Connector credentials live under their **own Keychain service**, distinct from the one holding
encryption and model keys. The credential store is bound to that service at construction and the
service is never a parameter to any of its methods.

★ **This is what makes the guarantee structural rather than careful.** A prefix within a shared
service would be a convention that a malformed connector id could escape. A different service means
the destructive primitive is *pointed at a different namespace entirely* — the encryption key is not
merely hard to name, it is **not in the space the credential store can address.**

Belt and braces on top: the store refuses at construction if it has been configured with the same
service as the key store, so a copy-paste in a config file fails loudly at startup rather than
quietly at revocation.

### 2. The deletion primitive stays private

`deletePassword` is added to `keychain.ts` and is **not exported from `packages/storage`'s index**,
and is not reachable through `KeyProvider` or `KeyProvisioner`. Its only caller is the credential
store, which supplies its own bound service.

There is **no public API in FRIDAY that accepts an arbitrary Keychain name and deletes it.**

### 3. Credential ids are validated, not trusted

A connector id must be kebab-case and bounded before it is used to derive an account name. A caller
cannot supply a path, a wildcard, or another item's name.

### 4. Revocation is lifecycle state, not the absence of a value

The store distinguishes three states, and they are not derivable from "is a value present":

| State | Meaning |
|---|---|
| `absent` | never set up |
| `available` | usable now |
| `revoked` | **deliberately withdrawn** |

★ **A revoked credential does not become available again because something wrote a value under the
same identity.** Revocation leaves a tombstone, and while the tombstone stands the credential reads
as `revoked` no matter what else exists. Returning to service is `reprovision` — a separate,
explicitly named operation that clears the tombstone — never an ordinary write.

The reason is Article III. Revocation is the owner saying *no*. A design where the answer reverts to
*yes* because some later code path happened to store a value is a design where "no" has a shelf
life, and the code path that overwrites it will not know it is undoing a decision.

### 5. Still no OAuth

The store holds an opaque secret and knows nothing about how it was obtained. Whatever the eventual
first authenticated connector needs — an API key, an OAuth refresh token — is a value to this store.
**No OAuth flow is built until a real connector needs one**, and it arrives as part of that
connector's decision.

---

## Constitutional review

- **Article III (Control — the owner can always stop it):** §4. Revocation that can be silently
  undone is not revocation.
- **Article IV (Privacy):** the store never returns a secret for a credential that is not
  `available`.
- **Article V (Security — least privilege):** §1 and §2. The destructive operation is confined to a
  namespace that cannot contain an encryption key.
- **Chapter 18 (threat T4, malicious or compromised code with FRIDAY's privileges):** the defence
  here is not that callers are careful. It is that the address space of the delete does not include
  the thing worth protecting.

**The five questions:**

- [x] **Can the user see it?** `credential.issued` and `credential.revoked` already exist as event
      types, carrying the connector, the operation, and the scopes — never the secret.
- [x] **Can the user stop it?** Revocation is the mechanism, and §4 is what makes it durable.
- [x] **Can we replace it?** The store is a port. A different backing — a self-hosted Nango, which
      Chapter 14 flags for ~M8 — implements the same interface.
- [x] **Can we explain it?** *"You disconnected that. It will not reconnect on its own."*
- [x] **Will this still be right in five years?** The namespace separation will. The tombstone
      mechanism is the part most likely to want a real state column once there is a reason.

**Notes:** §1 changes an existing assumption — that one Keychain service holds everything. It is
additive: existing keys stay exactly where they are, and nothing needs migrating.

---

## Alternatives considered

### A. A general `delete(service, account)` on the Keychain module

**What it is.** The symmetrical operation next to `readPassword` and `writeNewPassword`.

**Advantages.** Obvious, small, and consistent with the module's existing shape. Any future secret
type gets deletion for free.

**Why rejected.** It puts the destruction of the field-encryption key — which is unrecoverable and
takes every encrypted field with it — one wrong string away from every caller. **The asymmetry
between read and delete is the point:** reading the wrong item is a bug, deleting the wrong item is
a disaster, and the two should not have the same shape.

### B. Account prefixes within the shared service

**What it is.** Keep one service; credentials become `connector.<id>` and deletion refuses any
account without the prefix.

**Advantages.** No new service, no config change.

**Why rejected.** It is a validation rule, and validation rules are only as strong as the validator.
The guarantee we want is that the encryption key is *not addressable*, not that it is *rejected*.
Those differ on the day someone adjusts the pattern for a good-looking reason.

### C. Deletion as the whole of revocation

**What it is.** `revoke` deletes the item. `absent` and `revoked` are the same state.

**Advantages.** Simplest possible. No tombstone to maintain or clean up.

**Why rejected.** It cannot distinguish *"never set up"* from *"deliberately withdrawn"*, so the next
thing to write a value silently reinstates something the owner refused. That is the failure §4
exists to prevent, and it would be invisible.

### D. Revocation state in the database rather than a tombstone

**What it is.** A table recording revocations; the Keychain holds only material.

**Advantages.** Real state, queryable, easy to give timestamps and reasons.

**Why rejected — narrowly, and this is the one to revisit.** It makes credential availability depend
on the database being open, which inverts the startup order: the field-encryption key is itself
fetched before the database is usable. Keeping credential state in the same place as credential
material avoids a bootstrap cycle. **Revisit when revocations need reasons and history**, which the
event log covers for now.

---

## Consequences

**Positive**

- Deleting an encryption key is not a mistake anyone can make through this API, because the API
  cannot name one.
- Revocation means something durable rather than "until the next write".
- The Keychain implementation stays single, as its own header demands.

**Negative**

- **A second Keychain service to configure, back up, and reason about.** Anyone auditing FRIDAY's
  secrets must now look in two places, and the recovery documentation must say so.
- **A tombstone is state that can be orphaned.** Revoking a connector that is later removed leaves a
  marker nobody clears. Harmless, but it accumulates.
- **`reprovision` is a second way to write**, and two write paths is one more than one. It is
  deliberate — the whole point is that returning to service should require saying so — but a future
  contributor will be tempted to collapse them.

**Neutral**

- No migration. Existing keys are untouched and stay in their existing service.

---

## Reversibility

- **Cost to reverse:** low while nothing is stored; **high afterwards.** Once real credentials exist
  under the new service, changing the layout means moving items in a live Keychain.
- **How:** the store is a port; a different implementation satisfies it.
- **Point of no return:** the first real credential stored. Before that this is all shape.

---

## Review triggers

- **Revocations need reasons, actors, or history** → adopt alternative D.
- **A second kind of credential appears** (a webhook secret, a device token) → confirm it belongs in
  the connector domain or gets its own.
- **Any deletion primitive is proposed on a public port** → this ADR is the answer, and it is a no.
- **More than ~20 connectors** → Chapter 14's own trigger for evaluating a self-hosted Nango behind
  this interface.

---

## Notes

**What this does not protect against.** Anything with the owner's Keychain access and a shell.
`/usr/bin/security` is available to any process running as the owner, and this ADR constrains
FRIDAY's own API rather than the operating system. The threat being addressed is a mistake or a
compromised component *inside* FRIDAY, which is threat T4 — not an attacker who already has the
machine.

**What is deliberately absent.** No OAuth, no token refresh, no provider-specific anything. The
store holds an opaque value. The first connector to need an authenticated call brings its own flow,
with its own decision.
