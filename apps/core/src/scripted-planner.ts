import type { DepartmentManifest, ModelRequest } from '@friday/contracts'

/**
 * A planner that does not think, and says so.
 *
 * ★ **This is keyword matching over the department manifests. It is not
 * comprehension, and nothing here should be mistaken for it.** It exists so
 * that the whole path — parse, plan, show, authorize, run, explain — can be
 * demonstrated and tested end to end at zero cost and with no credentials,
 * which is the same reason `createFakeProvider` exists and is shipped rather
 * than kept in a test folder.
 *
 * ★ **It is replaced by configuration, not by code.** A real model is a
 * provider on the router; the session takes `invoke` and everything above it
 * is identical either way. That is the point of the port, and it is why this
 * lives behind the same one rather than short-circuiting the planner.
 *
 * ★ **What it will not do is guess.** An utterance matching nothing produces
 * an *ambiguity* and no plan, exactly as Chapter 12's ladder requires — never
 * a nearest-neighbour capability chosen because something had to be chosen. A
 * scripted planner that guessed would be worse than a model that guessed,
 * because nobody would be watching it.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · packages/model-router/src/fake-provider.ts
 */

/** Words too common to distinguish one capability from another. */
const NOISE = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'can',
  'do',
  'for',
  'friday',
  'get',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'please',
  'that',
  'the',
  'this',
  'to',
  'up',
  'want',
  'with',
  'you',
  'your',
])

/**
 * Builds the scripted responder.
 *
 * @param departments - The manifests, which are the whole of what she can do.
 * @returns A `respond` function for the shipped local provider.
 */
export function createScriptedPlanner(
  departments: readonly DepartmentManifest[],
): (request: ModelRequest) => string {
  const capabilities = departments.flatMap((department) =>
    department.capabilities.map((capability) => ({
      action: capability.action,
      department: department.id,
      description: capability.description,
      words: significantWords(`${capability.action} ${capability.description}`),
    })),
  )

  return (request) => {
    const utterance = askedFor(request)
    const asked = significantWords(utterance)

    const scored = capabilities
      .map((capability) => ({
        capability,
        score: [...asked].filter((word) => capability.words.has(word)).length,
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)

    const best = scored[0]

    if (best === undefined) return nothingMatched(utterance)

    return isPlanning(request)
      ? JSON.stringify({
          rationale:
            `One step: "${best.capability.description}" is the only thing FRIDAY has that ` +
            'matches what you asked for.',
          steps: [
            {
              sequence: 1,
              dependsOn: [],
              description: best.capability.description,
              actionType: best.capability.action,
              department: best.capability.department,

              // ★ `abort` rather than `retry`. A scripted planner has no basis
              // for believing a second attempt would go differently, and
              // choosing `retry` because it sounds resilient would spend the
              // owner's budget three times over on a decision nobody made.
              onFailure: 'abort',
            },
          ],
        })
      : JSON.stringify({
          // ★ A KIND of request, not a capability name. The prompt is explicit
          // that reading a request and choosing what performs it are different
          // jobs, and answering with the action would collapse them — the
          // planner would then be taking dictation from the parser.
          kind: kindOf(best.capability),
          confidence: 1,
          entities: {},

          // ★ Honest about what this is. The reading is a word match, and the
          // owner reviewing the plan is told so rather than shown a confident
          // paraphrase of their own sentence.
          ambiguities: [],
        })
  }
}

/** What comes back when nothing FRIDAY has matches what was asked. */
function nothingMatched(utterance: string): string {
  return JSON.stringify({
    kind: 'unknown',
    confidence: 0,
    entities: {},
    ambiguities: [
      {
        field: 'request',
        question: `Nothing FRIDAY can do matches "${utterance}". What would you like her to do?`,
        candidates: [],
      },
    ],
  })
}

/** How this request would be described, if someone were describing it. */
function kindOf(capability: { action: string; department: string }): string {
  const verb = capability.action.split('.').at(-1) ?? 'request'

  return `${capability.department}.${verb}`
}

/**
 * Whether this is a request for a plan rather than a reading.
 *
 * ★ Reads the INSTRUCTION, which arrives as the system message. Never the
 * owner's words: those come labelled as context precisely so that what they
 * contain is not read as an instruction, and a responder that scanned every
 * message would undo that on the first utterance containing the word "step".
 */
function isPlanning(request: ModelRequest): boolean {
  return instruction(request).includes('You break a request into ordered steps')
}

function instruction(request: ModelRequest): string {
  return request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n')
}

/**
 * The owner's words, taken from the message that is labelled as theirs.
 *
 * The prompt also embeds them between delimiters, and that is read as a
 * fallback so this keeps working if the message shape changes — but never the
 * whole prompt, for the reason above.
 */
function askedFor(request: ModelRequest): string {
  const context = request.messages.find((message) => message.role === 'context')
  if (context !== undefined) return context.content.trim()

  const prompt = instruction(request)
  const opened = prompt.indexOf('<<<REQUEST\n')
  if (opened === -1) return ''

  const body = prompt.slice(opened + '<<<REQUEST\n'.length)
  const closed = body.lastIndexOf('\nREQUEST')

  return (closed === -1 ? body : body.slice(0, closed)).trim()
}

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 2 && !NOISE.has(word)),
  )
}
