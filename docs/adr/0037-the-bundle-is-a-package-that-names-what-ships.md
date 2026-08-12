# ADR-0037 — The bundle is a package that names what ships

- **Status:** accepted
- **Date:** 2026-08-11
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** **[ADR-0036 — Packaging delivers; `friday init` provisions](0036-packaging-delivers-friday-init-provisions.md)**,
  [ADR-0017 — Shared tool configuration packages](0017-shared-tool-configuration-packages.md),
  [ADR-0018 — `better-sqlite3` as the SQLite driver](0018-better-sqlite3-as-the-sqlite-driver.md),
  [ADR-0033 — Authorization rules are loaded from a configured directory](0033-authorization-rules-are-loaded-from-a-configured-directory.md),
  [Chapter 03 — Repository Structure](../01-bible/03-repository-structure.md),
  [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md),
  [`apps/cli/src/index.ts`](../../apps/cli/src/index.ts),
  [`apps/core/src/index.ts`](../../apps/core/src/index.ts)

---

## Context

**The packaging mechanism ADR-0036 accepted produces an artifact that cannot run FRIDAY.**

ADR-0036 §1 names one command, and it is exact:

```
pnpm --config.inject-workspace-packages=true deploy --filter @friday/cli --prod <dir>
```

It was verified before acceptance, and everything that ADR claims about it is true. What was not
checked is what the filter *excludes*. Run on this repository, that command produces a bundle
containing `config`, `contracts`, `guardian`, `kernel`, `storage`, and `telemetry` — and **no
`@friday/core`.**

`@friday/core` is not in `@friday/cli`'s dependency graph. Nothing puts it there: the only package
that depends on core is `apps/web`, and it imports one type. Meanwhile the LaunchAgent that the same
milestone installs exists for exactly one purpose — Chapter 33 and
[`infra/launchd/README.md`](../../infra/launchd/README.md) both say it, and ADR-0036's own context
says it in the list of things the repository cannot yet do: *"keeps `apps/core` running."*

So the artifact ships the command-line client and omits FRIDAY herself. `friday service install`
would have no program to point its `ProgramArguments` at.

This is the same class of error ADR-0036 already caught in itself once — *"It was internally
consistent and named a build command that does not work"* — and it survived for the same reason: the
command succeeds. There is no error to notice. You get a bundle, it is 58 MB, it contains a working
`friday`, and the thing it is missing is the thing nobody types.

### What constrains the answer

| Constraint | Source |
|---|---|
| **`@friday/cli` must not depend on `@friday/core`** | [`apps/cli/src/index.ts`](../../apps/cli/src/index.ts): the recovery commands *"are reached for precisely when the dashboard, the departments, and possibly the kernel are unavailable. That rules out depending on any of them."* |
| The artifact must contain **both** the CLI and the core runtime | Chapter 33; ADR-0036 §5 |
| **One coherent dependency tree**, not two deploys with duplicated shared packages | This ADR's brief; and ADR-0036 §1's "genuine directory tree" requirement |
| The artifact must work **after being copied or extracted elsewhere** | ADR-0033's failure mode; ADR-0036 §1's prohibition of `--legacy` |
| Packaging must not become a **runtime architectural dependency** | ADR-0036 §8 |
| A package may never import from `apps/` | [Chapter 03](../01-bible/03-repository-structure.md); enforced by `dependency-cruiser` |
| `packages/guardian/policies/*.json` must resolve through the `exports` subpath **from the installed copy** | ADR-0033, ADR-0035 §1 |

### What we did not know before validating

Whether a package whose only content is a dependency list would behave like a package at all — to
`pnpm deploy`, to `dependency-cruiser`, and to Node's resolver inside the extracted result. All three
answered yes, and all three were obtained by building one and running it rather than by reasoning
about it.

Doing so also uncovered a defect in `apps/core` that had nothing to do with this decision and would
have stopped any bundle running. It is fixed separately and recorded in §4, which decides nothing.

---

## Decision

We will **add a private, source-free workspace package whose `dependencies` are `@friday/cli` and
`@friday/core`, and deploy that package to produce the artifact.**

The organizing rule:

> **The bundle root is a manifest, not a component.** It declares what ships. It contains no source,
> exports nothing, is imported by nothing, and has no place in the dependency graph FRIDAY runs on.
> Deleting it breaks the release script and nothing else.

