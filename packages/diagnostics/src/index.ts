/**
 * @friday/diagnostics — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * The package charter names three functions — health, self-checks, and
 * improvement proposals. Only the first has any content yet, and only the part
 * of it that reads the machine FRIDAY is running on. Self-checks and proposals
 * arrive with the milestone that gives her something to check and something to
 * propose about.
 *
 * See: README.md · docs/01-bible/23-diagnostics-system.md
 */

export { createVitalsReader, type VitalsReader } from './vitals.js'
