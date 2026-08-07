# ADR-0020 — Key material comes from an injected key provider

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 09 — Database Design](../01-bible/09-database-design.md),
  [Chapter 18 — Security Model](../01-bible/18-security-model.md),
  [Chapter 28 — Testing Strategy](../01-bible/28-testing-strategy.md)

---

## Context

[Chapter 09](../01-bible/09-database-design.md) requires field-level AES-256-GCM encryption for
`private` data, with the key held in the macOS Keychain, and requires that no secret value is ever
stored in SQLite — the database holds a Keychain *reference*.

That leaves one thing undecided: how `packages/storage` obtains the key.

Reading it directly from the Keychain at the point of use is the obvious answer and has a problem
that only appears when you try to write the tests. The Keychain is not available in CI, is not
available on a machine that is not a Mac, and prompting for access mid-test is not a thing a test
suite can do. A component that talks to the Keychain directly can only be tested by skipping the
tests — and Chapter 22's rule about redaction applies equally here: **encryption that is not tested
is encryption that silently stops working after a refactor.**

The second force is the platform. FRIDAY targets macOS, and Chapter 33 treats a move to a Mac Mini or
a Linux VPS at Milestone 5 as an open question. A storage layer wired directly to `/usr/bin/security`
would need surgery on the day that question is answered.

## Decision

We will **define a `KeyProvider` interface in `packages/storage` and inject it**, with a
Keychain-backed implementation for normal operation and an in-memory implementation for tests. The
Keychain implementation invokes `/usr/bin/security` as a subprocess rather than linking a native
Keychain binding.

## Constitutional review

- **Article IV (Privacy):** unchanged. The key still lives in the Keychain in normal operation; the
  in-memory provider exists only where there is nothing real to protect.
- **Article V (Security):** the interface is a seam, not a weakening — there is no code path that
  reads a key from configuration or from the database, and the config schema holds references only.
- **Article VII (Reliability):** a missing key is a typed `Result` error with a plain-language
  message, so FRIDAY stops rather than continuing with her private fields unreadable.
- **Principle 4 (Privacy Is Fundamental):** the key value never appears in an error, a log line, or
  an event payload. There is a test asserting exactly that.

**The five questions:**

- [x] **Can the user see it?** `friday status` reports when a key cannot be read.
- [x] **Can the user stop it?** A missing key halts the write rather than falling back to plaintext.
- [x] **Can we replace it?** That is the point of the interface — a Linux Secret Service or an
      age-encrypted keyfile provider is one file.
- [x] **Can we explain it?** The error names the reference and what its absence costs.
- [x] **Will this still be right in five years?** Yes. The interface is three lines.

**Notes:** The in-memory provider is the part to watch. It exists for tests and for the moment a key
has just been generated and not yet written to the Keychain. A key held in a process's memory is a
key in a crash dump, and it must never become the normal path.

## Alternatives considered

### Call the Keychain directly from the encryption code

**What it is.** `encryptField` shells out to `security` itself.

**Advantages.** No indirection. One fewer concept. Impossible to accidentally configure a weaker
provider, because there is no provider to configure.

**Why rejected.** Untestable without a Mac and a populated Keychain, which means untested in CI,
which means the encryption path is verified by nobody. That trade is unacceptable for the component
that decides whether private content reaches the disk in the clear.

### Use a native Keychain binding (`keytar` or a successor)

**What it is.** A native Node module linking against the macOS Security framework.

**Advantages.** No subprocess, so faster and with a proper typed API. Handles more Keychain features
than the command-line tool exposes.

**Why rejected.** A native module has to be rebuilt for every Node version and every macOS version
for the next decade, on the component whose failure mode is "FRIDAY cannot read anything she has
stored privately." `keytar` itself is already archived, which is the argument in miniature. The
subprocess costs a few milliseconds on a path that runs once at startup.

### Store the key in configuration, encrypted with a passphrase

**What it is.** A key in `config.json`, unlocked at startup by a passphrase the owner types.

**Advantages.** No platform dependency at all. Portable to any machine immediately.

**Why rejected.** It puts a secret in a file the owner might back up, sync, or paste into a support
request, and it means FRIDAY cannot restart unattended. Chapter 09 is explicit that no secret value
is stored outside the Keychain, and this would be one.

## Consequences

**Positive**

- Encryption, decryption, key-length validation, and the missing-key path are all under test, on
  every platform, with no Keychain.
- Moving to a Mac Mini or a Linux host at Milestone 5 needs one new provider, not a change to
  storage.
- The subprocess has an explicit timeout, satisfying Chapter 30's rule that every external call has
  one.

**Negative**

- **The interface makes it possible to run FRIDAY with an in-memory key.** Nothing in the type system
  distinguishes the test provider from the real one, so a future contributor could wire the wrong one
  in. Mitigated only by the fact that `apps/cli` constructs the Keychain provider explicitly and
  visibly.
- Shelling out to `security` means parsing a command-line tool's output, which is a contract nobody
  promised to keep stable.
- The subprocess is slower than a native call, and would matter if a key were fetched per row rather
  than per process. It is not, today, and this is worth remembering if that changes.

**Neutral**

- The key is decoded from base64. That is a storage-format choice, not a security one.

## Reversibility

- **Cost to reverse:** low.
- **How:** the Keychain implementation is one function. Replacing the subprocess with a native
  binding, or removing the interface entirely, touches `packages/storage/src/crypto/key-provider.ts`
  and nothing else.
- **Point of no return:** none.

## Review triggers

- FRIDAY runs on anything other than macOS — a second provider is needed, and this is when the
  interface pays for itself.
- A key is ever needed per row rather than per process — the subprocess cost stops being negligible.
- `/usr/bin/security`'s output format changes, or Apple deprecates it.
- Key rotation becomes a real operation — the provider will need to serve more than one key version.

## Notes

What was not known at the time: whether a maintained native Keychain binding exists that is worth the
build burden. `keytar` is archived; its successors were not evaluated in depth, because the
subprocess was good enough and the interface makes the question cheap to revisit.