### 1. Where it lives

`packaging/bundle/`, with `packaging/*` added to `pnpm-workspace.yaml`.

A new top-level directory rather than a home in an existing one, because both existing candidates
require a reader to disregard a charter they can see:

| | Why not |
|---|---|
| `packages/bundle` | *"A package may never import from `apps/`"* — Chapter 03, enforced. Even though this package imports nothing, its manifest names two apps, and a rule that is true only on a technicality is a rule that stops being read. |
| `apps/bundle` | `apps/README.md`: *"Each app has an entry point, a lifecycle, and a process"* and *"Nothing imports from an app."* The bundle root has none of the first three and depends on two apps. |
| `tools/bundle` | `tools/README.md`: **"None of this ships. No runtime code imports from here."** The bundle root is the one thing in the repository whose whole purpose is to ship. |

`packaging/` is honest about what it holds: **the description of an artifact, which is neither a
library, an application, nor development machinery.** It is one directory with one entry, and it is
expected to stay that way.

### 2. What it depends on, and what that costs

`@friday/cli` and `@friday/core`, both `workspace:*`, both production dependencies. Nothing else.

**It has no `devDependencies`, no `scripts`, no `src/`, and no `tsconfig.json`.** It is not built, not
typechecked, and not tested, because there is nothing in it to build, typecheck, or test.

**The direction of the dependency is what keeps the CLI boundary intact.** The bundle root depends on
the CLI; the CLI does not depend on the bundle root, and gains no new dependency of any kind. The
CLI's recovery commands keep working when core is broken, absent, or uninstalled, because nothing
about their code changed. What is being described here is *co-location in an archive*, which is not a
dependency in any sense the CLI's constraint was written about.

### 3. What it exposes

Nothing of its own. The executable comes from `@friday/cli`'s existing `bin` entry, which the deploy
materialises at `node_modules/.bin/friday` — verified running from an extracted copy. `apps/core` is
started by absolute path into the tree, which is what the generated plist is for (ADR-0036 §5).

**The bundle root does not gain a `bin` of its own**, and it must not: an executable there would be a
packaging artifact with runtime behaviour, which is the line ADR-0036 §8 draws.

### 4. A prerequisite found during validation — not a reason for this decision

**This section decides nothing.** It records a runtime defect that validating the bundle root
uncovered, because the bundle cannot be shown to work without it and because the next reader deserves
to know why the evidence in the Notes was gathered in two passes.

