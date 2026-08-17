# .changeset/ — How a version is decided

Changesets computes the version and assembles the changelog
([Chapter 27](../docs/01-bible/27-cicd-pipeline.md), [Chapter 32](../docs/01-bible/32-branch-strategy.md)).
It was adopted at M4 under [ADR-0036 §6](../docs/adr/0036-packaging-delivers-friday-init-provisions.md),
which asked for the owner's approval before adding it because a release dependency is attack surface
on the highest-consequence path in the system. **Approved 2026-08-17.**

## ★ Only `@friday/bundle` is versioned

ADR-0036 §6: *"The bundle is the versioned unit. Workspace packages stay `private: true` at `0.0.0`.
Nothing is published to any registry, so per-package versions would be fiction maintained by hand."*

So a changeset names `@friday/bundle` and nothing else. `ignore` is deliberately left empty rather
than listing the other packages: that list would have to be edited every time a package is added,
and a list nobody updates is a rule that quietly stops applying. The invariant is held by a test
instead — `tests/architecture/packaging.test.ts` fails if any package other than the bundle leaves
`0.0.0`, which is the version actually changing rather than a config file describing an intention.

## Writing one

```
pnpm changeset
```

Choose `@friday/bundle`, choose the bump, and describe the change **for the owner, not for a
programmer** — the same two rules `CHANGELOG.md` states, because this text becomes that file.

```
pnpm changeset:status      what is pending
pnpm changeset:version     consume the changesets, bump, write the changelog
```

`changeset version` does not tag and does not build. **A release is a git tag plus a `CHANGELOG.md`
entry** (ADR-0036 §6); the tag is signed by the owner on `main` (Chapter 32), and the artifact is
built from that state by `tools/scripts/release.ts`, which remains authoritative for what ships.
