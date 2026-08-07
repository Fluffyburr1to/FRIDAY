/**
 * @friday/config — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ── Deliberately empty ──────────────────────────────────────────────────────
 *
 * Configuration loading, precedence resolution, and Zod validation arrive at
 * Milestone 1 (Heartbeat).
 *
 * When it is filled in: this is the only package in FRIDAY permitted to read
 * `process.env`, and it holds Keychain *references* — never credential values.
 *
 * See: README.md · docs/01-bible/39-roadmap.md
 */

export {}
