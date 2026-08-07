import { basename, dirname } from 'node:path'
import { createStream } from 'rotating-file-stream'

/**
 * Log rotation.
 *
 * Chapter 22 sets four numbers, and every one of them is here rather than in a
 * runbook: daily rotation, 100 MB per file, 30 days of retention, and a hard
 * ceiling of 1 GB on the directory.
 *
 * The last of those is the one that matters. Chapter 22's rule is that **logs
 * must never be the reason FRIDAY cannot write her audit trail** — a disk
 * filled with debug output would stop her recording, and an unrecorded action
 * is worse than no action. A retention policy that depends on someone noticing
 * the directory is large is not a policy.
 *
 * ── On the library ──────────────────────────────────────────────────────────
 *
 * `rotating-file-stream` rather than `pino-roll`, which is the more obvious
 * choice given the logger. Three reasons, in order of weight:
 *
 *   1. **`pino-roll` cannot express the 1 GB ceiling.** It caps the number of
 *      files, not their total size, so a burst of large files still fills the
 *      disk. That is precisely the failure Chapter 22 names.
 *   2. It is maintained more recently (Feb 2026 against Oct 2025).
 *   3. It has no runtime dependencies; `pino-roll` pulls in `date-fns` and
 *      `sonic-boom`, and every dependency runs with FRIDAY's full privileges.
 *
 * The cost is that writes go through an ordinary Node stream rather than
 * Pino's `sonic-boom` destination, which is measurably faster. At FRIDAY's
 * volume — thousands of lines a day, not thousands a second — that is not a
 * trade worth taking a dependency for. See docs/adr/0023.
 *
 * Reference: docs/01-bible/22-logging-standards.md
 */

export interface RotationPolicy {
  /** How often to start a new file, in `rotating-file-stream` syntax. */
  readonly interval: string

  /** Maximum size of any one file. */
  readonly maxFileSize: string

  /** How many rotated files to keep. Thirty days at one file a day. */
  readonly maxFiles: number

  /**
   * ★ Ceiling on the whole directory. When the total is exceeded, the oldest
   * files are removed — which is Chapter 22's "rotation becomes aggressive".
   */
  readonly maxTotalSize: string
}

/** Chapter 22's numbers, in one place. */
export const CHAPTER_22_ROTATION: RotationPolicy = {
  interval: '1d',
  maxFileSize: '100M',
  maxFiles: 30,
  maxTotalSize: '1G',
}

/** What FRIDAY is told when rotation had to intervene. */
export interface RotationEvent {
  readonly kind: 'rotated' | 'removed' | 'warning' | 'error'

  /** Plain language, for a diagnostic the owner will read. */
  readonly message: string

  /** The file involved, when there is one. */
  readonly path?: string | undefined
}

export interface RotatingDestinationOptions {
  /** The file to write. Rotated files sit beside it. */
  path: string

  policy?: RotationPolicy

  /**
   * Called when a file is rotated, removed, or rotation fails.
   *
   * Diagnostics turns a `removed` into an issue the owner sees: files being
   * deleted to stay under the ceiling means log volume has outgrown the
   * budget, and Chapter 22 says that raises a diagnostic rather than happening
   * quietly.
   */
  onRotation?: (event: RotationEvent) => void
}

/**
 * Opens a rotating log destination.
 *
 * @param options - The path, the policy, and an optional observer.
 * @returns A writable stream Pino can be pointed at.
 */
export function createRotatingDestination(
  options: RotatingDestinationOptions,
): NodeJS.WritableStream {
  const policy = options.policy ?? CHAPTER_22_ROTATION
  const notify = options.onRotation

  const stream = createStream(basename(options.path), {
    path: dirname(options.path),
    interval: policy.interval,
    size: policy.maxFileSize,
    maxFiles: policy.maxFiles,
    maxSize: policy.maxTotalSize,

    // Rotated files are gzipped. A month of logs is mostly repeated field
    // names, which compresses to almost nothing — and the ceiling above is
    // measured against the compressed size, so this buys real retention.
    compress: 'gzip',

    // Roll at midnight rather than 24 hours after the process started, so
    // "yesterday's log" means yesterday. Without this, restarting FRIDAY moves
    // the boundary, and a day's logs end up split across two files at whatever
    // time she last came up.
    intervalBoundary: true,

    // Where the rotation bookkeeping lives. Named explicitly because the
    // default is `friday.log.txt`, which sits in the log directory looking
    // exactly like a log file someone should read. The leading dot keeps it
    // out of the way.
    history: '.rotation-history',
  })

  if (notify !== undefined) attachObserver(stream, notify)

  return stream
}

/**
 * Wires the stream's events to the observer.
 *
 * `error` is deliberately handled rather than left to propagate. An unhandled
 * `error` on a stream takes the process down, and losing FRIDAY because her
 * debug log could not rotate would invert the priority Chapter 22 sets: the
 * system log is the disposable record, and it must never be able to stop the
 * one that is not.
 */
function attachObserver(
  stream: ReturnType<typeof createStream>,
  notify: (event: RotationEvent) => void,
): void {
  stream.on('rotated', (path: string) => {
    notify({ kind: 'rotated', message: `The log rolled over to a new file.`, path })
  })

  stream.on('removed', (path: string) => {
    notify({
      kind: 'removed',
      message:
        'An old log file was deleted to stay inside the size budget. ' +
        'If this keeps happening, log volume has outgrown the retention window.',
      path,
    })
  })

  stream.on('warning', (cause: Error) => {
    notify({ kind: 'warning', message: cause.message })
  })

  stream.on('error', (cause: Error) => {
    notify({
      kind: 'error',
      message: `The system log could not be rotated: ${cause.message}. Logging continues.`,
    })
  })
}
