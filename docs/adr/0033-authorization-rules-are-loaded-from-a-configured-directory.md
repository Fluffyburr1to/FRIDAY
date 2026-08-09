# ADR-0033 — Authorization rules are loaded from a configured directory

- **Status:** accepted
- **Date:** 2026-08-08
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0022 — TOML for the configuration file](0022-toml-for-the-configuration-file.md),
  [ADR-0025 — Policy evaluation is order-independent and fails closed](0025-policy-evaluation-is-order-independent-and-fails-closed.md),
  [ADR-0031 — The clerk records what the Guardian decided](0031-the-clerk-records-what-the-guardian-decided.md),
  [`packages/guardian/policies/README.md`](../../packages/guardian/policies/README.md)

---

## Context

Milestone 2 shipped a Guardian that decides against a `PolicySet`, and a loader that builds one from
a directory of JSON files. Milestone 3 Slices 1 and 2 shipped the clerk that records what the
Guardian decided. **Nothing in production has ever built a `PolicySet`**, because nothing in
production has ever composed a Guardian.

Verified against `271fe8d`:

| Claim | Verified at |
|---|---|
| `loadPolicySet` is complete and tested | [`policy-set.ts:107`](../../packages/guardian/src/policy-set.ts) |
| Its only callers are tests | grep across `apps/`, `packages/`, `tests/` — every hit is a `.test.ts` or a test support file |
| `createGuardian` requires a `PolicySet` as a constructor argument | [`guardian.ts:48`](../../packages/guardian/src/guardian.ts) |
| `createGuardian` has no production caller | grep — every hit is a test |
| `FridayConfig` has **no** policies path | [`schema.ts:23`](../../packages/config/src/schema.ts) — `PathsSchema` is `dataDir`, `mainDb`, `eventsDb`, `cacheDb` |
| An empty rule set is refused, not treated as "deny everything" | [`policy-set.ts:47`](../../packages/guardian/src/policy-set.ts) — `POLICY_SET_EMPTY` |
| A duplicate rule id is a load failure, not last-one-wins | [`policy-set.ts:73`](../../packages/guardian/src/policy-set.ts) |
| A missing directory is a load failure | [`policy-set.ts:114`](../../packages/guardian/src/policy-set.ts) |

So the Guardian cannot be composed in production until something decides **where the rules come
from at runtime**. That is this decision, and it is a genuine prerequisite rather than a deferred
nicety: it is a required constructor argument with no default.

### Two things that were assumed and turn out to be false

**`packages/guardian/policies/` is not CI-protected against the owner.** The forbidden-paths gate in
[`ai-pr-rules.yml:34`](../../.github/workflows/ai-pr-rules.yml) is guarded by
`if: startsWith(github.head_ref, 'friday/')`. It rejects *FRIDAY's* branches, not the owner's. The
directory README's claim — *"These files are yours. FRIDAY may never change them."* — is exactly
accurate, and the owner's repo-time editing surface is not in question.

**The shipped directory is not part of the published package.**
[`packages/guardian/package.json`](../../packages/guardian/package.json) declares
`"files": ["dist"]`. In the pnpm workspace, `@friday/guardian` resolves to the source directory and
`../policies` exists. In anything built from the declared package contents, it does not.

That second fact is the one that decides this ADR, and it is the kind of thing that would otherwise
have shipped as a latent fault: **any runtime path that resolves the policy directory through the
`@friday/guardian` package would work perfectly in development, in CI, and in every test — and
would find no rules at all the first time FRIDAY is packaged.** Under `POLICY_SET_EMPTY` that is a
refusal to start rather than a silent permit, so it fails safe; but it fails at the worst possible
moment, on the owner's machine, for a reason nothing in the repository would have predicted.

### What we did not know when Chapter 17 was written

That "the rules live in `packages/guardian/policies/`" is a statement about **the repository**, not
about **a running FRIDAY**, and that the two need different answers. Chapter 17 and the directory
README both read as though one sentence covers both, and it does not.

## Decision

We will **load FRIDAY's authorization rules at startup from a single directory named by
configuration: `paths.policiesDir`, defaulting to `<dataDir>/policies`.**

There is no runtime fallback to the repository's shipped directory. A missing, empty, or malformed
policy directory **fails startup, non-zero**, with the loader's own message.

| Rule | |
|---|---|
| **Config key** | `paths.policiesDir`, alongside the three database paths it resembles. |
| **Default** | `<dataDir>/policies` — derived in `deriveDatabasePaths` the same way `mainDb`, `eventsDb`, and `cacheDb` are, so setting `dataDir` alone moves it with everything else. |
| **One directory, not two.** | The configured directory is the complete rule set. Nothing is overlaid on it. |
| **Order-independence is unchanged.** | ADR-0025 holds exactly as written: every `*.json` in the directory is read, every rule is evaluated, the strictest outcome wins, and file layout carries no meaning. |
| **Duplicate ids remain a load failure.** | Unchanged from [`policy-set.ts:73`](../../packages/guardian/src/policy-set.ts). |
| **Failure is fatal and loud.** | `apps/core` exits non-zero before the server listens. A FRIDAY running without her rules is not a stricter FRIDAY; it is a broken one that looks strict. |
| **`packages/guardian` is not modified.** | `loadPolicySet(directory)` already has exactly the right signature. This ADR adds a caller, not an API. |

