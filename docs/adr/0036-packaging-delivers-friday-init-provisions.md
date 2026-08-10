# ADR-0036 — Packaging delivers; `friday init` provisions

- **Status:** proposed
- **Date:** 2026-08-10
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 27 — CI/CD Pipeline](../01-bible/27-cicd-pipeline.md),
  [Chapter 32 — Branch Strategy](../01-bible/32-branch-strategy.md),
  [Chapter 33 — Deployment Strategy](../01-bible/33-deployment-strategy.md),
  [Chapter 34 — Disaster Recovery](../01-bible/34-disaster-recovery.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md),
  [ADR-0018 — `better-sqlite3` as the SQLite driver](0018-better-sqlite3-as-the-sqlite-driver.md),
  [ADR-0020 — Key material comes from an injected key provider](0020-key-material-comes-from-an-injected-key-provider.md),
  **[ADR-0033 — Authorization rules are loaded from a configured directory](0033-authorization-rules-are-loaded-from-a-configured-directory.md)**,
  **[ADR-0035 — First-run provisioning is creation-only](0035-first-run-provisioning-is-creation-only.md)**,
  [`tests/architecture/packaging.test.ts`](../../tests/architecture/packaging.test.ts),
  [`infra/launchd/README.md`](../../infra/launchd/README.md)

---

## Context

**FRIDAY can be prepared for, and cannot be installed.**

[ADR-0035](0035-first-run-provisioning-is-creation-only.md) closed the gap that stopped her starting
on a machine: `friday init` seeds the policy directory and mints both Keychain keys. What it could
not close is that **there is no machine to run it on.** Nothing in this repository produces an
artifact, puts a `friday` command on a path, keeps `apps/core` running, or carries a version. The
only way to run FRIDAY today is to have the source tree, the workspace linked by pnpm, and the
toolchain that built it.

Two ADRs deferred a decision to this one, in the same words, and both were explicit that they were
reasoning without the thing they needed:

> **"Packaging lands (M4).** The bundle layout is the constraint this ADR is reasoning about without
> having. Re-examine the default location then." — [ADR-0033](0033-authorization-rules-are-loaded-from-a-configured-directory.md)

> **"Packaging lands (M4).** The bundle layout is the constraint this ADR reasons about without
> having, exactly as ADR-0033 said of itself. Re-examine how the defaults travel, and whether a real
> installer subsumes `friday init` entirely." — [ADR-0035](0035-first-run-provisioning-is-creation-only.md)

This ADR answers both, and it is written before any packaging code exists so that the answers are
arguments rather than descriptions of whatever got built.

### What already constrains the answer

| Constraint | Source |
|---|---|
| `friday-core` runs as a **LaunchAgent**, never a LaunchDaemon — it needs the owner's Keychain and should not hold root | [Chapter 33](../01-bible/33-deployment-strategy.md), Article V |
| Homebrew is **rejected as the primary channel** — its update model is not consent-based | [Chapter 33](../01-bible/33-deployment-strategy.md) |
| Updates are **never silent** | [Chapter 33](../01-bible/33-deployment-strategy.md), Article III, Principle 8 |
| Release signing stays **manual** — the signing key is the most dangerous key in the system | [Chapter 33](../01-bible/33-deployment-strategy.md) |
| The runtime is **pinned** to Node 24 LTS | `.nvmrc`, [ADR-0001](0001-typescript-everywhere.md) |
| `better-sqlite3` is a **native addon**, so any artifact is architecture-specific | [ADR-0018](0018-better-sqlite3-as-the-sqlite-driver.md) |
| The shipped rules must actually be **inside the package** — this repository has been bitten once already | [`packaging.test.ts`](../../tests/architecture/packaging.test.ts), ADR-0033 |
| `friday init` is **creation-only**, and that bound is the entire justification for its Guardian bypass | [ADR-0035](0035-first-run-provisioning-is-creation-only.md) |

### What we do not know at the time of writing

**Whether the owner will ever install FRIDAY on a machine that is not the one that built her.** At
M4 the release is built from a tag on the owner's own Mac and installed on that same Mac. Every
argument below about signing, about update channels, and about "the artifact is trustworthy because
you made it" rests on that, and **all of it changes the first time a build travels.** That is named
here rather than discovered later.

