# ADR-0038 — The artifact is deployed flat, and carries nothing of its builder

- **Status:** proposed
- **Date:** 2026-08-12
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none — **amends [ADR-0036](0036-packaging-delivers-friday-init-provisions.md) §1**
  and extends [ADR-0037](0037-the-bundle-is-a-package-that-names-what-ships.md) §5–§6
- **Related:** [ADR-0018 — `better-sqlite3` as the SQLite driver](0018-better-sqlite3-as-the-sqlite-driver.md),
  **[ADR-0033 — Authorization rules are loaded from a configured directory](0033-authorization-rules-are-loaded-from-a-configured-directory.md)**,
  [ADR-0035 — First-run provisioning is creation-only](0035-first-run-provisioning-is-creation-only.md),
  [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md),
  `tools/scripts/release-audit.ts` and `tests/architecture/release-audit.test.ts` — the gate and its
  tests, written but **not yet merged**; they arrive with the release slice this decision unblocks

---

## Context

**The deploy mechanism this repository has accepted twice cannot produce an artifact that is free of
the machine that built it.** Not "does so awkwardly" — cannot, without rewriting what pnpm generates.

The requirement it fails is one sentence:

> A release artifact must not contain references to the build machine's filesystem, and must not
> require the build machine's filesystem in order to execute.

The second clause was already satisfied and is not in question: the bundle relocates and runs. This
ADR is about the first clause, and about the fact that satisfying it is not a matter of deleting a
few files.

### What the accepted mechanism actually produces

Built exactly as [ADR-0036 §1](0036-packaging-delivers-friday-init-provisions.md) specifies, from a
throwaway clone at a fixed staging path, and then audited over the whole tree — **eleven findings
survive, in three shapes that are all the same fact:**

| Where | Count | Example |
|---|---|---|
| Virtual-store **directory names** | 9 | `.pnpm/@friday+cli@file++++private+tmp+friday-release-build+src+apps+cli` |
| `node_modules/.bin/friday` | 1 | an absolute `NODE_PATH` into the staging tree |
| `node_modules/.package-map.json` | 1 | `"@friday/cli": "@friday/cli@file:///private/tmp/…/apps/cli"` |

**The root cause is pnpm's identity scheme, not its output.** An *injected workspace package* is
identified by the `file://` URL of the directory it came from. That identifier is what names the
virtual-store directory, what the package map records, and what the shim bakes into `NODE_PATH`. The
build path is not incidental metadata that leaked; **it is the name pnpm knows the package by.**

Everything that *is* incidental had already been removed by the time these eleven remained, each
deletion proven inert by running the artifact afterwards:

| Removed | Why it was safe |
|---|---|
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.modules.yaml`, **and a second lockfile at `.pnpm/lock.yaml`** | none is read at runtime; Node resolves through `node_modules` |
| `better-sqlite3/build/` | contains **no compiled binary** — node-gyp scaffolding from a configure step that produced nothing, because the driver ships as a prebuild. Two files carried the builder's home directory |
| `.bin/{tsc,tsserver,pino,intent}` | hard-code an absolute `NODE_PATH` and are **broken after relocation**; nothing in FRIDAY runs them — they are command-line entry points of libraries she uses as libraries |
| the manifest's `file://` specifiers | the tree is already materialised; nothing resolves through them |

So the eleven are what is left after the easy answer is exhausted.

### One of them is more than disclosure

`node_modules/.bin/friday` — the artifact's own entry point — exports an absolute `NODE_PATH` into
the staging directory. It works when relocated **by luck rather than by design**: `basedir` is
computed relatively, and Node falls through the dead `NODE_PATH` to ordinary `node_modules`
resolution. A future pnpm that leaned on that variable, or a dependency layout that needed it, would
turn a cosmetic leak into a bundle that runs only where it was made. That is the failure ADR-0033
exists to prevent, and it would arrive without any decision being taken.

### What we did not know before measuring

Whether the leak was one file or a structure. [ADR-0037 §6a](0037-the-bundle-is-a-package-that-names-what-ships.md)
predicted the root `package.json` and recorded it as a constraint on the release script. That
prediction was right about the file and wrong about the shape: the manifest is one of five places,
and the four it did not name include a second lockfile and node-gyp leftovers inside a dependency.
**A gate that checked the predicted location would have passed an artifact with four live leaks.**

---

## Decision

We will **add `--config.node-linker=hoisted` to the deploy, producing a flat `node_modules` with no
virtual store — and keep the relocation audit absolute, with no exemption for any path.**

```
pnpm --config.inject-workspace-packages=true \
     --config.node-linker=hoisted \
     deploy --filter @friday/bundle --prod <dir>
```

One flag, on the same command, in the same deploy-scoped way the injection flag is already passed.

