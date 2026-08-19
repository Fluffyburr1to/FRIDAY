import { Worker } from 'node:worker_threads'
import type { AgentManifest } from '@friday/contracts'
import { z } from 'zod'
import type { AgentStep, StepIntent } from './loop.js'
import type { MediationOutcome, ToolRequest } from './mediator.js'

/**
 * ★ What the worker sends is untrusted input, and is validated as such.
 *
 * The agent is on the other side of this boundary. Chapter 30's rule — *never
 * trust external input, including AI output* — applies to the channel itself,
 * not only to the answer that comes out of it. A message that is cast rather
 * than parsed would let a malformed request reach the mediator, which is the
 * one place that must only ever see well-formed questions.
 */
const RequestFromWorkerSchema = z.object({
  capability: z.string().min(1).max(128),
  action: z.string().min(1).max(128),
  resource: z.string().min(1).max(512),
  connector: z.string().min(1).max(128).optional(),
  permit: z.string().min(1).max(512).optional(),
  because: z.string().min(1).max(1024),
})

/**
 * Worker-thread isolation — what an agent can physically reach.
 *
 * ★ This is the other half of the safety model, and the halves are not
 * interchangeable. **Mediation decides what FRIDAY will do on an agent's
 * behalf. Isolation decides what the agent's own code can touch.** Without
 * this, an agent is a function running in FRIDAY's process: the mediator would
 * faithfully refuse to fetch a URL for it, and nothing would stop it calling
 * `fetch` itself.
 *
 * The agent runs in a worker thread with:
 *
 *   - **`resourceLimits`**, so a memory runaway kills a thread rather than
 *     FRIDAY.
 *   - **A stripped global scope.** `fetch`, `process.env`, and the module
 *     loader's route to `fs`, `net`, and `child_process` are removed *before*
 *     agent code is loaded. An agent that reaches for the network gets a
 *     `ReferenceError`, not a connection.
 *   - **No shared memory** and no handle on anything of FRIDAY's.
 *
 * The only way out is a typed message. That is the mailbox Chapter 11
 * describes, and it is the whole of the agent's power: it can post a request
 * and wait to be told what happened.
 *
 * ★ **Honest limit, stated rather than discovered later.** Worker threads are
 * an *isolation* mechanism, not a *security sandbox*. Determined malicious
 * code with a V8 escape could break out. That is acceptable for first-party
 * and AI-written agents, where the threat is bugs and prompt injection rather
 * than a hostile author. It is **not** acceptable for third-party plugin code,
 * which is why Chapter 15 specifies a stronger boundary for that case.
 *
 * ★ This is exposed as an `AgentStep`, so an isolated agent runs through
 * `runAgent` like any other. The budget and the mediator are enforced on the
 * host side, by the same code, and the constitutional guarantee that the
 * execution boundary obeys the ledger covers this path too — rather than a
 * second path existing beside it that nothing checks.
 *
 * Reference: docs/01-bible/11-agent-framework.md · docs/adr/0007-no-agent-framework.md
 */

/** What the worker may post out. Anything else is a protocol violation. */
type FromWorker =
  | { readonly kind: 'request'; readonly request: unknown }
  | { readonly kind: 'finish'; readonly output: unknown }
  | { readonly kind: 'failed'; readonly because: string }

/** What the host posts in: the answer to the agent's last request. */
interface ToWorker {
  readonly outcome: MediationOutcome | undefined
}

export interface IsolatedAgentOptions {
  readonly manifest: AgentManifest

  /**
   * The agent's module. Loaded *inside* the worker, after the globals are
   * stripped, so it never sees an un-neutered scope.
   */
  readonly entry: string

  /** The validated input for this invocation. */
  readonly input: unknown

  /** Memory ceiling for the thread, in megabytes. */
  readonly maxOldGenerationSizeMb?: number
}

export interface IsolatedAgent {
  /** The step function to hand to `runAgent`. */
  readonly step: AgentStep

  /** Destroys the thread. No agent state survives — Chapter 11's rule. */
  dispose(): Promise<void>
}

/**
 * The bootstrap that runs inside the worker before any agent code.
 *
 * ★ Written as source rather than imported, because it has to execute in the
 * worker's own scope before that scope is safe to load anything into. Anything
 * imported to do this would itself be loaded into the scope it is removing.
 */
