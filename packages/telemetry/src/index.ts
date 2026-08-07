/**
 * @friday/telemetry — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ── Deliberately empty ──────────────────────────────────────────────────────
 *
 * Pino logging with three-layer redaction, correlation IDs, and OpenTelemetry
 * tracing arrive at Milestone 1 (Heartbeat).
 *
 * When it is filled in, note the distinction this package exists to preserve:
 * telemetry is the *system log* — verbose, cheap, disposable, for debugging.
 * The *audit trail* is permanent and authoritative and lives in `kernel`.
 *
 * See: README.md · docs/01-bible/39-roadmap.md
 */

export {}