### 1. Why this removes the leak rather than hiding it

Hoisting resolves packages into **real directories at their own names** — `node_modules/@friday/cli`
is a directory, not a symlink into a store — so there is no virtual-store entry to name after a
source path, no package map describing one, and no shim pointing at one. The identifier that carried
the build path is not rewritten; **it stops being part of the layout.**

Measured on a real artifact, after the same metadata strip described above:

| | Accepted mechanism | With `node-linker=hoisted` |
|---|---|---|
| Audit findings | **11** | **0** |
| Build-machine paths anywhere | 11 | **0** |
| Builder's home path anywhere | 0 | 0 |
| Dangling or escaping symlinks | 0 | 0 |
| `@friday/*` | symlinks into the virtual store | **real directories** |
| `.pnpm/` contents | 9 package trees | `lock.yaml` only — already stripped |
| Size | 84 MB / 20 MB compressed | 84 MB / 20 MB compressed |

### 2. The behaviour that had to survive, and did

Relocated to a path unrelated to the build directory, and executed there:

| | |
|---|---|
| `friday status --help` | exit 0 |
| `apps/core` started from the artifact | loaded its rules, created `events.db` and `friday.db` through the prebuilt native driver, stopped at the Keychain, exit 1 |
| Shipped rules | all three `*.json`, plus the `README.md` anchor |
| macOS driver prebuild | `darwin-arm64.node` present; nothing compiled at install |

**★ And the resolution ADR-0033 is about.** `friday init` locates the shipped rules with
`import.meta.resolve('@friday/guardian/policies/README.md')`. Run from inside the hoisted artifact,
that resolved to `<artifact>/node_modules/@friday/guardian/policies`, **inside the bundle**, listing
all three rules. This is checked explicitly rather than inferred from the artifact starting, because
core never exercises that path — only `init` does, and it is exactly the mechanism that "would work
perfectly in development, in CI, and in every test, and would find no rules at all the first time
FRIDAY is packaged."

### 3. This is not the flattening ADR-0036 prohibited

[ADR-0036 §1](0036-packaging-delivers-friday-init-provisions.md) says the package trees are
*"preserved rather than flattened, and that is load-bearing rather than tidy"*, and warns against
*"flattening the rules to a `share/policies/` directory"*.

**That prohibition is about moving files out of their package, and it is untouched here.**
`@friday/guardian` remains a package directory with `policies/` inside it and its `exports` map
intact; §2's resolution evidence is the proof. What changes is where packages sit relative to *each
other* — flat rather than behind a symlinked store — which is the dimension ADR-0036 was not
reasoning about. The two senses of "flat" share a word and nothing else, and the distinction is
recorded because a future reader meeting both sentences will otherwise think they conflict.

### 4. The audit stays absolute

**No exemption for the staging path, and none for anything else.** Staging at a fixed generic
location makes the leaked string a constant rather than someone's home directory, and that is worth
having — but a constant leak is still a leak, and an audit with a permitted-value list is an audit
that will grow a second entry. The gate's contract is zero, over the whole tree, checked as bytes.

### 5. What this does not change

- **The bundle root is still what is deployed** (ADR-0037 §1–§3), and `@friday/cli` still gains no
  dependency on `@friday/core`.
- **`--legacy` remains prohibited** (ADR-0036 §1). This decision is orthogonal to it: `--legacy`
  produces symlinks that *escape into the source checkout*, which the audit fails on a different
  rule and which no linker setting makes acceptable.
- **The injection flag stays deploy-scoped**, and so does this one. Neither is written into
  `pnpm-workspace.yaml`, for the reason ADR-0036 gives: it would change how every developer's build
  links its packages, permanently, for a property only the release needs.
- **Never against a working checkout** (ADR-0037 §5). Unchanged and, if anything, sharper: this is
  now two config flags whose effects a developer's workspace should never inherit.
- **Versioning.** Untouched. The tag remains authoritative, the bundle stays `0.0.0`, and the
  repository still has no tags.

---

## Constitutional review

- **Article II (Transparency):** the artifact stops carrying facts about the machine that made it,
  and the audit that proves so is a script anyone can read and a test suite that can be watched to
  fail.
- **Article IV (Privacy):** this is the Article most directly served. A release currently discloses
  the builder's directory layout; after this, it discloses nothing.
- **Article V (Least privilege):** unchanged. No root, no network, one directory.
- **Principle 10 (Simplicity Wins):** the fix is one flag. The alternative was a post-processor that
  rewrites a package manager's internal layout.

**The five questions:**