We also do not know what first-run failure looks like in practice. `friday init` has never run on a
machine that was not a test fixture or a developer's checkout.

---

## Decision

We will **package FRIDAY as an unsigned, architecture-specific tarball of a built Node workspace,
installed under the owner's home directory with no root and no network; supervision is installed by
a `friday` subcommand rather than by the installer; and `friday init` remains the sole provisioning
primitive, unchanged.**

The organizing rule, and the reason for the title:

> **Packaging puts files where FRIDAY can find them. It never creates anything FRIDAY owns.**
> Directories under `dataDir`, Keychain items, policy rules, and databases are `friday init`'s —
> and only `friday init`'s. An installer that provisions is an installer that runs on every upgrade
> with the power to overwrite, which is precisely what ADR-0035 refused.

### 1. Bundle layout

One artifact per architecture: **`friday-<version>-darwin-<arch>.tar.gz`**.

```
friday-0.1.0/
  bin/friday                      the entry point — a shim that execs node on the CLI
  lib/node_modules/@friday/…      the built workspace, as real package trees
                                    └── guardian/policies/*.json   ← ships here, unflattened
  lib/node_modules/…              production dependencies, including the
                                    better-sqlite3 prebuild for this architecture
  share/com.friday.core.plist.tmpl  the LaunchAgent template
  VERSION
```

Installed to **`~/.local/friday/<version>/`**, with `~/.local/friday/current` a symlink to the
active version and `~/.local/bin/friday` a symlink into it. Nothing is written outside `~`; the
installer never asks for a password.

**Versioned directories, not in-place replacement.** Rollback is a symlink flip, which is the
mechanism Chapter 33 already promises ("revert quickly if the new version is bad") without a second
implementation of it.

**The package trees are preserved rather than flattened**, and that is load-bearing rather than
tidy. `friday init` finds the shipped rules with
`import.meta.resolve('@friday/guardian/policies/README.md')` — a decision ADR-0035 made and
[`tests/architecture/packaging.test.ts`](../../tests/architecture/packaging.test.ts) guards against
regression. Flattening the rules to a `share/policies/` directory would silently break that
resolution in the packaged artifact and **nowhere else**, which is the exact failure mode ADR-0033
described: *"would work perfectly in development, in CI, and in every test, and would find no rules
at all the first time FRIDAY is packaged."* Packaging adapts to the resolution mechanism. It does
not change it.

