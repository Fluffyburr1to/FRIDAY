/**
 * @friday/contracts — the public surface.
 *
 * This is the ONLY file other packages may import from. Everything else under
 * `src/` is private by convention and by dependency-cruiser rule, which is
 * what makes this package genuinely replaceable: consumers depend on a small
 * declared surface rather than on internal structure that shifts.
 *
 * ── Deliberately empty ──────────────────────────────────────────────────────
 *
 * The package exists now so the workspace, the build graph, the boundary rules
 * and the test harness are proven against real packages rather than against
 * nothing. Its contents arrive at Milestone 1 (Heartbeat): the Zod schemas for
 * events, plans, actors, and sensitivity.
 *
 * `contracts` is the root of the dependency graph. It imports nothing internal,
 * ever. If it ever imports from FRIDAY, the architecture has inverted.
 *
 * See: README.md · docs/01-bible/39-roadmap.md
 */

export {}
