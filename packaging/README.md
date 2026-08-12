# packaging/ — What Ships

The description of the installable artifact. **One manifest, no code.**

| Folder | Contains |
|---|---|
| **bundle/** | `@friday/bundle` — the package whose dependencies are the artifact's contents |

---

## Why this is a top-level folder

Because the three that already exist each say, in their own charter, that this does not belong to
them:

| | Why not here |
|---|---|
| [`packages/`](../packages/) | *"A package may never import from `apps/`."* The bundle names two apps. |
| [`apps/`](../apps/) | *"Each app has an entry point, a lifecycle, and a process."* The bundle has none of the three. |
| [`tools/`](../tools/) | *"None of this ships."* The bundle is the one thing here whose entire purpose is to ship. |

A rule that holds only on a technicality stops being read, so the artifact's description gets its own
place rather than a footnote in someone else's. See
[ADR-0037 §1](../docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md).

## What does NOT belong in here

- **Source code of any kind.** No `src/`, no build step, no tests, no `tsconfig.json`. If something
  here needs compiling, it is a component and belongs in `apps/` or `packages/`.
- **The release script.** `tools/scripts/release.ts` *reads* this folder and builds the artifact from
  it. Machinery that runs is development machinery, and `tools/` is where that lives.
- **A second artifact.** This folder holds one entry by design. A second one means the argument in
  ADR-0037 for committing a manifest rather than generating it has expired, and that is a review
  trigger rather than a new directory.
- **Anything the runtime imports.** Nothing in FRIDAY may depend on this folder existing. It is read
  by the build and by nothing else.

## Expected to stay one folder

`packaging/` is not a pattern the way [`tools/<tool>-config/`](../tools/README.md) is. It describes
the artifact, and there is one artifact. Growth here is a signal, not a milestone.
