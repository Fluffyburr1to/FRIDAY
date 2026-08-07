import { type FridayConfig, loadConfig } from '@friday/config'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { createKeychainKeyProvider, type KeyProvider } from '@friday/storage'
import type { Output } from './output.js'

/**
 * What every command needs before it can do anything.
 *
 * Kept small on purpose. This app's constraint is that its recovery commands
 * work when the rest of FRIDAY does not, so the shared setup is configuration
 * and a key provider — no kernel, no departments, no dashboard.
 *
 * ── Why the CLI reads the database directly ─────────────────────────────────
 *
 * The README describes the CLI as a client over a local tRPC socket. At
 * Milestone 1 there is no core service to talk to — `apps/core` arrives at M3
 * — so `friday status`, `events tail`, and `verify` open `events.db`
 * themselves, read-only, through `@friday/storage`. That keeps the "only
 * storage opens the database" boundary intact, and WAL mode means a reader
 * never blocks the kernel writing.
 *
 * When the core service exists, these three commands move onto it. The
 * read-only path stays regardless: a recovery tool that can only work by
 * asking the thing that is broken is not a recovery tool.
 */
export interface CommandContext {
  readonly config: FridayConfig
  readonly keys: KeyProvider
  readonly out: Output
}

/**
 * Loads configuration and prepares the shared context.
 *
 * @param input - The output surface, and an optional config file path.
 * @returns The context, or the configuration error, phrased for the owner.
 */
export function createContext(input: {
  out: Output
  configFile?: string | undefined
}): Result<CommandContext, FridayError> {
  const config = loadConfig(input.configFile === undefined ? {} : { configFile: input.configFile })

  if (!config.ok) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message: config.error.message,
        detail: config.error.detail,
      }),
    )
  }

  return ok({
    config: config.value,
    keys: createKeychainKeyProvider({ service: config.value.keychain.service }),
    out: input.out,
  })
}