const BOOTSTRAP = `
  const { parentPort, workerData } = require('node:worker_threads')
  const Module = require('node:module')

  // ── Strip the scope, before the agent is loaded ────────────────────────
  //
  // Deleted rather than shadowed: a shadowed global is reachable again from
  // any closure that captured the real one.
  for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator']) {
    try { delete globalThis[name] } catch {}
  }

  // process.env is where credentials live. The whole object goes, not the
  // keys — an empty env is a fact an agent can handle; a partially emptied
  // one invites probing for what survived.
  try { process.env = Object.freeze({}) } catch {}

  // ★ The module loader is the real door. Removing \`fetch\` means nothing if
  // an agent can \`require('node:net')\` and open a socket itself.
  const DENIED = new Set([
    'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
    'net', 'node:net', 'tls', 'node:tls', 'dgram', 'node:dgram',
    'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2',
    'child_process', 'node:child_process',
    'worker_threads', 'node:worker_threads',
    'vm', 'node:vm', 'inspector', 'node:inspector',
    'process', 'node:process', 'module', 'node:module',
  ])

  const load = Module._load
  Module._load = function (request, parent, isMain) {
    if (DENIED.has(request)) {
      throw new ReferenceError(
        'An agent may not load "' + request + '". Agents ask; they do not reach.',
      )
    }
    return load.call(this, request, parent, isMain)
  }

  // ── Now the agent, into a scope that can no longer reach anything ──────
  let agent
  let loadFailure
  try {
    agent = require(workerData.entry)
    if (typeof agent !== 'function' && typeof agent?.default === 'function') agent = agent.default
    if (typeof agent !== 'function') loadFailure = 'the agent module did not export a function'
  } catch (cause) {
    loadFailure = String(cause && cause.message)
  }

  let resolveOutcome
  const nextOutcome = () => new Promise((resolve) => { resolveOutcome = resolve })

  parentPort.on('message', (message) => resolveOutcome?.(message.outcome))

  const ask = (request) => {
    const waited = nextOutcome()
    parentPort.postMessage({ kind: 'request', request })
    return waited
  }

  if (loadFailure !== undefined) {
    parentPort.postMessage({ kind: 'failed', because: loadFailure })
  } else {
    Promise.resolve()
      .then(() => agent({ input: workerData.input, ask }))
      .then((output) => parentPort.postMessage({ kind: 'finish', output }))
      .catch((cause) =>
        parentPort.postMessage({ kind: 'failed', because: String(cause && cause.message) }),
      )
  }
`

/**
 * Starts an agent in an isolated worker thread.
 *
 * @param options - The manifest, the agent module, and its input.
 * @returns A step function for `runAgent`, and a way to destroy the thread.
 */
export function startIsolatedAgent(options: IsolatedAgentOptions): IsolatedAgent {
  const worker = new Worker(BOOTSTRAP, {
    eval: true,
    workerData: { entry: options.entry, input: options.input },
    resourceLimits: {
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 128,
    },
    // No inherited environment. Belt as well as the braces in the bootstrap.
    env: {},
    stdout: true,
    stderr: true,
  })

  let pending: ((message: FromWorker) => void) | undefined
  const queue: FromWorker[] = []
  let ended: FromWorker | undefined

  worker.on('message', (message: FromWorker) => {
    if (pending) {
      const resolve = pending
      pending = undefined
      resolve(message)
      return
    }

    queue.push(message)
  })

  // A worker that dies without saying anything is still an ending. Without
  // this the loop would await a message that is never coming.
  worker.on('error', (cause: Error) => {
    ended = { kind: 'failed', because: cause.message }
    pending?.(ended)
    pending = undefined
  })

  worker.on('exit', () => {
    ended ??= { kind: 'failed', because: 'the agent stopped without answering' }
    pending?.(ended)
    pending = undefined
  })

  function nextMessage(): Promise<FromWorker> {
    const queued = queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (ended !== undefined) return Promise.resolve(ended)

    return new Promise((resolve) => {
      pending = resolve
    })
  }

  return {
    async step(previous): Promise<StepIntent> {
      // The answer to whatever it asked last, then whatever it asks next.
      if (previous !== undefined) worker.postMessage({ outcome: previous } satisfies ToWorker)

      const message = await nextMessage()

      if (message.kind === 'finish') return { kind: 'finish', output: message.output }

      if (message.kind === 'failed') {
        return { kind: 'abandon', because: `the agent stopped: ${message.because}` }
      }

      // ★ Parsed, not cast. The worker is the untrusted side.
      const parsed = RequestFromWorkerSchema.safeParse(message.request)

      if (!parsed.success) {
        return {
          kind: 'abandon',
          because:
            'the agent sent something FRIDAY could not read as a request: ' +
            parsed.error.issues.map((issue) => issue.path.join('.') || 'message').join(', '),
        }
      }

      return { kind: 'request', request: parsed.data satisfies ToolRequest }
    },

    async dispose() {
      await worker.terminate()
    },
  }
}