- [x] **Can the user see it?** — the audit prints every finding with a path, and refuses.
- [x] **Can the user stop it?** — unchanged; nothing here starts anything.
- [x] **Can we replace it?** — a linker setting on one command. Reversing is deleting the flag.
- [x] **Can we explain it?** — yes, and the explanation is now shorter than the one it replaces.
- [ ] **Will this still be right in five years?** — **`node-linker=hoisted` is a pnpm setting, and
      this is the third pnpm packaging contract this repository has had to reason about.** The
      unchecked box is inherited from ADR-0036 and this decision makes it slightly heavier: the
      release now depends on two pnpm config flags rather than one.

**Notes:** hoisting reintroduces the flat-`node_modules` ambiguity pnpm exists to avoid — a package
can resolve a dependency it never declared. That is a real property and it is argued below rather
than passed over; it is confined to the shipped artifact, which is not a place anyone develops.

---

## Alternatives considered

### A. Rewrite pnpm's generated layout after the deploy

**What it is.** Rename the virtual-store directories, rewrite every symlink into them, rewrite
`.bin/friday`'s `NODE_PATH`, and rewrite `.package-map.json`.

**Advantages.** Keeps the accepted mechanism exactly as written. Entirely under our control, and the
audit would pass.

**Why rejected.** It is a post-processor for another tool's internal layout, and its failure mode is
the worst available: a missed reference produces a bundle that is *mostly* rewritten, passes an audit
that checks the things we thought of, and breaks somewhere specific on a machine we do not have.
**The correctness of the artifact would rest on our having enumerated pnpm's internals correctly**,
re-verified on every pnpm upgrade, with no upstream contract to hold it to. The instruction covering
this work named it directly — determine whether the paths are required before touching them, and do
not invent a workaround — and having determined that they *are* required by the layout as generated,
the honest conclusion is to change what is generated rather than to edit it afterwards.

### B. Exempt the staging path from the audit

**What it is.** Keep the accepted mechanism; teach the gate that `/tmp/friday-release-build` is
acceptable because it is a fixed, generic, ephemeral path identical on every machine.

**Advantages.** No mechanism change, no new pnpm behaviour to depend on, and the practical
disclosure is nil — the string reveals nothing about the builder.

**Why rejected.** It is the smallest possible weakening of the only gate standing between a bundle
and the owner's machine, and gates do not stay at one exemption. The argument for it — "this
particular path is harmless" — is available for the next path too, and each time it will be true.
**A contract of zero is enforceable by anyone; a contract of zero-plus-a-list requires judgment at
every future change.** It also leaves the `.bin/friday` `NODE_PATH` in place, which §Context argues
is a latent correctness problem rather than a cosmetic one.

### C. Bundle the runtime into a single executable

**What it is.** Node's SEA feature, or a bundler, producing one self-contained `friday`.

**Advantages.** No `node_modules` at all, so the entire class of problem disappears — along with
ADR-0036's runtime-version weakness.

**Why rejected, for now.** Unchanged from [ADR-0036 Alternative D](0036-packaging-delivers-friday-init-provisions.md):
`better-sqlite3` is a native addon, and native addons inside a single executable are the awkward case
for every approach. It remains the alternative most likely to be adopted later, and this decision
does not obstruct it — a hoisted tree is if anything an easier input to a bundler than a symlinked
store.

### D. Vendor the workspace packages by hand

**What it is.** Copy `@friday/*` into the artifact ourselves and let pnpm deploy only third-party
dependencies.

**Advantages.** Total control over how our own packages appear, with no injected-workspace identity
to leak.

**Why rejected.** It splits responsibility for the artifact's contents between pnpm and us, which is
how the original defect happened — something was assembled by a mechanism nobody was reading. It also
re-poses every question ADR-0037 just answered about what ships, and answers them in a script instead
of a manifest.

---

## Consequences

**Positive**

- The artifact carries nothing of the machine that built it — measured, not argued.
- `.bin/friday` stops depending on luck. Its `NODE_PATH` no longer points anywhere that must not
  matter.
- The audit can hold a contract of **zero**, which is a rule that needs no judgment to apply.
- Fewer moving parts in the shipped tree: no virtual store, no package map, no symlink layer.
- A hoisted tree is a better input to any future single-executable or `.pkg` work.

**Negative**

- **The release now depends on two pnpm configuration flags rather than one**, on a tool that has
  changed its deploy contract twice already. The blast radius of a third change is larger.
- **Hoisting reintroduces phantom dependencies inside the artifact.** A flat `node_modules` lets a
  package resolve something it never declared. This is confined to the shipped tree — the workspace
  keeps `nodeLinker: isolated`, and nobody develops against the artifact — but it means a
  dependency-declaration bug that the workspace would catch could still be latent in a release.
- **The two senses of "flat" now both appear in the record**, one prohibited and one required. §3
  exists because of that, and a reader who meets ADR-0036 §1 first will need it.
- **The artifact's layout changes shape**, so anything that learned the old one — nothing today
  except the audit and the plist that does not exist yet — must be re-checked when it arrives.

