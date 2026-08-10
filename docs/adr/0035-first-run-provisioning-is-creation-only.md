# ADR-0035 — First-run provisioning is creation-only

- **Status:** accepted
- **Date:** 2026-08-10
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 18 — Security Model](../01-bible/18-security-model.md),
  [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [Chapter 34 — Disaster Recovery](../01-bible/34-disaster-recovery.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0020 — Key material comes from an injected key provider](0020-key-material-comes-from-an-injected-key-provider.md),
  [ADR-0025 — Policy evaluation is order-independent and fails closed](0025-policy-evaluation-is-order-independent-and-fails-closed.md),
  [ADR-0026 — Capability tokens are signed handles to kernel state](0026-capability-tokens-are-signed-handles-to-kernel-state.md),
  **[ADR-0033 — Authorization rules are loaded from a configured directory](0033-authorization-rules-are-loaded-from-a-configured-directory.md)**,
  [ADR-0034 — Guardian counter writes happen outside the append transaction](0034-guardian-counter-writes-happen-outside-the-append-transaction.md),
  [`packages/guardian/policies/README.md`](../../packages/guardian/policies/README.md),
  [`apps/cli/README.md`](../../apps/cli/README.md)

---

## Context

**FRIDAY cannot start on any machine, and nothing in the repository can make her able to.**

That is not a regression. It is the state ADR-0033 chose deliberately and deferred to a command that
does not exist yet. Three places say so, in the code as well as in the record:

| Claim | Verified at |
|---|---|
| The policy directory is required and nothing creates it | [`defaults.ts`](../../packages/config/src/defaults.ts) — *"Nothing creates this directory yet, so a fresh machine fails startup until it exists — which is deliberate, and is `friday init`'s to close."* |
| The capability signing key is required and nothing provisions it | [`context.ts:179`](../../apps/core/src/context.ts) — *"Nothing provisions this Keychain entry yet, so on a fresh machine this is where startup stops."* |
| Both are `friday init`'s to solve | [ADR-0033](0033-authorization-rules-are-loaded-from-a-configured-directory.md) — Decision, Consequences → Negative, Notes, and Review trigger 1 |

Milestone 3's slices to date made `apps/core` compose a Guardian in production and put FRIDAY's own
startup integrity check through it. Every one of those paths is real, tested, and unreachable on a
machine that is not a test fixture. This ADR decides the command that closes that gap.

### What has to exist before FRIDAY can start

Three things, and they are independent of each other:

1. **`paths.policiesDir`** — a directory of `*.json` rules. [`loadPolicySet`](../../packages/guardian/src/policy-set.ts)
   reads every `*.json`, refuses an empty set, and refuses a missing directory. `openContext` calls
   it **before** any database is opened.
2. **`capability-signing-key`** — read at construction by `createCapabilityIssuer`. Its name is a
   constant in [`capabilities.ts`](../../packages/guardian/src/capabilities.ts), not a configuration
   key.
3. **The field-encryption key** — named by `keychain.fieldKeyRef`, default `field-encryption-key`.
   `openStorage` needs it to write an encrypted field, which recording a `guardian.decided` does.

### Four things that were assumed and turn out to be false

These were checked rather than reasoned about, because ADR-0033's own closing note warns that
*"an empirical check that reassures because it is measuring the development configuration"* is how
this class of fault survives review.

**The `exports` map already forbids reaching the shipped policies through the package.**
`import.meta.resolve('@friday/guardian/policies/README.md')` fails today with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. ADR-0033 reasoned about `files`; `exports` is a second, independent
gate, and both have to be opened for any package-resolution design to work.

**`@friday/guardian` resolves to `dist/`, not to source, even inside the workspace.**
`import.meta.resolve('@friday/guardian')` returns `packages/guardian/dist/index.js`. ADR-0033 states
that in the workspace *"`@friday/guardian` resolves to the source directory and `../policies`
exists."* The conclusion it drew is right and the mechanism it stated is not: `../policies` resolves
correctly from `dist/` only because `dist/` happens to sit one level below the package root. Nothing
promises that, which is an argument against deriving the directory from the entry point at all.

**Passing key material to `/usr/bin/security` puts it in the process argument list.** The tool's own
usage text says *"Use of the -p or -w options is insecure."* An argument vector is readable by other
processes on the machine, so `add-generic-password -w <key>` would write a secret somewhere
Chapter 18's *"no secret value is ever written to disk by FRIDAY, ever"* does not cover but plainly
means. The safe form is `-w` as the **last** argument with no value, and the key written to the
child's stdin — where it must be sent **twice**, because the tool prompts for confirmation. Verified
end to end, including that the value round-trips byte-identically.

**Refusing to overwrite is the tool's default, not something we have to build.**
`add-generic-password` **without** `-U` fails with exit 45 and *"The specified item already exists in
the keychain"*, and the stored value is unchanged. The safe behaviour is the one you get by omitting
a flag.

### What we did not know when ADR-0033 was written

That the packaging fault has two halves that come apart. ADR-0033 treated "resolve the shipped
directory through the package" as a single idea and rejected it whole. It is two: **where the bytes
live in a distribution**, and **which directory the Guardian decides against at runtime**. Rejecting
the second does not require rejecting the first — and the first is the only sane answer to where a
copy comes from.

## Decision

We will **add `friday init`, a creation-only bootstrap command that brings FRIDAY's three runtime
prerequisites into existence and is structurally incapable of modifying anything that already
exists.**

The invariant that governs every question below, and the reason this ADR has a short title:

> **`friday init` creates. It never overwrites, never merges, never deletes, and never authors.**

| Rule | |
|---|---|
| **Creation-only** | Anything already present is left exactly as found and reported as found. There is no `--force`. |
| **Idempotent** | Running it twice is safe, and running it after a partial failure resumes rather than restarts. |
| **Copies bytes, never writes rules** | The rule content is the shipped defaults, verbatim. Init has no opinion about what a rule says. |
| **Writes no events, opens no database** | It runs before the log exists and must leave no trace of having assumed otherwise. |
| **Issues nothing** | No capability, no standing grant. [ADR-0034](0034-guardian-counter-writes-happen-outside-the-append-transaction.md) gates both and this ADR does not open them. |
| **`paths.policiesDir` is unchanged** | Its semantics, its default, and the no-fallback rule are ADR-0033's and stay exactly as written. |
| **★ A key is never minted beside a database that predates it** | If either database file exists and the field-encryption key does not, init **refuses**. Creating one there would silently destroy the readability of an existing audit trail. §2 and §5. |
| **`packages/guardian`'s manifest is amended** | `files` and `exports` only — no source, no signature, no behaviour, no test. This **amends** ADR-0033's *"`packages/guardian` is not modified"* and does **not** supersede it: that ADR's decision about where the runtime rule set loads from is reaffirmed unchanged. |
| **`./policies/*` becomes part of the Guardian's published surface** | A subpath in `exports` is a contract that outlives this ADR's use of it. Recorded as chosen rather than inherited. |

### 1. Where the shipped defaults come from

**The shipped defaults travel as published content of `@friday/guardian`, and `friday init` locates
them by resolving a declared subpath through Node's `exports` map.**

| | |
|---|---|
| **Manifest change** | [`packages/guardian/package.json`](../../packages/guardian/package.json) gains `"policies"` in `files`, and `"./policies/*": "./policies/*"` in `exports`. Both are required; either alone leaves the directory unreachable. |
| **How init finds it** | Resolve `@friday/guardian/policies/README.md`, take its containing directory, copy every `*.json` from it. |
| **Why that anchor** | [`check-docs.mjs`](../../tools/scripts/check-docs.mjs) fails the build if any directory lacks a `README.md`, so the anchor cannot silently disappear. A rule filename would be a worse anchor: rule files are the owner's to add and remove. |
| **What is copied** | `*.json` only — exactly what `loadPolicySet` reads. The README stays behind; it documents the repository's copy and would immediately begin to drift from the owner's. |
| **Workspace** | pnpm links the package directory, `exports` applies, the subpath resolves. |
| **Distribution** | `files` includes `policies`, so the bytes are in the tarball and the same subpath resolves. |

**Resolution proves the export mapping, not the file.** `import.meta.resolve` on an `exports`
pattern subpath returns a path without checking that anything is there — verified: a resolve of a
deliberately absent `policies/NOPE.md` succeeded and returned a URL. So the two halves fail
differently. A missing `exports` entry fails at resolution, loudly and immediately. A missing
`files` entry **does not**: resolution succeeds, and the failure arrives later as `ENOENT` from the
directory read. That is still a refusal to start rather than a silent permit, but it is exactly the
"works everywhere except when packaged" shape ADR-0033 exists to prevent, and it is not caught by
anything that runs today — [`shipped-policies.test.ts`](../../packages/guardian/test/integration/shipped-policies.test.ts)
locates the directory by relative filesystem path and passes regardless of what ships.

**So a packaging assertion is mandatory, not optional.** The implementing PR must include a test
that packs `@friday/guardian` and asserts the archive contains `policies/*.json`. Verified against
the current manifest, `npm pack --dry-run --json` reports 55 files and **zero** matching
`policies` — the only non-`dist` entries npm forces in are `README.md` and `package.json`. A test
that cannot observe the difference between the current manifest and the amended one is not a test of
this decision.

**This does not reopen ADR-0033.** That ADR rejected resolving the package directory *as the runtime
rule set*. Here the package directory is a **copy source**, read once, by a command that runs before
FRIDAY does. The runtime still loads exactly one directory — `paths.policiesDir` — with no fallback.
The failure mode ADR-0033 named, *"the owner's rules would live inside a bundle that FRIDAY's own
updates replace"*, is the specific thing a copy prevents.

**The honest tension.** ADR-0033 says *"`packages/guardian` is not modified."* This ADR modifies its
packaging manifest. That statement was scoped to ADR-0033's own decision — it added a caller, not an
API — and it remains true here in the sense that matters: no Guardian source, no signature, no
behaviour, and no test changes. What changes is which files ship. It is still a change to the most
safety-critical package in the system and it is named rather than slipped in.

### 2. Key generation

| | |
|---|---|
| **Keys** | Two. `capability-signing-key` (HMAC-SHA256, [`capabilities.ts`](../../packages/guardian/src/capabilities.ts)) and the field-encryption key named by `keychain.fieldKeyRef` (AES-256-GCM). |
| **Length** | 32 bytes each. [`KEY_LENGTH_BYTES`](../../packages/storage/src/crypto/key-provider.ts) already refuses any other length, and a provisioner that writes a key the reader rejects would be a self-inflicted outage. |
| **Encoding** | base64, matching `decodeKey`. |
| **Entropy** | `randomBytes` from `node:crypto` — the platform CSPRNG. Not derived from a passphrase, not seeded, not reused between the two keys. |
| **Keychain service** | `config.keychain.service`, default `com.friday.credentials`. |
| **Account names** | `keychain.fieldKeyRef` from configuration; `CAPABILITY_KEY_REFERENCE` from the Guardian constant. |
| **If a key exists** | Left alone. Reported as already present. **Success, not an error.** |
| **★ If the field key is absent and a database exists** | **Refuse.** Do not generate. Fail with a recovery-oriented message. See below. |
| **How it is written** | `add-generic-password`, `-w` last with no value, key sent twice on stdin, `-U` **omitted** so an existing item refuses the write at the OS level. |

#### The state that must be made impossible

**A missing field-encryption key beside an existing database is not a fresh install. It is a
disaster, and creation-only would quietly make it worse.**

Traced against the code rather than assumed:

| Step | What actually happens |
|---|---|
| Init mints a new field key next to a populated `events.db` | Reports success. Nothing has failed yet. |
| `apps/core` starts | **Starts cleanly.** [`verifyChain`](../../packages/storage/src/repositories/chain-verification.ts) takes `{ db, fromSeq }` — no key — because the chain covers a digest of the *stored* bytes (ADR-0028). The startup self-check passes. |
| Anything reads a historical decision | Fails. Every clerk event is written `sensitivity: 'private'` ([`authorizing-clerk.ts`](../../packages/clerk/src/authorizing-clerk.ts), [`approval-clerk.ts`](../../packages/clerk/src/approval-clerk.ts)), and `prepareStoredPayload` encrypts exactly those. |

The result is a FRIDAY that starts, verifies, and reports herself healthy while **every
authorization decision she has ever recorded is permanently unreadable**. Article II's guarantee is
gone and nothing says so.

The path is not exotic. It is Chapter 34's own *"Disk failure or lost machine"* procedure: restore
the data directory onto a new Mac, run setup. The Keychain does not travel with the database.

**Therefore: if `paths.eventsDb` or `paths.mainDb` exists and the field-encryption key is absent,
init refuses to generate one and exits non-zero.** The message must say that the databases hold
payloads encrypted with a key this machine does not have, that generating a new key would not
recover them, and where the original key would have to come from — the Keychain of the machine that
wrote them, or a backup of it. Init offers no override; recovering the key is outside FRIDAY.

This preserves creation-only rather than bending it. Init still never overwrites; it declines to
create into a context where creating is destructive.

**The guard detects an absent key, not a wrong one.** A field key that is *present but stale* — a
Keychain entry from a different machine, or from a database that has since been replaced — passes
this check, and init reports success. Detecting it would require init to read key material, which
§3's provisioner deliberately makes impossible, or to open a database and attempt a decrypt, which
the Decision table forbids. **Both are refused: the guard's scope stops here on purpose.**

The residual is bounded and, unlike the state above, it is not silent. AES-256-GCM is authenticated,
so the first read of a payload written under a different key fails its authentication tag and
surfaces as a typed error rather than as plausible garbage. A stale key therefore produces a loud
partial failure at read time; the absent-key case this guard closes was the one that produced a
healthy-looking FRIDAY and no error at all.

#### What the owner is told

**Init must state, in plain language, that the field-encryption key is irreplaceable** — that it is
what makes private audit payloads readable, that it exists only in the Keychain, and that losing the
Keychain without a backup means losing readable access to them permanently.

This is required output, not a nicety. Article II: the owner cannot take a precaution nobody told
them was needed, and the moment the key is created is the only moment they are certainly present.

**This ADR does not design a recovery artifact.** [Chapter 34](../01-bible/34-disaster-recovery.md)'s
recovery card enumerates the *backup* encryption key, B2 credentials, and passkey recovery codes —
not this key — and covers Keychain credentials with *"backed by your existing Mac backup"*, while its
lost-machine procedure contains no step that restores them. That inconsistency is Chapter 34's to
resolve and is carried as a review trigger. What this ADR owes it is to make the dangerous state
impossible and to name the dependency out loud, which is what the two rules above do.

**The two reference names come from different places, and that asymmetry is deliberate.** The field
key's name is configuration because storage takes it as a parameter. The capability key's name is a
constant because the Guardian hardcodes it and nothing may configure a second name for the key that
signs capability tokens. Init reads each from its own source and invents neither.

**Provisioning is not atomic, and will not pretend to be.** Two Keychain items are two writes with no
transaction between them. Rather than fake atomicity we make the operation **resumable**: because
init is creation-only and idempotent, a failure after the first key leaves a correct partial state
that a second run completes. The command reports precisely which keys it created and which it found.

**There is no rollback, deliberately.** Deleting a key init has just written is more dangerous than
leaving it: a key it did not in fact create — written moments earlier by another run, or by the owner
— would be destroyed, and destroying the field-encryption key makes every encrypted field permanently
unreadable. Leaving a correct key in place costs nothing.

**Key material never leaves the process except into the Keychain.** Not in `argv`, not in
configuration, not in a log line, not in an error, not in normal output. Chapter 18's secrets rule and
ADR-0020's *"the key value never appears in an error, a log line, or an event payload"* both apply
unchanged.

### 3. `KeyProvider` does not gain a write operation

**Provisioning gets its own narrow port — conceptually `KeyProvisioner` in `packages/storage`, beside
`KeyProvider` — and `KeyProvider` stays read-only.**

The interface, conceptually and not yet in code:

> One operation, taking a reference and returning whether a key was **created** or was **already
> present**, or a typed error. **Key material crosses this boundary in neither direction.** The
> caller cannot supply a key and cannot read one back; generation happens inside the implementation.

Three reasons it does not belong on `KeyProvider`:

- **Least privilege (Article V).** Every holder of a `KeyProvider` today is a reader on a startup
  path — `openStorage`, and the Guardian's issuer. Adding `setKey` widens all of them at once so that
  one command, run once, can write. The Guardian would structurally gain the ability to write key
  material, which is the exact inversion Article V forbids.
- **The Guardian declares its own copy.** [`CapabilityKeyProvider`](../../packages/guardian/src/capabilities.ts)
  is *"structurally identical … and declared here rather than imported so the Guardian does not depend
  on the storage package."* Adding a method to storage's interface either desynchronises the two or
  forces a write method into the Guardian's view of keys. Neither is acceptable, and the second is
  worse.
- **Returning no key material is only possible on a purpose-built interface.** A general key
  interface that both reads and writes cannot make that promise; a provisioner can, and it is the
  property that makes granting this capability to one command safe.

Only `friday init` constructs a `KeyProvisioner`. ADR-0020's seam is preserved: a Linux Secret Service
or age-keyfile provisioner is one more implementation, and an in-memory one serves the tests exactly
as `createInMemoryKeyProvider` does today.

**Two ports, one implementation underneath.** The provider and the provisioner are separate
*interfaces* and must not become separate *implementations of the Keychain*. Both invoke
`/usr/bin/security` against the same service, and both depend on the same invariants — the 32-byte
length, the base64 encoding, the subprocess timeout, and the mapping from a failed subprocess to a
typed `FridayError`. These live in one internal module inside `packages/storage/src/crypto/` and are
shared. Two `execFileSync` call sites that drift to different timeouts and different error codes is
the predictable outcome of not writing this down.

#### The test contract

The success path of a Keychain **write** cannot be tested the way the read path is, and the ADR says
so rather than leaving it to be discovered.

**The constraint that forces this.** `add-generic-password` cannot simultaneously keep key material
out of `argv` and target a non-default keychain. Keeping the key out of `argv` requires `-w` as the
**last** argument, with the value on stdin — sent **twice**, because the tool prompts for
confirmation. Targeting a keychain other than the login one requires a **trailing positional** path.
They are the same position, and a `-w` followed by a path silently consumes the path *as the
password*. This is not hypothetical: it is how a review session put three stray items into a real
login keychain before noticing.

So the coverage splits, and neither half may be skipped:

| Layer | How it is tested |
|---|---|
| **Everything above the Keychain** — creation-only, idempotency, the B1 refusal, ordering, reporting, error mapping | Against an **in-memory provisioner**, deterministic, injected exactly as `createInMemoryKeyProvider` is today. This is where the behaviour of this ADR lives and it must be covered exhaustively (CLAUDE.md rule 6). |
| **The Keychain implementation itself** | An integration test that **must not be able to reach the login keychain.** Isolation is by redirected `HOME`: verified that with `HOME` pointed elsewhere, `security default-keychain` reports *"A default keychain could not be found"* and `list-keychains` returns only the System keychain, so the login keychain is unreachable rather than merely unused. |

**The honest limit, and how the implementation answers it.** Under that isolation a write was
attempted and the OS refused it — *"The authorization was canceled by the user"* — so a real
Keychain write may not be exercisable in a non-interactive environment or in CI at all.

The answer is **not** a skipped test. Nothing in this repository is skipped or conditionally
skipped today, and introducing the first one here would trade a real gap for a green tick that
reads like coverage.

The answer is to keep the Keychain implementation **thin enough that almost nothing is behind the
boundary**. Argument construction, the stdin encoding (the value twice), the key-length and base64
invariants, and the mapping from a failed subprocess to a typed `FridayError` are all pure and are
unit-tested directly. What remains untestable is the `execFileSync` call itself — the same boundary
[`createKeychainKeyProvider`](../../packages/storage/src/crypto/key-provider.ts) already lives with,
and the reason ADR-0020 introduced an injected port in the first place.

So the honest statement of coverage is: **every decision this ADR makes is tested; the OS call that
carries them out is not, and cannot be, without a Keychain the test is allowed to write to.** That
sentence belongs in the test file, as a comment explaining the boundary — not as a skip.

**No test may write to the developer's login keychain under any circumstance.** The existing pattern
in [`key-provider.test.ts`](../../packages/storage/test/unit/key-provider.test.ts) — construct the
real provider against `com.friday.test.does-not-exist` — is safe only because it exercises failure.
It does not extend to a component whose success path writes, and reusing it here would be reusing the
shape without the property that made it safe.

### 4. `friday init` is a named bootstrap exception, bounded by construction

[`apps/cli/README.md`](../../apps/cli/README.md) rule 3 says *"Every command is authorized by the
Guardian, exactly like any other surface. The CLI is not a back door."* `friday init` cannot obey it,
because composing a Guardian requires a policy set and a signing key and init exists precisely
because neither exists. Asking first is not stricter here; it is impossible. Synthesising a
provisional Guardian would be worse — ADR-0033 and `POLICY_SET_EMPTY` both hold that a Guardian
whose rules did not load is *"a broken system that looks like a strict one."*

So the exception is granted, explicitly, and bounded:

**What init may create — the complete list:**

1. the directory `paths.policiesDir`, and `*.json` files copied verbatim from the shipped defaults
2. the Keychain item `capability-signing-key` under `config.keychain.service`, if absent
3. the Keychain item named by `config.keychain.fieldKeyRef`, if absent

**What init is forbidden to do:**

- open or create any database; append any event; settle any approval
- issue a capability or create a standing grant ([ADR-0034](0034-guardian-counter-writes-happen-outside-the-append-transaction.md))
- author, edit, merge, reorder, or reinterpret any rule — it copies bytes
- modify `packages/guardian/policies/`
- overwrite an existing key, or a policy directory that already holds rules
- read any key value back out, or print one

**Why this cannot become a general CLI bypass**, in the order the arguments actually bind:

- **It is creation-only, and that is a structural bound rather than a promise.** A command that can
  bring absent things into existence and cannot alter anything present cannot be used to weaken a
  FRIDAY that already exists. Every other command operates on an initialized FRIDAY, where the
  Guardian is available and rule 3 applies unchanged.
- **It cannot author permissions.** The rules it copies are the CODEOWNERS-protected,
  CI-protected shipped set the owner already reviewed in the repository. The exception cannot widen
  FRIDAY's authority beyond what was reviewed, because it cannot write a rule.
- **It writes no events**, so it cannot forge history.
- **Article X holds.** FRIDAY still cannot change her own rules. Init is run by the owner, on the
  owner's machine, before FRIDAY runs at all — and if FRIDAY's Engineering department ever proposed
  a change here, the forbidden-paths gate rejects it.

**The audit gap, stated rather than hidden.** Chapter 33 says *"Changing configuration is an audited
event."* Init's three creations are not audited, because the event log does not exist when they
happen. This is a permanent hole covering exactly one moment in FRIDAY's life.

**The reason it is deferred is the bootstrap boundary, not a missing contract.**
`system.started` already exists — [`event-types.ts`](../../packages/contracts/src/event-types.ts),
an M1 core type at `maxSensitivity: 'internal'` — and has no production publisher; every reference to
it today is a test. So nothing in `packages/contracts` stands in the way, and an earlier draft of
this ADR was wrong to say otherwise.

What stands in the way is circularity. Init cannot write to the log because one of the things it
creates is the key under which the log's private payloads are encrypted, and it cannot ask the
Guardian's permission to write because the Guardian is the other thing it creates. **An action that
brings the audit system into existence cannot be audited by it.** That is a boundary, not an
oversight, and it is where the line has to fall.

The gap is therefore bounded rather than closed: all three creations are externally inspectable
afterwards — a directory listing, and two Keychain presence checks that reveal no key material — so
what is missing is a *record* of an inspectable state, not a record of an irreversible act.

The right shape for the record is `apps/core` publishing `system.started` on its first successful
start, naming what it found provisioned. Such a record stays readable even in the failure this ADR's
§2 guard exists to prevent — **provided its publisher sets the event's sensitivity to `internal`**,
since only `private` payloads are encrypted. The type's `maxSensitivity: 'internal'` states that
intent but does not enforce it; nothing in the registry checks an event's sensitivity against its
type's ceiling today. That gap is pre-existing, is not this ADR's to close, and is noted only so the
sentence above is not read as a guarantee the code makes. **Giving `system.started` its first
production publisher is its own work** — it is a change to `apps/core`'s startup, not to init — and
it is carried as a review trigger below.

**The exception must be recorded where the rule is stated.** [`apps/cli/README.md`](../../apps/cli/README.md)
rule 3 asserts *"Every command is authorized by the Guardian … The CLI is not a back door"* without
qualification. Leaving that sentence unamended while an ADR elsewhere contradicts it is how a
documented exception becomes an undocumented one. The implementing PR amends that README in the same
diff.

### 5. Idempotency and refusal

| State on entry | What init does | Exit |
|---|---|---|
| Fresh machine — no directory, no keys | Creates the directory, copies the rules, generates both keys. Reports each. | ok |
| Both keys already present | Leaves both. Reports both as already present. | ok |
| One key present, one absent | Creates the absent one. Leaves the other. | ok |
| Policy directory absent | Creates it and copies every shipped `*.json`. | ok |
| Policy directory exists, contains no `*.json` | Copies. An empty directory carries no owner intent, nothing is overwritten, and `POLICY_SET_EMPTY` means leaving it empty leaves FRIDAY unstartable. | ok |
| Policy directory holds rules | **Leaves it untouched**, reports what it found, and still provisions keys. This is the normal second run, not a fault. | ok |
| Policy directory holds *different* rules | Identical to the row above. Init does not diff, merge, or upgrade — see below. | ok |
| Partial failure | Whatever succeeded stays. Reports exactly what was created and what was not. | problem |
| Repeated `friday init` | Creates nothing, reports everything as already present. | ok |
| **Capability key created, then field key write fails** | Capability key stays. Re-running creates the field key. In between, `apps/core` fails during the startup self-check when it tries to record a decision — the field key is read lazily at encrypt time, not at `openStorage`, so the failure names the recording rather than the key. Acceptable; the state is correct and resumable. | problem |
| **Field key created, then capability key write fails** | Field key stays. Re-running creates the capability key. In between, `apps/core` fails at `createCapabilityIssuer`, which reads at construction and names the key. The better of the two messages, by accident of where each key is read. | problem |
| **★ Field key absent, a database already exists** | **Refuses. Generates nothing.** Explains that the databases hold payloads encrypted with a key this machine does not have. Policy seeding is unaffected and still runs. | problem |
| **★ Capability key absent, a database already exists** | Creates it. A capability signing key is not a decryption key: nothing already written depends on it, tokens are short-lived, and no historical record becomes unreadable. The asymmetry with the row above is deliberate and is the reason the guard names the field key specifically. | ok |

**Init cannot tell a customised rule set from a shipped one, and must not try.** Comparing them means
deciding what a difference *means* — an owner edit, a shipped default that moved on, or a file the
owner deleted on purpose. Guessing wrong overwrites the mechanism of consent. So the populated case
is always "leave it alone and say so", and ADR-0033's upgrade-merge gap stays open and named.

**There is no `--force`, and this is the decision most likely to be argued with.** The asymmetry
settles it: the upside is saving the owner an `rm -rf` they can perform themselves, visibly, outside
FRIDAY. The downside is a flag that can silently replace the owner's authorization rules, or destroy
the field-encryption key and with it every encrypted field FRIDAY has ever written — irreversibly,
with no backup implied at this milestone. A convenience is not worth an unrecoverable failure mode.

### 6. The overlay: no

ADR-0033's review trigger asked whether init's design argues for the overlay after all. **It does
not**, and one of the three original objections has genuinely fallen away, which is worth saying
plainly rather than quietly re-asserting the conclusion.

**What changed.** ADR-0033 rejected the overlay partly because the shipped half was unreachable in a
packaged build. §1 fixes exactly that. Anyone re-reading ADR-0033 after this ADR will notice, and
should: that objection is spent.

**Why the answer is still no**, on the two objections that survive and one that init adds:

- **The runtime cost is unchanged.** An overlay means two directories at runtime, and Article II's
  question — *"which rules are in force right now?"* — gets harder to answer by looking. That was
  ADR-0033's constitutional argument and nothing here touches it.
- **The benefit is still bounded to additions.** Duplicate ids are a load failure, not an override,
  so an overlay could never let the owner change a shipped rule — only add, and additions can only
  tighten. ADR-0033 measured that benefit as *"real, but small."* It is the same size today.
- **Init makes the benefit smaller still.** The overlay's remaining value was that owner additions
  survive an upgrade. Init never re-copies over a populated directory, so it does not *create* the
  upgrade problem the overlay would solve. It declines to solve it, visibly.

And the objection that would have to be paid either way: an overlay needs `loadPolicySet` to grow an
optional-directory mode, which means changing Guardian source in the package with a 100% coverage
requirement, to make composition more convenient. ADR-0033's judgment — *"the rule that the Guardian
is not reshaped for its callers' convenience is worth more than the overlay"* — is unchanged.

**What the gap actually needs** is a reconciliation surface the owner drives: something that shows
how their rules differ from the shipped defaults and lets them take a change deliberately. That is a
different command with a different risk profile, it belongs with packaging at M4, and it is not
decided here.

## Constitutional review

- **Article I (The User):** the owner runs init, on their machine, and everything it creates is theirs
  afterwards. It never decides that a rule of theirs should change.
- **Article II (Transparency):** every creation is reported in plain language, and so is every thing
  left alone. The audit gap is named above rather than papered over — this is the one moment FRIDAY
  cannot record, and the record says so. The irreplaceability of the field key is told to the owner
  at the only moment they are certainly present, because a precaution nobody was warned about is not
  one they declined to take.
- **Article III (Approval):** the rules are the mechanism of consent (ADR-0033). Init puts the
  owner's reviewed rules where FRIDAY will obey them and is forbidden to write one of its own.
- **Article IV (Privacy):** keys are generated locally, stored only in the Keychain, and never
  written to disk, logged, or printed.
- **Article V (Security):** least privilege is the shape of the whole decision — a separate
  provisioning port so no reader gains a write, an OS-level refusal on an existing key, and no key
  material in `argv`.
- **Article VII (Reliability):** creation-only and idempotent means a failed run leaves a state a
  second run completes, and no state a second run corrupts. The §2 guard is what makes the second
  half of that sentence true: without it, one specific second run corrupts the audit trail's
  readability while reporting success.
- **Article X (Evolution):** FRIDAY cannot change her own rules. Init copies a directory the
  forbidden-paths gate already denies her.

**The five questions:**

- [x] **Can the user see it?** Yes, at the moment it happens — the command says what it created and
      what it found. Not in the audit trail, because there is none yet; that is stated in §4 and
      carried as a review trigger rather than claimed away.
- [x] **Can the user stop it?** Yes. It is a command they run deliberately, and its creation-only
      bound means declining to run it costs them nothing they cannot recover.
- [x] **Can we replace it?** Yes. The provisioner is a port in the ADR-0020 sense, and the policy
      copy is a directory-to-directory copy with no FRIDAY-specific format.
- [x] **Can we explain it?** Yes — *"it puts your rules and your keys where FRIDAY will look for
      them, and never touches either again."*
- [x] **Will this still be right in five years?** The creation-only invariant will. The *mechanism*
      is dated: packaging at M4 and a real installer will revisit how the defaults travel, and that
      is a review trigger rather than a claim of permanence.

**Notes:** The weakest part of this document is the audit gap. "The one action FRIDAY takes that she
cannot record" is uncomfortable in a system whose first principle is observability, and the
first-run record is described in §4 without being decided — the shape of deferral
[ADR-0034](0034-guardian-counter-writes-happen-outside-the-append-transaction.md) warned about:
*"writing an ADR that fixes nothing is a way of feeling responsible without being responsible."*

Two things keep it narrow. The circularity is real rather than convenient — an action that creates
the audit system's own encryption key cannot be recorded by that system. And init's creations are all
inspectable afterwards, so what is missing is a record of a *verifiable state*, not of an
irreversible act. The deferral would stop being defensible the moment init acquired a side effect
that could not be seen by looking.

## Alternatives considered

### Embed the shipped rules in the CLI as generated source

**What it is.** A build step turns `packages/guardian/policies/*.json` into a TypeScript constant
compiled into `apps/cli`. Init writes the constant out. No package resolution at all.

**Advantages.** Genuinely appealing, and the most robust against packaging: there is no path to
resolve, no `files` field to get wrong, and no way for the bytes to be missing at runtime. It needs no
change to `packages/guardian` whatsoever, which is the constraint both ADR-0033 and this ADR are
trying hardest to respect.

**Why rejected.** It creates a second copy of the most safety-critical data in the repository, and
the copy is generated, which means it is correct exactly as long as the generator runs. A stale build
artifact would seed an owner's machine with rules that no longer match the reviewed set, and nothing
at runtime could detect it — the copied rules would load perfectly. Chapter 30's rule that schemas
are *"defined once in `packages/contracts`. Never duplicated"* expresses the same instinct about a
different kind of data.

The distinction is narrower than it first looks, and overstating it would be dishonest: as §1
records, a missing `files` entry does **not** fail at resolution either. The real difference is what
the failures produce. A packaging mistake produces *no rules*, which `POLICY_SET_EMPTY` turns into a
refusal to start; a stale generated copy produces *plausible wrong rules*, which load and govern.
Both need a test to catch them at build time, and §1 requires one. Only the second can be wrong
without anything ever noticing.

### Copy the policies into `apps/cli` at build time

**What it is.** A build step copies the directory into the CLI package, which lists it in `files`.

**Advantages.** No `exports` change and no manifest change to the Guardian. The bytes ship with the
app that needs them.

**Why rejected.** The same drift as above with an additional failure mode: the copy exists on disk, so
a developer can edit it, and the edit will survive until someone reruns the build. It also couples the
CLI's build to the Guardian's directory layout without declaring the dependency anywhere a reader
would find it. The `exports` subpath is that declaration.

### Derive the directory from the resolved package entry

**What it is.** `new URL('../policies', import.meta.resolve('@friday/guardian'))`, as ADR-0033
described when reasoning about the runtime path.

**Advantages.** No `exports` change. One line.

**Why rejected.** Empirically the entry resolves to `dist/index.js`, so `../policies` is right only
while the entry sits exactly one level below the package root. That is a build-output detail nobody
promised to keep, and if it changes, this silently resolves to a directory that does not exist — or,
worse, one that does. A declared subpath is a contract; arithmetic on someone else's build layout is
not.

### Generate a minimal starter rule set instead of copying

**What it is.** Init writes a small policy set of its own — enough to start, for the owner to grow.

**Advantages.** No packaging question at all. Zero coupling.

**Why rejected.** It makes init an author of authorization rules, which is the one thing §4's
bootstrap exception must not permit. The shipped set is reviewed, CODEOWNERS-protected, and covered by
its own tests; a set invented by a command is none of those.

### Add `setKey` to `KeyProvider`

**What it is.** One interface for key material, reading and writing.

**Advantages.** Fewer concepts, and the obvious shape. ADR-0020 already anticipated generation —
*"for the moment a key has just been generated and not yet written to the Keychain"* — so the
interface arguably always expected this.

**Why rejected.** Argued in full in §3: it widens every existing reader, including the Guardian's
independently declared `CapabilityKeyProvider`, so that one command can write; and it forecloses the
property that makes provisioning safe, which is that key material crosses the provisioning boundary
in neither direction.

### Let `apps/core` self-provision on first start

**What it is.** No new command. `openContext` creates what is missing and carries on.

**Advantages.** FRIDAY starts out of the box, which is the property ADR-0033 explicitly regrets
losing and which `defaults.ts` was written to preserve.

**Why rejected.** It makes the service that decides whether actions are permitted also the thing that
creates its own rules and its own signing key, on a path that runs unattended at login. A corrupted or
half-deleted policy directory would be silently repopulated, so the owner deleting a rule would look
like a machine that healed itself. Provisioning must be a deliberate act by the owner, separable in
time and in code from the thing being provisioned.

## Consequences

**Positive**

- **FRIDAY can be started by someone who is not running the test suite** — for the first time. Every
  path in ADR-0031, ADR-0032, and ADR-0033 that has only ever run in a fixture becomes reachable.
- The M3 milestone regains a demonstrable outcome, which Chapter 39 treats as a re-scoping trigger
  rather than a nicety.
- The `exports`/`files` gap is closed with the reason recorded, so the next person to package the
  Guardian does not rediscover it as a runtime failure.
- The two `security` findings — key material in `argv`, and refusal-by-default from omitting `-U` —
  are written down where the implementer will read them, rather than being found or not found.
- **A silent data-loss path is closed before it can be walked.** The field-key guard removes a state
  in which FRIDAY starts, verifies, reports herself healthy, and cannot read a single decision she
  ever recorded — reachable today by following Chapter 34's own recovery procedure.
- The packaging assertion means the `files`/`exports` pair cannot silently regress, which is the one
  way this design could fail in the manner ADR-0033 was written to prevent.

**Negative**

- **`packages/guardian`'s manifest changes**, in a milestone where both prior ADRs made a point of
  leaving that package alone. No source or behaviour changes, but the sentence "we did not touch the
  Guardian" stops being literally true and someone will have to re-read this to know why.
- **The one unaudited moment.** Init's creations are outside the event log permanently. Mitigable
  later, not now.
- **`friday init` is a documented exception to `apps/cli` rule 3**, and exceptions are load-bearing
  precedent. The creation-only bound is what keeps it narrow, and the bound lives in a document and
  in review — no test fails if a future contributor adds a write to init.
- **No upgrade story, still.** When shipped defaults change, the owner's copy does not, and init
  will not tell them. ADR-0033 named this gap; this ADR declines to close it and therefore extends
  its life.
- **A fresh machine now needs a command run before FRIDAY works.** Zero-configuration startup, which
  `defaults.ts` was written to preserve, does not come back — it is replaced by one explicit step.
- **The field-key guard makes a real recovery harder before it makes it safer.** An owner restoring a
  database whose Keychain is genuinely gone now meets a refusal instead of a running FRIDAY. That is
  correct — the alternative is a FRIDAY that lies about her own history — but it is a worse
  experience at the worst moment, and it stays worse until Chapter 34 explains how the key is
  restored.
- **The Keychain write may end up covered only by a skipped test.** §3 requires that to be stated
  rather than hidden, but a skipped test is still an untested line in a security-critical path.

**Neutral**

- ADR-0025 is untouched. Order-independence, strictest-wins, and fail-closed are properties of
  evaluation and do not care where the files came from or who copied them.
- `paths.policiesDir`, its default, and the no-runtime-fallback rule are exactly as ADR-0033 left
  them.
- The database layout, the migration set, and every existing CLI command are unaffected.

## Reversibility

- **Cost to reverse:** low.
- **How:** the command is additive — deleting `friday init` leaves every other command working and
  returns the repository to today's state, where FRIDAY cannot start. The manifest change is two
  lines. Nothing init creates has a format that only init understands: the policy directory is JSON
  the loader already reads, and the Keychain items are two entries the owner can inspect or delete
  with `security` directly.
- **Point of no return:** none for the decision. There is one for the *data*: once FRIDAY has written
  encrypted fields under a generated field-encryption key, deleting that key destroys them
  irreversibly. That is an argument about the key's lifecycle rather than about this ADR, and it is
  the reason §5 refuses a `--force`.

## Review triggers

- **`system.started` gets its first production publisher.** The contract already exists and nothing
  publishes it. When `apps/core` does, the initialization record described in §4 should ride on it,
  and the bootstrap audit boundary should be re-read against what that makes possible.
- **Chapter 34 is amended to cover the field-encryption key.** This is the dependency §2 surfaces and
  deliberately does not solve. The chapter's recovery card does not list this key, and its
  lost-machine procedure has no step that restores it, so a by-the-book recovery today yields a
  database whose private payloads cannot be read. **That is Chapter 34's inconsistency to resolve,
  not this ADR's**, and the guard exists so the gap is met by a refusal rather than by silent loss.
- **Packaging lands (M4).** The bundle layout is the constraint this ADR reasons about without
  having, exactly as ADR-0033 said of itself. Re-examine how the defaults travel, and whether a real
  installer subsumes `friday init` entirely.
- **The shipped defaults change after the owner has a running copy.** The upgrade-merge gap. First
  time it bites is when it must be solved, and the reconciliation surface sketched in §6 is the
  shape to reach for.
- **`friday init` is asked to modify anything.** The moment it needs to overwrite, merge, or delete,
  the creation-only bound is gone and with it the argument in §4. It must then go through the
  Guardian, or a new ADR must explain why not.
- **Any second caller wants a `KeyProvisioner`.** One command holding it is what makes the write
  privilege acceptable. A second holder is a design change, not a convenience.
- **Backups or the recovery card arrive (M5).** Chapter 34 says *"The card is generated during setup,
  and setup is not considered complete until you confirm you have printed and stored it."* This ADR
  does **not** generate a recovery card — the backup key, the B2 credentials, and the passkey
  recovery codes it carries do not exist at M3. Setup is therefore incomplete by Chapter 34's
  definition, deliberately, and closing that is M5's.
- **FRIDAY runs on anything other than macOS.** The provisioner is the second implementation ADR-0020
  anticipated, and the `security` invocation is the part that does not travel.

## Notes

**On the bootstrap exception.** The uncomfortable version of this decision is: "we wrote down that
one command is allowed to skip the authorization check." That is accurate, and the mitigation is not
that the command is trustworthy — it is that the command is *incapable*. Creation-only is the whole
of the safety argument, and if a future change erodes it, the exception must be re-argued rather than
inherited.

**What this ADR does not decide.** How the owner learns they need to run `friday init` — an error
message, a runbook, an installer prompt. Today `openContext` fails with the loader's own message,
which names the missing directory but not the command that would create it. Improving that message is
implementation, not architecture, and is worth doing in the same slice.

**Uncertainty.** Three things, in the order I would bet on being wrong:

1. **The anchor file.** Resolving `@friday/guardian/policies/README.md` to find a directory is
   slightly indirect, and a purpose-built export — a tiny module that reports its own directory —
   would read better. It was rejected as more moving parts for the same result, but this is a
   judgment call and the alternative is defensible.
2. **Whether the field-encryption key belongs to init at all.** `openStorage` creates the databases
   on first run; an argument exists that it should own its own key's provisioning and init should
   only handle the Guardian's. Keeping both here means one command to run and one place to look, and
   splitting them means the two keys are provisioned by two different components for a reason nobody
   will remember.
3. **Copying `*.json` only.** The owner is expected to hand-edit these files, and the README next to
   them is the only documentation of the rule format. Leaving it behind may be the wrong call for
   usability; copying it creates a second copy of a document that will drift. I chose no-drift over
   convenience and am not confident it is right.

**Amended before implementation, after design review.** This document was reviewed against the
repository before any code was written, and the review changed it materially. Recorded because the
findings are more useful than the fact of the review:

- The **field-key-beside-an-existing-database** hazard (§2, §5) was absent from the first draft
  entirely. It was found by tracing what `verifyChain` actually reads rather than by reasoning from
  the ADRs — the same method [ADR-0034](0034-guardian-counter-writes-happen-outside-the-append-transaction.md)
  used to find its own defect, and it worked for the same reason.
- The claim that resolution fails loudly was **wrong**, and the packaging assertion in §1 exists
  because of it. `import.meta.resolve` validates the export mapping and not the file.
- The reason given for deferring the audit record was **wrong**: `system.started` already exists.
  The deferral survived; its justification was replaced.
- The Keychain test contract (§3) was missing. The `-w`-versus-positional conflict is a real API
  constraint that had already caused stray writes to a real login keychain once.

The first draft would have passed review by anyone reading it for internal consistency. It was
internally consistent and would have shipped a silent data-loss path.