### The owner's editing surface, stated plainly

The two surfaces are different and this is the sentence that was missing:

| | Where | Who edits it | What it is |
|---|---|---|---|
| **Shipped defaults** | `packages/guardian/policies/` | the owner, in the repository | the rules FRIDAY *ships with* — source material, reviewed like code, forbidden to FRIDAY |
| **Running rules** | `paths.policiesDir` → `<dataDir>/policies` | the owner, on the machine | the rules FRIDAY *decides against* — a real writable directory, outside any bundle |

Getting the first into the second is a copy. **That copy is `friday init`'s job and is deliberately
not in this decision.** Until `friday init` exists, the directory is populated by hand or the
configuration points somewhere that already has rules — which is the honest state of a system that
has never been installed.

### Why no overlay

Layering an owner directory on top of the shipped one was the leading alternative and is argued
below. The finding that removes most of its value: because duplicate ids are a **load failure**
rather than an override, an overlay could only ever let the owner *add* rules, never *change* a
shipped one. And since evaluation takes the strictest outcome, an added rule can only tighten. So
the overlay's entire benefit reduces to "owner additions survive an upgrade" — real, but small,
and purchased with a second directory, a merge order that must not matter but will be assumed to,
and a new loader API in the one package this slice is otherwise forbidden to touch.

## Constitutional review

- **Article II (Transparency):** a rule set assembled from two directories by precedence is harder
  to answer *"which rules are in force right now?"* about than one directory. One directory keeps
  the answer readable by looking.
- **Article III (Consent):** the rules are the mechanism of consent. That they come from a location
  the owner controls, rather than from inside a bundle FRIDAY's own updates would overwrite, is the
  substance of this decision.
- **Article X (Governance):** FRIDAY still cannot change her own rules. The configured directory is
  outside her write path, and `guardian-policy-changes-are-critical` classifies any attempt as
  `critical` with no standing grant possible.
- **Principle 7 (Explainability):** unchanged. `matchedPolicies` still names rules by id, and ids
  are still unique by construction.

**The five questions:**

- [x] **Can the user see it?** Yes — the rules are plain JSON in a directory they own, and every
      decision quotes the deciding rule's description.
- [x] **Can the user stop it?** Yes, and this is what makes stopping possible at all: the rules are
      the stop.
- [x] **Can we replace it?** Yes. `loadPolicySet` takes a directory; a future database-backed or
      signed rule source is a different implementation behind the same `PolicySet`.
- [x] **Can we explain it?** Yes.
- [x] **Will this still be right in five years?** The *config key* will. The *default location* is
      likely to be revisited when packaging lands, and that is recorded as a review trigger rather
      than pretended away.

**Notes:** The honest tension is that FRIDAY cannot start out of the box under this decision — a
fresh machine has no `<dataDir>/policies`, so startup fails. That is deliberate. The alternative is
a runtime fallback into the guardian package, which works until it is packaged and then does not,
and a system whose authorization rules load from a path that changes meaning between development
and production is worse than one that refuses to start until told where they are.

## Alternatives considered

### Resolve the shipped directory through the `@friday/guardian` package

**What it is.** `paths.policiesDir` defaults to the directory resolved from the guardian package —
`new URL('../policies', import.meta.resolve('@friday/guardian'))` or equivalent. FRIDAY starts out
of the box with her shipped rules.

**Advantages.** Genuinely strong, and the most appealing option. Zero-configuration startup, which
[`defaults.ts:9`](../../packages/config/src/defaults.ts) explicitly names as a property worth having
(*"a fresh install with no configuration at all still starts"*). It matches what every existing test
does. It needs no `friday init`.

**Why rejected.** `"files": ["dist"]`. The directory is not published, so the path exists in the
workspace and does not exist in a package. Every test would pass and the first packaged build would
find no rules. This is the same shape of fault as the `ATTACH` finding in ADR-0032 — an empirical
check that reassures because it is measuring the development configuration rather than the shipped
one — and it is recorded here so the next person to reach for it does not have to rediscover it.

Adding `policies` to `files` would fix the resolution and reintroduce the worse problem: the owner's
rules would live inside a bundle that FRIDAY's own updates replace.

### Two directories, overlaid

**What it is.** Always load the shipped directory; additionally load `paths.policiesDir` when it
exists; concatenate and build one `PolicySet`.

**Advantages.** Owner additions survive upgrades. FRIDAY always has her baseline rules, so she
starts out of the box. It is the design most systems with a config directory converge on.