**Neutral**

- Size is unchanged: 84 MB on disk, 20 MB compressed, either way.
- The metadata strip in the release script is still required. Hoisting removes the structural
  residue, not the lockfiles and the node-gyp leftovers.
- `.pnpm/` still exists in the output, containing only `lock.yaml`, which the strip already removes.

---

## Reversibility

- **Cost to reverse:** low.
- **How:** delete the flag. The artifact returns to a symlinked store, and the audit begins failing
  again with the eleven findings above — which is the correct behaviour for a decision that has been
  withdrawn, and is why the gate is worth more than the flag.
- **Point of no return:** none here. It arrives with ADR-0036's remote update channel, when an
  installed copy fetches its successor and the layout becomes a contract with copies in the field.

---

## Review triggers

- **pnpm changes its deploy or linker contract again.** The third time; assume a fourth. The audit is
  what should catch it, and if a broken release catches it first, the audit was in the wrong place.
- **A phantom-dependency bug reaches a release.** The negative consequence above, becoming real —
  reconsider whether the artifact should be built from an explicitly vendored tree (Alternative D).
- **`node-linker` is wanted repository-wide** rather than for the duration of the deploy. Same
  reasoning as ADR-0036's injection flag: that is a change to this decision, not a convenience.
- **The audit is proposed to accept any path at all.** §4 is the whole value of this ADR over
  Alternative B; an exemption reopens it.
- **A single-executable artifact is attempted** (ADR-0036 Alternative D). This decision becomes moot
  rather than wrong.
- **`import.meta.resolve` stops finding the shipped rules from a packaged copy.** The ADR-0033
  failure mode, in the layout this ADR introduces.

---

## Implications for the accepted record

**Neither ADR-0036 nor ADR-0037 is edited.** The repository's process is explicit — accepted ADRs are
permanent and immutable, and a decision that changes is carried by a new ADR with the old one's
`Status` line annotated, which is the pattern ADR-0035 used for ADR-0033 and ADR-0037 used for
ADR-0036.

| Document | Effect |
|---|---|
| **ADR-0036 §1** | The deploy command gains one flag. The bundle layout, the installed prefix, the versioning, the `friday init` boundary, §8's list of what packaging may not own, and the `--legacy` prohibition all stand. Its "preserved rather than flattened" rule is **reaffirmed**, not relaxed — §3. |
| **ADR-0037 §1–§4** | Untouched. The bundle root is still what is deployed and the CLI boundary is unchanged. |
| **ADR-0037 §6a** | **Answered and superseded in substance.** It carried the build-machine paths as a constraint on the release script, expecting a manifest rewrite. This ADR establishes that stripping cannot reach the structural residue and changes the mechanism instead. |
| **ADR-0037 §6b** | Unchanged. The tag stays authoritative; nothing here touches versioning. |
| **ADR-0037 §5** | Reinforced. Two deploy-scoped flags now, and still never a working checkout. |

If accepted, 0036's and 0037's `Status` lines are annotated to point here, the index is updated, and
nothing else in either document is touched.

---

## Notes

**How this was established.** Every number above was produced by building both artifacts from the
same commit in an isolated clone, stripping both identically, auditing both over the whole tree,
archiving both, extracting both to unrelated paths, and running both. Nothing here is a reading of
pnpm's documentation.

**The audit found a hole in itself while being written.** Its first version checked file contents and
directory names for the literal build path — and pnpm spells paths with `+` in virtual-store names,
so the check was blind to the exact leak it existed for. A planted fixture caught it. That is
recorded because it is the argument for testing a gate rather than trusting one: the gate was written
by someone who had already seen the leak, and it still missed it.

**Uncertainty**, in the order I would bet on being wrong:

1. **Phantom dependencies.** Hoisting makes the artifact's resolution more permissive than the
   workspace's, so the thing we ship is, in one specific way, not the thing we tested. I judge the
   risk low because the packages are the same bytes and the workspace remains strict — but it is a
   genuine divergence between test and release, and this project has been bitten precisely there
   before.
2. **Depending on a second pnpm flag.** Alternative A avoids that by depending on our own
   post-processor instead, which I consider strictly worse, but it is a real trade rather than an
   obvious one.
3. **That zero is the right contract.** Alternative B is not foolish, and someone could reasonably
   hold that a fixed ephemeral staging path is not "the build machine's filesystem" in any sense
   worth failing a release over. I have taken the strict reading because it is the one that needs no
   arguing later.

**What would make this ADR better** is a second machine. Every claim about the artifact being free of
its builder has been checked on the machine that built it, which is the one place the question is
hardest to see. ADR-0036 already carries "a build travels to a machine that did not produce it" as a
review trigger; this decision is a reason to reach it sooner.