**It is resolved independently, and this ADR does not depend on it.** The fix is in
[PR #28](https://github.com/Fluffyburr1to/FRIDAY/pull/28) — a two-line change to `apps/core` with its
own regression coverage, on its own branch, argued on its own terms. Accepting or rejecting this ADR
does not change it, and it lands whether or not the bundle root ever exists. **Nothing in §1–§3 or §5
rests on it**: the architecture below is argued from the CLI's independence, from the cost of two
dependency trees, and from what the deploy mechanism actually produces. Had the defect never existed,
every decision in this document would be identical.

What it does establish is why the decision could not have been taken on paper. That belongs in the
record, and nowhere else in the record would hold it.

**The defect.** `apps/core` does not start when it is reached through a symlink, which is how every
pnpm-installed copy reaches it.

[`apps/core/src/index.ts`](../../apps/core/src/index.ts) guards its entry point like this:

```ts
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
```

In the workspace those two strings agree. In an installed bundle they cannot: `node_modules/@friday/core`
is a symlink into the virtual store, Node resolves `import.meta.url` to the real path, and
`process.argv[1]` stays the path that was typed. Observed, from the extracted bundle:

```
argv[1]  : …/extracted/node_modules/@friday/core/dist/index.js
realpath : …/extracted/node_modules/.pnpm/@friday+core@file++++…/node_modules/@friday/core/dist/index.js
equal?   : false
```

**The consequence is the worst shape a failure can have.** `main()` is never called, the process
exits **0** immediately, and nothing is written to any stream. Under the supervision ADR-0036
installs — `RunAtLoad`, `KeepAlive` unconditional, `ThrottleInterval 10` — that is a FRIDAY who
relaunches silently every ten seconds, forever, reporting success each time. The owner sees an
installed agent, `launchctl` shows no failures, and she has never once run. No log says anything,
because the code that opens the log is never reached.

`apps/cli` does not have this bug: it already uses `import.meta.main`, Node 24's replacement for
precisely this comparison, and that is why the CLI ran from the extraction on the first attempt. The
fix is therefore **to match the file next door** — CLAUDE.md rule 1, not an architectural choice, and
the reason it needed no ADR of its own.

With that substitution in place, a bundle built from the fixed source and extracted elsewhere started
core with no hand-patching: it loaded its rules, created both databases through the
`better-sqlite3` prebuild, and stopped at the Keychain exactly where it should.

**What this section is evidence for** is the method, not the architecture: a document arguing that
the bundle root produces a *runnable* artifact, written without building one, would have been wrong —
and wrong in a way that reached a machine.

### 5. How the artifact is produced

The deploy runs against **an isolated checkout, never the developer's working tree.**

This is not tidiness. `pnpm deploy --prod` leaves the workspace it ran in marked as production-only,
and the next ordinary `pnpm` command in that workspace offers to prune every development dependency —
which, during this milestone's work, is exactly what happened: `vitest`, `typescript`, and `biome`
were removed from a live checkout and had to be reinstalled from the lockfile.

`tools/scripts/release.ts` therefore packages from a throwaway clone. The mechanism is
implementation's to choose; **that it is not the working tree is the decision.**

### 6. Two inherited packaging risks, carried as implementation constraints

Both are **properties of the deploy mechanism ADR-0036 already accepted**, observed during this
validation and unaddressed there. Neither is caused by the bundle root, neither is solved here, and
neither should be solved opportunistically — they are recorded so the release script meets them
deliberately rather than discovering them.

**a. The shipped manifest carries the build machine's absolute paths.** `pnpm deploy` rewrites
workspace dependencies to `file://` URLs into the checkout it built from:

```json
"@friday/cli": "@friday/cli@file:///Users/tyler/Projects/friday/apps/cli"
```

ADR-0036's own cli-only bundle does this for six packages; the bundle root reduces it to two, which is
incidental rather than a reason to prefer it. It is **inert** — the tree is already materialised and
nothing re-resolves it — so this is not a defect today. It is two things worth naming: the artifact
discloses the builder's directory layout, and `pnpm install` run inside an installed bundle would
chase paths that do not exist on that machine. The constraint on `release.ts` is to **decide, and
record, whether it rewrites or strips these** rather than shipping whatever pnpm emitted. The same
applies to the `pnpm-lock.yaml` and `pnpm-workspace.yaml` that land in the bundle root as residue.

**b. Two things now claim to be the version.** ADR-0036 §6 makes **a git tag plus a `CHANGELOG.md`
entry** the release, and the bundle root necessarily carries a `version` field of its own. They can
disagree, and nothing detects it. The constraint is that **the tag remains authoritative and
`release.ts` derives the manifest's version from it** — the manifest states what the artifact
contains, not what it is called. If that ordering is ever inverted, ADR-0036 §6 is being amended and
needs to say so.

### 7. What this does not change

- **ADR-0036 stands.** Its bundle layout, its installed prefix, its versioning, its
  `friday init` boundary, its §8 list of what packaging may not own, and its prohibition of
  `--legacy` are all reaffirmed. The injection flag stays deploy-scoped.
- **The deploy filter changes from `@friday/cli` to the bundle root.** That is the only amendment
  ADR-0036 needs. §6 adds constraints on the release script and reaffirms ADR-0036 §6's tag as
  authoritative; neither changes a decision that ADR took.
- **`apps/core`'s entry point is not this ADR's to change** (§4). It is fixed independently, and this
  decision would read identically if it had never been broken.
- **No runtime code learns that it is in a bundle.** `deriveDatabasePaths` still owns the default
  policy directory; nothing reads an install path except the generated plist.

---

## Constitutional review

- **Article II (Transparency):** unchanged by this decision, and improved by §4 — a FRIDAY that
  silently never starts is the most opaque failure this system could have, and it would have shipped.
- **Article III (Control):** nothing here starts anything. The bundle root is inert.
- **Article IV (Privacy):** no network, no registry, no egress. See the negative consequence about
  build-machine paths in the manifest.
- **Article V (Least privilege):** unchanged; no root, no new capability.
- **Principle 10 (Simplicity Wins):** the package is six lines of JSON with no code in it.

**The five questions:**

- [x] **Can the user see it?** — `packaging/bundle/package.json` is the shortest possible statement of
      what is in the artifact, and it is diffable. This is better than the answer it replaces, where
      what shipped was a consequence of a dependency graph nobody was reading.
- [x] **Can the user stop it?** — unchanged; ADR-0036 §5 owns this.
- [x] **Can we replace it?** — deleting the directory and restoring the old filter reverses it.
- [x] **Can we explain it?** — yes. The artifact contains what one file says it contains.
- [ ] **Will this still be right in five years?** — the *shape* yes; **`pnpm deploy` as the mechanism,
      unknown.** ADR-0036 already notes this is the second pnpm deploy contract in two major
      versions. That unchecked box is inherited, not introduced.

**Notes:** the unchecked box is ADR-0036's, restated rather than re-argued.

---

## Alternatives considered

### A. Make `@friday/cli` depend on `@friday/core`

**What it is.** One line in `apps/cli/package.json`. The existing filter then pulls core in and
nothing else changes.

**Advantages.** The smallest possible diff, by a wide margin. No new directory, no workspace glob, no
new concept, and ADR-0036 §1 stays true as written.

**Why rejected.** It destroys the property the CLI exists for.
[`apps/cli/src/index.ts`](../../apps/cli/src/index.ts) states the constraint in the file itself: the
recovery commands are reached for *"precisely when the dashboard, the departments, and possibly the
kernel are unavailable,"* and *"every dependency this app carries is one more thing that can be the
reason it will not start."* `friday panic --revoke-all` and `friday restore` would begin loading
core's dependency graph — tRPC, the clerk, the server — to run a command whose entire purpose is to
work when those are broken. The cost is invisible until the day it is total.

### B. Two deploys, assembled into one tree

**What it is.** Deploy `@friday/cli` and `@friday/core` separately into `lib/cli/` and `lib/core/`.

**Advantages.** No new workspace package at all, and each half is independently self-contained and
independently verifiable. Genuinely simple to reason about.

**Why rejected.** It duplicates every shared dependency — `guardian`, `storage`, `kernel`, `contracts`,
`config`, and the whole `better-sqlite3` prebuild set — in two copies that are *separately resolved*.
Measured: the single tree is **84 MB**, against roughly **118 MB** for the pair. Size is the least of
it. Two copies of `packages/guardian` means two copies of the authorization rules in one artifact,
and `friday init` resolving *whichever one the CLI's tree contains* — so the rules the owner is
seeded with and the rules core enforces are, by construction, different files that nothing compares.
ADR-0033 exists because of a failure of exactly this shape.

### C. Synthesise the bundle root at release time, and never commit it

**What it is.** `release.ts` writes a temporary `package.json` into its throwaway clone, deploys it,
and discards it. No new directory, no workspace glob, nothing in `git`.

**Advantages.** The smallest permanent footprint of any option — the repository gains nothing at all,
and the packaging concern lives entirely in the script that has it. It composes perfectly with §5's
isolated checkout, since the script is already building a scratch workspace.

**Why rejected, and it was close.** What ships would be a fact about a script rather than a reviewable
file, and this ADR exists because *what shipped was a consequence nobody was reading*. Committing the
manifest is what makes "core is in the artifact" a line in a diff that a human approves, which is the
whole of CLAUDE.md rule 9 and the reason the owner can evaluate this milestone without reading code.
**Reconsider if `packaging/` ever holds more than this one entry** — at that point it is
infrastructure, and infrastructure in a script is worse than infrastructure in a directory.

### D. Leave ADR-0036's filter alone and start core through the CLI

**What it is.** Add a `friday serve` subcommand that runs core in-process; the plist runs `friday serve`.

**Advantages.** One artifact, one entry point, one thing on the `PATH`, and the plist becomes trivial.

**Why rejected.** It is Alternative A wearing a subcommand — the CLI would have to depend on core to
run it, with the same consequence, plus it puts the always-running service behind the binary reserved
for recovery. A `friday` that cannot start because core's dependency graph is broken is a `friday`
that cannot run `friday panic`.

---

## Consequences

**Positive**

- The artifact contains FRIDAY. This is the first version of the packaging design of which that is
  true.
- What ships is stated in one short file, rather than being an emergent property of a dependency
  graph — which is what let this defect exist.
- One dependency tree, so exactly one copy of the authorization rules, one `better-sqlite3`, and one
  answer to what `friday init` seeds from.
- 84 MB installed and 20 MB compressed, against roughly 118 MB for the two-deploy alternative.
- The CLI's independence is preserved exactly as written, and is now recorded as a constraint with an
  ADR behind it rather than as a comment in one file.
- Validating this decision by building it, rather than arguing it, is what surfaced the runtime defect
  in §4 — before installation rather than after. That is a property of the method, not of the
  architecture, and it is claimed as no more than that.

**Negative**

- **A new top-level directory, and Chapter 03's repository tree becomes stale until amended.** This is
  the real cost: the Bible describes the layout, and this changes the layout. It is
  **[an open acceptance question](#open-questions-for-acceptance), not something done here** — the
  amendment follows acceptance rather than preceding it, and the Bible is not edited quietly either
  way.
- **A workspace package that exists for the build system.** Every reader of `packaging/bundle` will
  wonder what it does, and its README is the only thing that will tell them. A package with no code is
  a thing this repository has not had before.
- **Two inherited risks from the deploy mechanism become live** — build-machine paths in the shipped
  manifest, and a second thing claiming to be the version. Both are ADR-0036's, both are unaddressed
  there, and both are carried as constraints on `release.ts` in **§6** rather than solved here.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` land in the bundle root as build residue. Harmless,
  untidy, and the release script's to remove (§6a).

**Neutral**

- `check-docs.mjs` will require a `README.md` in `packaging/` and in `packaging/bundle/`. Correct, and
  the reason the boundary question above gets answered in prose where a reader will find it.
- `dependency-cruiser` is unaffected — verified, 0 violations, because a package with no source
  contributes no edges.
- The turbo pipeline gains a package with no tasks.

---

## Reversibility

- **Cost to reverse:** low.
- **How:** delete `packaging/`, remove the `packaging/*` glob, and point the deploy filter back at
  `@friday/cli`. Nothing imports it, nothing is generated from it, and no runtime code refers to it.
- **Point of no return:** none. It is inherited from ADR-0036 — the artifact format becomes a contract
  when a remote update channel exists, and not before.

---

## Open questions for acceptance

**These are for the decider, not for the implementation.** Each is answerable without reopening the
decision, and each has a default that is followed if nothing is said.

**1. Does `packaging/` become part of the documented repository tree, and when?**

Accepting §1 adds a top-level directory that [Chapter 03](../01-bible/03-repository-structure.md)'s
tree does not list. That chapter is the Bible's description of the layout, so the layout and its
description disagree from the moment this is accepted until the chapter is amended.

**It is deliberately not amended in advance.** Editing the Bible to match a proposal that has not been
accepted would make the record assert something that was not yet true, and Chapter 03 already treats
`tools/` as *"a pattern rather than a fixed list"* — this asks whether the same latitude extends to a
new sibling, or whether a new top-level directory is a change the chapter must state explicitly.

*Default if unanswered:* the amendment is a separate documentation change, made **after** acceptance
and before `packaging/bundle` is created, so the tree is never wrong in a committed state for longer
than one PR.

**2. If the Chapter 03 amendment is unwanted, is `tools/bundle` accepted instead?**

`tools/` needs no glob and no tree change, at the cost of a one-line qualification to
`tools/README.md`'s *"None of this ships."* §1 argues that is the worse trade, because a charter a
reader is asked to disregard stops being read — but the argument is about legibility, not correctness,
and **nothing else in this document changes if the answer is `tools/`.** The package, its
dependencies, its emptiness, the deploy filter, and every consequence are identical.

*Default if unanswered:* `packaging/`, as decided in §1.

**3. Is `release.ts` required to strip the build-machine paths (§6a), or merely to record the choice?**

Stripping is a rewrite of a manifest that pnpm generated, which is a small amount of machinery to
maintain against a tool that has changed its deploy contract twice. Leaving them is inert today and
discloses the builder's directory layout.

*Default if unanswered:* strip them, and the residue files with them — the artifact should not carry
facts about the machine that built it.

---

## Review triggers

- **`packaging/` acquires a second entry.** Alternative C becomes the better answer, because the
  argument for committing the manifest was that there is exactly one and it is short.
- **The bundle root is given a `bin`, a script, or any source file.** It has stopped being a manifest
  and is now a component, which is a different decision with different boundary consequences.
- **`apps/cli` is proposed to depend on `@friday/core` for any reason.** Alternative A, which this ADR
  rejected on the CLI's own stated grounds.
- **A second artifact is needed** — a core-only server bundle, or a separate CLI download. The
  one-tree argument was made for one artifact.
- **pnpm changes its deploy contract again.** Inherited from ADR-0036 and now load-bearing in a second
  place: the injected `file://` rewriting and the symlinked virtual store are both behaviours this
  decision was validated against, on pnpm 11.20.0.
- **Node changes `import.meta.main`.** §4's fix depends on it, and it is newer than the code it
  replaces.
- **An installed bundle is ever `pnpm install`ed in place.** The build-machine paths in the manifest
  become live rather than inert.

---

## Notes

**On what was validated, and how.** Every claim above was obtained by building the thing, in an
isolated clone of `main` at `4d6ea42`, never in the working tree:

| Checked | Result |
|---|---|
| `pnpm deploy --filter @friday/bundle --prod` | exit 0 |
| Bundle contains both apps | `node_modules/@friday/{cli,core}` present |
| Executable | `node_modules/.bin/friday` present and executable |
| Guardian rules | all three `*.json` present, plus the `README.md` anchor |
| `better-sqlite3` | `darwin-arm64` prebuild carried; nothing compiled at install |
| Symlinks | none dangling, before or after extraction |
| Size | 84 MB on disk, 20 MB compressed |
| Extracted at a different path | `friday --help` ran |
| Policy resolution from the extracted copy | `import.meta.resolve('@friday/guardian/policies/README.md')` resolved **inside the bundle** and listed all three rules |
| `apps/core` from the extracted copy, first pass | **exited 0 doing nothing** — §4 |
| `dependency-cruiser` | 0 violations |
| `check-docs` | fails until two `README.md` files exist |

**Re-validated after the §4 defect was fixed**, from source rather than by patching the extraction: a
bundle built from a tree carrying [PR #28](https://github.com/Fluffyburr1to/FRIDAY/pull/28), tarred,
extracted at a different path, and started with no intervention — core loaded its rules, created
`events.db` and `friday.db` through the prebuilt native driver, stopped at the Keychain, and exited
**1**. That is the end-to-end evidence this ADR rests on; the first pass is kept above because a table
that showed only the successful run would hide how it was found.

**An unrelated confirmation, recorded because it was observed rather than argued.** On the first pass
the extracted core exited **2** on a Keychain failure — the mismatch Chapter 39 carries as an M4 risk,
seen from a real bundle rather than read out of the source. PR #28 carries that fix too, which is why
the re-validated run above exits 1.

**What the locked-Keychain message actually says**, since this run produced it from an installed copy
for the first time:

> FRIDAY could not read the key "capability-signing-key" from your Keychain.

Chapter 39 predicted this would *"name a key rather than a timing problem"*, and it does. That is the
launchd work's to fix and is not reopened here.

**Uncertainty**, in the order I would bet on being wrong:

1. **`packaging/` as a new top-level directory.** It costs a Bible amendment, and `tools/bundle` with
   a one-line qualification to that folder's README would have cost nothing. I weighted "no reader is
   asked to ignore a charter" above "no Bible edit"; someone could reasonably weigh it the other way,
   and if the answer is `tools/`, nothing else in this document changes. Carried as
   [acceptance questions 1 and 2](#open-questions-for-acceptance) rather than settled here.
2. **Committing the manifest rather than synthesising it (Alternative C).** The argument is about
   reviewability, not mechanism, and reviewability arguments are the easiest to overstate. If
   `release.ts` ends up complex enough to need its own tests, the temporary manifest stops looking
   like a hidden fact and starts looking like an implementation detail.
3. **That one tree is worth a new package at all.** Alternative B is cruder and works, and 34 MB is
   not a real cost on a laptop. The rules-duplication argument is the one that decided it, and it is
   a hazard I reasoned about rather than observed.

**What would have made this ADR better** was validating the *installed* artifact rather than the
*built* one. Extraction and a manual start are not `friday service install` followed by a logout —
the plist, the login-session environment, and the locked-Keychain race are all still reasoned about.
§4 is the evidence that the difference between building a thing and running it is where the errors
are, and this document has only closed half of that gap.