**Node is not bundled.** The installer checks for Node 24 and refuses with a nameable message if it
is absent. See [Alternative D](#d-bundle-the-node-runtime-into-a-single-executable) for the cost.

### 2. Where the shipped policy defaults live — ADR-0033's trigger, answered

**Re-examined. Unchanged.** The rules FRIDAY ships with stay inside `@friday/guardian`, and the
runtime default for `paths.policiesDir` stays `<dataDir>/policies` —
`~/Library/Application Support/FRIDAY/policies`.

The bundle layout is what makes this the right answer rather than merely the incumbent one. The
installed tree is **versioned and replaced on upgrade**; the owner's rules must **survive upgrade**.
Those are opposite lifetimes, so they cannot share a directory, and the moment they are in separate
directories the existing default is already correct. ADR-0033 reasoned to this without being able to
see it; having seen it, the conclusion holds.

`deriveDatabasePaths` in [`packages/config/src/defaults.ts`](../../packages/config/src/defaults.ts)
keeps sole responsibility for the default. Packaging sets no path and injects no configuration.

### 3. How `friday init` relates to the packaged application

It is a subcommand of the same `friday` the installer put on the path. Installing and provisioning
are two acts, by two commands, with different powers, run at different times:

| | Installer | `friday init` |
|---|---|---|
| Writes to | `~/.local/friday/**` only | `<dataDir>/policies`, the Keychain |
| Runs | on install **and every upgrade** | once, by hand |
| Can overwrite | its own versioned tree | **nothing** |
| Needs the Guardian | no — it touches nothing FRIDAY governs | no, and ADR-0035 argues why that is safe |

**The installer does not run `friday init`.** It prints the one command to run next, and stops. A
failed install and a failed provision are different problems with different fixes, and an installer
that does both reports them as one.

### 4. `friday init` remains the provisioning primitive — ADR-0035's trigger, answered

**Yes, and subsumption is deferred rather than dismissed.** ADR-0035 asked *"whether a real
installer subsumes `friday init` entirely."* It should not, on the evidence available now, for three
reasons:

1. **Creation-only is the whole safety argument, and an installer cannot keep it.** ADR-0035's
   bypass of the Guardian is acceptable *because the command is incapable*, not because it is
   trusted. An installer runs again on every upgrade. A provisioning installer is therefore, by
   construction, a thing that meets an already-provisioned machine — which is the overwrite case
   §2 of ADR-0035 refuses, and the case where the field-encryption key hazard lives.
2. **The dangerous refusal would move into the least explanatory place.** The most important thing
   `friday init` does is *refuse*: an existing database beside a missing field-encryption key means
   the key was lost, and creating a new one there destroys every encrypted field permanently. That
   refusal needs to be read by a person, in a terminal, with the reasoning attached. Inside an
   installer it becomes a failed step.
3. **There is no evidence yet.** Nobody has run `friday init` on a machine that was not a checkout.
   Deciding that an installer should absorb it, before observing it work once, is deciding without
   the thing this ADR criticises ADR-0033 and ADR-0035 for not having.

Recorded as a review trigger below, not as a closed question.

### 5. launchd provenance and the installation boundary

**The plist is generated, never copied.** `friday service install` renders
`share/com.friday.core.plist.tmpl` with the absolute paths of the installed tree and writes
`~/Library/LaunchAgents/com.friday.core.plist`. A copied plist carries whatever paths were true on
the machine that built it; a generated one cannot.

**It inherits the creation-only bound.** `service install` refuses when the file already exists and
names `friday service uninstall` as the way through. `service uninstall` removes a plist **only** if
its `Label` is `com.friday.core` and its program path points inside a FRIDAY install — it will not
delete a file it cannot prove it wrote.

**A LaunchAgent, never a LaunchDaemon.** Article V, and it needs the owner's Keychain.

**The boundary, stated as a rule:**

> **The installer owns `~/.local/friday/**` and nothing else.** It never writes to `~/Library`,
> never invokes `launchctl`, never starts a process, and never opens a socket. Everything that
> touches the login session is a `friday` subcommand the owner runs deliberately.

`friday service install` **does** load the agent after writing it, because the owner ran a command
whose name is what it does — that is the consent, and making them run `launchctl` afterwards is
friction without a decision in it. It prints what it did and the exact command that undoes it.

### 6. Versioning and the release boundary

- **The bundle is the versioned unit.** Workspace packages stay `private: true` at `0.0.0`. Nothing
  is published to any registry, so per-package versions would be fiction maintained by hand.
- **First version `0.1.0`.** Pre-1.0 says what this is. Chapter 32 permits `v0.1.0-rc.1` from this
  milestone onward.
- **A release is a git tag plus a `CHANGELOG.md` entry**, produced by `tools/scripts/release.ts` and
  built on the owner's machine. There is no download channel at M4, and therefore nothing to sign —
  see the negative consequences.
- **`SECURITY.md`'s "only the current version receives fixes" begins to mean something here.** It
  currently says this changes at Milestone 4; this is that change.
- **Changesets requires the owner's approval before it is added.** Chapter 27 and `CHANGELOG.md`
  both name it as the changelog mechanism, so adopting it is following the Bible rather than
  introducing a preference — but it is a new dependency, and CLAUDE.md rule 4 says a dependency is
  asked for and waited on, not added and mentioned afterward. **This ADR asks.** If the answer is
  no, `release.ts` writes the entry and the Bible chapters are amended to match.

### 7. Upgrade behavior for the shipped policy defaults

**An upgrade installs a new versioned directory, flips `current`, and does not read or write
`<dataDir>/policies`. Ever.**

The consequence is stated plainly because it is a real gap and not a small one: **the owner's rules
and the shipped rules diverge, and nothing detects it.** A rule fixed in a later release does not
reach a machine that has already been provisioned. This is the upgrade-merge gap both ADR-0033 and
ADR-0035 named and deferred, and **M4 does not close it either.**

What M4 does contribute is that the divergence becomes *knowable* later: every installed version
keeps its own `policies/` directory, so both sides of a future comparison exist on disk. The missing
half is knowing which shipped version seeded the owner's directory, and recording that means
`friday init` writes a provenance record at seed time — a change to `friday init`, which is outside
this milestone's bounds by decision. It is the shape to reach for when the gap first bites.

### 8. What packaging owns, and what it does not

**Owns:** building the artifact; the installed tree layout; the `friday` entry point; the version;
rollback by symlink; the LaunchAgent template; checking that the runtime it needs is present.

**Does not own — and any change that moves one of these across the line needs a new ADR:**

- Creating any directory under `dataDir`
- Reading, minting, or deleting any Keychain item
- Authoring, copying, merging, or removing a policy rule
- Running `friday init`
- Opening, migrating, or touching any database
- Any network access, in the installer or the release script
- Code signing and notarization — there is no app bundle to sign until M6
- Automatic or background updates

---

## Constitutional review

- **Article II (Transparency):** the installed tree is a directory you can list and `friday
  --version` reports what is running. **The install itself is not in the event log** — there is no
  log until `friday init` has run. `system.started` gains its first publisher in the same milestone,
  so the first thing recorded is the first time she actually starts.
- **Article III (Control):** nothing starts itself. The agent is written and loaded only by a
  command the owner runs, and `friday service uninstall` reverses it. No automatic updates.
- **Article IV (Privacy):** the artifact is built and installed locally with no network in the path,
  and nothing — least of all the guardian policies — is published to a public registry.
- **Article V (Least privilege):** no root at any point; a LaunchAgent rather than a LaunchDaemon;
  the installer's write scope is one directory it created.
- **Principle 8 (updates are consented to):** upgrade is an act the owner performs.
- **Principle 10 (Simplicity Wins):** a tarball, two symlinks, and one template.

**The five questions:**

- [x] **Can the user see it?** — the tree, `friday --version`, and `system.started` once she runs.
      Partially: the install itself predates the log and cannot be in it.
- [x] **Can the user stop it?** — `friday service uninstall`, or `launchctl unload`. Nothing runs
      until asked.
- [x] **Can we replace it?** — the artifact is a Node tree in a tarball. A `.pkg`, a Homebrew
      formula, or a signed installer can wrap the same tree at M6 without changing it.
- [x] **Can we explain it?** — yes for anything after `friday init`; **no for the install**, which is
      unrecorded by construction and is named as such.
- [ ] **Will this still be right in five years?** — the layout and the boundary, yes. **"Requires
      Node 24 on the machine", almost certainly not**, and the review trigger is written for it.

**Notes:** the unchecked box is deliberate. The runtime-dependency decision is the one part of this
ADR taken for M4's convenience rather than on principle, and marking it as settled would be false.

---

## Alternatives considered

### A. A signed `.pkg` installer

**What it is.** The native macOS installer format: double-click, a wizard, pre- and post-install
scripts, an uninstaller receipt.

**Advantages.** Familiar to any Mac user. Handles paths and permissions properly. Post-install
scripts could install the LaunchAgent in one step. It is what a shipped Mac product looks like.

**Why rejected.** Three reasons, in order of weight. A `.pkg` runs its scripts **as root**, which
buys privilege FRIDAY has spent Chapter 33 avoiding and which nothing here needs. Post-install
scripts are exactly where "the installer provisions" creeps in — the format's convenience pulls
against §4's boundary. And an unsigned `.pkg` is *more* alarming than an unsigned tarball, so it
implies notarization, which implies Apple Developer enrollment, which is M6 work being dragged into
M4 for no benefit at one user. **Revisit at M6**, when there is an `.app` to sign and the enrollment
exists anyway.

### B. Homebrew formula or tap

**What it is.** `brew install friday`, from a personal tap.

**Advantages.** Handles the Node dependency, the PATH, and upgrades. Genuinely the least work.

**Why rejected.** Chapter 33 already rejected it as the primary channel, and the reason survives
contact with this design: **Homebrew's update model is not consent-based**, and `brew upgrade` would
replace FRIDAY as a side effect of upgrading something else — which is Article III and Principle 8.
Chapter 33 keeps it available *"later, as a convenience for initial installation"*, and this ADR
does not close that door: a formula that fetches this same tarball is a wrapper, not a redesign.

### C. Publish to npm and `npm install -g`

**What it is.** Publish `@friday/cli` and its dependencies; install with npm.

**Advantages.** No new machinery at all. npm already solves the native rebuild, the PATH shim, the
version, and the upgrade. It is the smallest possible diff.

**Why rejected.** Every package is `private: true`, and one of them contains **the authorization
rules that govern what FRIDAY may do**. Publishing those to a public registry is egress of the
precise artifact Article IV and the Guardian exist to protect, and it is irreversible — npm
tarballs are permanently retrievable. A private registry removes the objection and adds a hosted
service, credentials, and a network dependency in the install path, which is more infrastructure
than the tarball it would replace.

### D. Bundle the Node runtime into a single executable

**What it is.** Node's Single Executable Application feature, or a tool like `pkg`, producing one
self-contained `friday` binary.

**Advantages.** No runtime dependency and no version skew — the largest genuine weakness of the
chosen design. One file to install, one file to roll back, and the pinned Node version becomes an
enforced fact rather than a documented hope.

**Why rejected, for now.** `better-sqlite3` is a native addon ([ADR-0018](0018-better-sqlite3-as-the-sqlite-driver.md)),
and native addons inside a single executable are the awkward case for both approaches — solvable,
but the solution is a build pipeline nobody has run yet, in the milestone whose point is to be
small. It also hides which Node is executing, which matters when a Node security release is the
thing being applied. **This is the alternative most likely to be adopted later**, and its review
trigger is written below.

### E. Run FRIDAY from the source checkout, as today

**What it is.** No packaging. `pnpm build`, a shell alias, a hand-written plist.

**Advantages.** Zero work. It is what happens now, and it functions.

**Why rejected.** It is not a milestone, it is the absence of one — there is no version, so
`SECURITY.md`'s support statement is unmeaning; no rollback, so Chapter 33's promise is unbacked;
and the machine that runs FRIDAY must carry the whole toolchain, which makes the recovery procedures
in Chapter 34 depend on a working development environment at the moment one is least likely to
exist.

---

## Consequences

**Positive**

- FRIDAY runs on a Mac, starts at login, and survives a logout — the first time that is true.
- The install has no privilege: no root, no network, no password prompt, one directory.
- Rollback is a symlink flip, which makes Chapter 33's promise real rather than aspirational.
- ADR-0033's and ADR-0035's packaging triggers are answered with the artifact in view, and both
  answers happen to confirm the earlier reasoning — which is worth recording, because it is evidence
  those ADRs reasoned well without the thing they lacked.
- `friday init`'s safety argument is preserved intact rather than eroded by convenience.
- The boundary in §8 gives future changes a bright line and a required ADR, rather than a judgment
  call each time.

**Negative**

- **The artifact is unsigned, and the update path is unauthenticated.** This is acceptable *only*
  because the owner builds it from a tag on the machine that runs it. It stops being acceptable the
  instant a build travels between machines, and that transition is easy to make without noticing.
- **A runtime dependency the artifact cannot enforce.** If the machine's Node drifts off 24, FRIDAY
  breaks in whatever way a native addon breaks — which is rarely a clear message. The installer's
  check is a snapshot at install time and nothing re-checks it.
- **The upgrade-merge gap is still open** (§7), and packaging makes it *reachable* for the first
  time: before this milestone nobody could have a stale policy directory, because nobody could have
  a running copy.
- **The install is invisible to the audit trail.** It necessarily precedes the log. Article II is
  satisfied from `friday init` onward and not before, and no amount of design fixes that ordering.
- **Two commands to get running** (`install`, then `friday init`, then `friday service install`)
  where a `.pkg` would present one. That is the cost of §4's boundary and is accepted deliberately.
- **Architecture-specific artifacts** mean an Intel Mac needs its own build. One user, one machine
  today; a second machine makes this a real chore.
- `~/.local/bin` is not on the default macOS `PATH`. The installer prints the line to add, which is
  a manual step on a first install and a support question later.

**Neutral**

- The repository grows a `tools/scripts/release.ts` and a plist template; `tools/` was always
  expected to grow ([ADR-0017](0017-shared-tool-configuration-packages.md)).
- Version numbers begin to exist. Nothing depends on them yet except `SECURITY.md`.
- `apps/desktop` and `apps/mobile` remain empty. This ADR does not constrain how they are packaged
  beyond §8's line about signing.

---

## Reversibility

- **Cost to reverse:** low.
- **How:** delete the release script, the plist template, and the `service` subcommands; remove the
  installed tree with `rm -rf ~/.local/friday`. Nothing in `packages/` depends on any of it — the
  packaged tree is an output of the build, not an input to it, and no runtime code learns its own
  install path except the generated plist.
- **Point of no return:** none at M4. It arrives with a **remote update channel**: once an installed
  copy fetches its successor, the artifact format and the install layout are a contract with copies
  already in the field, and changing them means an upgrade path rather than an edit.

---

## Review triggers

- **A remote update channel is proposed.** The artifact must be **signed before that ships, not
  after**. This is the trigger that matters, and the negative consequence it answers is the largest
  one in this document.
- **An `.app` bundle exists (M6).** Re-examine whether the CLI and the app ship as one artifact, and
  whether notarization — which M6 pays for anyway — should now cover the CLI too. Reconsider
  Alternative A at the same time.
- **A build travels to a machine that did not produce it.** Every trust argument in §6 assumed it
  would not.
- **Node version skew causes a failure.** Adopt Alternative D, or pin harder.
- **The owner's policy directory diverges from the shipped defaults in a way that matters.** The
  upgrade-merge gap. The fix begins with recording seed provenance in `friday init`, which is a
  change to a creation-only command and needs its own argument.
- **`friday init` is asked to do anything during install or upgrade.** Both ADR-0035's creation-only
  bound and this ADR's §4 boundary are being eroded, and the subsumption question is genuinely
  reopening — which is allowed, with an ADR.
- **The installer needs root, the network, or a write outside `~/.local/friday`.** Any one of these
  contradicts §5 and §8.
- **A second person or a second machine.** The "you built it, so you trust it" model ends.
- **Chapter 33's Homebrew note is acted on.** A formula wrapping this tarball is compatible; a
  formula that builds independently is a second packaging path and a new decision.

---

## Notes

**On what this ADR deliberately did not do.** It did not redesign `friday init`, and the owner's
instruction for this milestone said so. That constraint improved the document: the pressure to
"just have the installer set everything up" is real, it is what most software does, and §4 is a
better argument for having had to make it rather than route around it.

**Two stale claims found in the code while writing this**, both in
[`packages/config/src/defaults.ts`](../../packages/config/src/defaults.ts) around
`deriveDatabasePaths`, and both about the exact subject of §2:

1. The comment says the shipped rules *"are excluded from what it publishes."* **That is no longer
   true** — `packages/guardian/package.json` now declares `"files": ["dist", "policies"]`, and
   [`packaging.test.ts`](../../tests/architecture/packaging.test.ts) exists specifically to keep it
   true. ADR-0033 changed this and the comment was not updated with it.
2. The comment says *"Nothing creates this directory yet … which is deliberate, and is `friday
   init`'s to close."* **`friday init` closed it** in ADR-0035's slice.

Neither is a defect in behavior, and neither is fixed here, because this is a documentation change
and they are code comments. They are recorded so the fix lands with the M4 implementation rather
than being rediscovered by someone who trusts the comment. A reader who believes claim 1 would
conclude §2 of this ADR is wrong.

**Uncertainty**, in the order I would bet on being wrong:

1. **Not bundling Node.** It is the decision taken for expedience rather than principle, it is the
   one that makes a support problem out of something the artifact could have owned, and Alternative
   D is genuinely stronger on the merits. I chose the smaller milestone; that may be the wrong
   trade the first time Node updates underneath a running FRIDAY.
2. **`friday service install` loading the agent, rather than only writing it.** The argument that
   running the command *is* the consent is sound, but it makes one command both write a persistent
   system configuration and start a long-lived process. Splitting them would be defensible and
   slightly more Article III.
3. **`~/.local/friday` as the prefix.** It avoids root, which is the property that mattered, but it
   is a Linux convention on a Mac, and `~/Library/Application Support/FRIDAY` — where the data
   already lives — would be more native. I kept code and data apart deliberately; someone could
   reasonably weigh that the other way.

**What would have made this ADR better:** having watched `friday init` succeed once on a machine
that was not a checkout. Every claim here about what the owner experiences on first run is reasoned
rather than observed, and ADR-0035's own review found that the reasoned parts of its first draft
were where the errors were.