**Why rejected.** Three reasons. It inherits the packaging fault above for the shipped half. Its
benefit is bounded to *additions only* by the duplicate-id refusal, as argued above. And it needs
`loadPolicySet` to grow an "optional directory" mode — the existing signature treats a missing
directory as a failure ([`policy-set.ts:114`](../../packages/guardian/src/policy-set.ts)) — which
means modifying `packages/guardian` to make composition convenient. The rule that the Guardian is
not reshaped for its callers' convenience is worth more than the overlay.

Worth stating fairly: if the shipped half were solved some other way, this would be the right
design, and the review trigger below anticipates returning to it.

### Inline the rules into the configuration file

**What it is.** A `[[policy]]` array in `friday.toml`.

**Advantages.** One file to back up. No directory to locate. ADR-0022 already establishes TOML.

**Why rejected.** It merges two things with different review requirements. Configuration is
operational — ports, paths, budgets — and changing it is routine. The rules are the mechanism of
consent, and `guardian-policy-changes-are-critical` classifies changing them as `critical`. Putting
them in the same file makes that distinction unenforceable by path, and makes "who may edit this
file" a question with two incompatible answers.

## Consequences

**Positive**

- A Guardian can be composed in production for the first time. Everything in
  [ADR-0031](0031-the-clerk-records-what-the-guardian-decided.md) and
  [ADR-0032](0032-the-guardians-state-moves-into-the-event-log-database.md) that has only ever run
  in tests becomes reachable.
- The rules live somewhere the owner owns and an upgrade does not touch.
- `packages/guardian` is unchanged — same loader, same signature, same tests.
- The packaging fault is found now, in a document, rather than on the owner's machine after M4.

**Negative**

- **FRIDAY does not start out of the box.** A fresh machine fails startup until the policy directory
  exists. This is the real cost, and it is paid until `friday init` lands. It also weakens the
  zero-configuration property `defaults.ts` was written to preserve.
- **The default points somewhere that does not exist yet.** `<dataDir>/policies` is a promise about
  a directory nothing creates. Anyone reading `defaults.ts` in isolation will assume it is populated.
- **Two locations called "the policies"** — the repo's and the runtime's — which is exactly the
  confusion this ADR exists to name, and naming it does not delete it.
- **No overlay means no upgrade merge story.** When shipped defaults change, the owner's running
  copy does not. Reconciling them is unspecified and will need one.

**Neutral**

- ADR-0025 is untouched: order-independence, strictest-wins, and fail-closed are all properties of
  evaluation, not of where the files came from.
- The `friday.db` / `events.db` / `cache.db` layout is unaffected.

## Reversibility

- **Cost to reverse:** low.
- **How:** the decision is one config key and one call site. Adding an overlay later is additive —
  a second directory whose rules are concatenated before `createPolicySet` — and does not
  invalidate any rule already written or any decision already recorded.
- **Point of no return:** none. Rules are inputs, not history. A decision already recorded in the
  log names the rule ids that applied and remains true regardless of where those rules are loaded
  from afterwards.

## Review triggers

- **`friday init` is designed.** It owns seeding `<dataDir>/policies` from the shipped defaults, and
  its design may argue for the overlay after all.
- **Packaging lands (M4).** The bundle layout is the constraint this ADR is reasoning about without
  having. Re-examine the default location then.
- **The shipped defaults change after the owner has a running copy.** That is the upgrade-merge gap,
  and the first time it bites is when it must be solved.
- **A second component needs a `PolicySet`** — the plan engine or a policy-editing surface. Loading
  the directory twice in one process would be a bug worth catching by structure.
- **Rules need to be signed or integrity-checked.** ADR-0028's chain covers events, not inputs. A
  tampered policy file is currently detectable only by reading it.

## Notes

**On the empty-set refusal.** [`policy-set.ts:47`](../../packages/guardian/src/policy-set.ts)
already refuses an empty rule set with the reasoning *"a Guardian that refuses every action because
its rules failed to load is a broken system that looks like a strict one."* That sentence is the
whole justification for making startup fatal here, and it was written a milestone before anything
could act on it.

**What this ADR does not decide.** How the capability-signing key and the field-encryption key get
into the Keychain. Composing a Guardian requires the first
([`capabilities.ts:136`](../../packages/guardian/src/capabilities.ts)) and recording a
`guardian.decided` requires the second, and **neither is provisioned by anything in the
repository** — they exist only in test fixtures. That is a separate, concrete blocker for a real
production run, it is `friday init`'s to solve, and it is deliberately not worked around here.
The correct behaviour in the meantime is the same as for a missing policy directory: fail startup
and say which key is missing.

**Uncertainty.** The default location is the weakest part of this document. `<dataDir>/policies`
puts the rules beside the databases, which is convenient for backup and wrong for a file the owner
is meant to edit by hand — `~/.config` or a visible `~/FRIDAY/policies` may read better. It is
trivially changeable before the first release and should be settled when packaging makes the
trade-off concrete rather than guessed at now.
