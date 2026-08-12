# @friday/bundle — The Artifact's Contents

**A manifest, not a component.** This package is one `package.json` and this README. It has no
source, exports nothing, and is imported by nothing.

Its `dependencies` are the whole of its meaning:

```json
"dependencies": {
  "@friday/cli": "workspace:*",
  "@friday/core": "workspace:*"
}
```

That list is what goes on your Mac. Deleting this package breaks the release script and nothing else.

Reference: [ADR-0037](../../docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md) ·
[ADR-0036](../../docs/adr/0036-packaging-delivers-friday-init-provisions.md)

---

## Why it exists

Before it, the artifact was built by deploying `@friday/cli` — and `@friday/core` **is not in the
CLI's dependency graph.** The build succeeded, the result looked complete, and it did not contain the
part of FRIDAY that runs and thinks. The LaunchAgent would have had nothing to start.

The obvious repair is to make the CLI depend on core. That is rejected, and the reason is written in
[`apps/cli/src/index.ts`](../../apps/cli/src/index.ts): the recovery commands are reached for
*"precisely when the dashboard, the departments, and possibly the kernel are unavailable."*
`friday panic` must not need the thing it is being used to recover from.

So the dependency goes the other way. **This package depends on the CLI; the CLI depends on
nothing new.** What is described here is co-location in an archive, which is not a dependency in the
sense the CLI's constraint was written about.

## Why it has no code

Because a package with no source contributes **no edges to the dependency graph**. `dependency-cruiser`
sees nothing here, so naming two apps in this manifest cannot violate a boundary — verified, zero
violations. The moment this package gains a `bin`, a script, or a source file it stops being a
manifest and becomes a component, with all the boundary questions that implies. That is a review
trigger in ADR-0037, not a refactor.

## Why the version says `0.0.0`

**The git tag is the release version.** ADR-0036 §6 makes a tag plus a `CHANGELOG.md` entry the
release, and a version committed here would be a second thing claiming to be the answer — two
sources of truth that can disagree with nothing to detect it.

So this stays `0.0.0`, like every other workspace package, and `tools/scripts/release.ts` stamps the
real version into the deployed copy from the tag it is building. The committed manifest states what
the artifact *contains*. The tag states what it *is called*.

## How the artifact is built

```bash
pnpm --config.inject-workspace-packages=true deploy --filter @friday/bundle --prod <dir>
```

Three things about that command are decisions rather than details:

- **The injection flag is passed on the command line and never written into `pnpm-workspace.yaml`.**
  It changes how every workspace dependency links; only the release needs it (ADR-0036 §1).
- **`--legacy` is prohibited.** It exits 0 and produces a bundle whose FRIDAY packages are symlinks
  escaping into the source checkout, with no native driver and no shipped rules — a bundle that works
  on the machine that built it and nowhere else.
- **It is never run against a working checkout.** `pnpm deploy --prod` leaves the workspace it ran in
  marked production-only, and the next `pnpm` command there offers to prune every development
  dependency. This has already happened once. The release script packages from a throwaway clone
  (ADR-0037 §5).

## What does NOT belong in here

- Source, tests, build configuration, or a `bin` entry
- A dependency that is not part of the shipped artifact
- A version number intended to be authoritative
- Anything `apps/` or `packages/` imports at runtime
