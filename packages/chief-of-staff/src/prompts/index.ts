/**
 * Prompts, as versioned source.
 *
 * ★ [Chapter 11](../../../../docs/01-bible/11-agent-framework.md) requires
 * that prompts be **files**, versioned with the code that uses them, reviewed
 * in pull requests, and diffed like anything else. A prompt determines
 * behaviour at least as much as code does, and one edited casually in a
 * database field is an undocumented behaviour change with no review, no
 * history, and no rollback.
 *
 * They are `.ts` here rather than the `prompt.md` Chapter 11 shows, and the
 * difference is deliberate rather than convenient: that layout is the *agent*
 * anatomy, and the Chief of Staff is not an agent. A module keeps the prompt
 * and its version in one reviewed artefact with no build-time asset copying to
 * get wrong.
 *
 * ★ **The version travels with every invocation**, so any past behaviour can
 * be traced to the exact text that produced it (Chapter 11, rule 5).
 */

/**
 * Bumped whenever the text below changes.
 *
 * Not automatic on purpose: bumping it is the moment to ask whether the
 * evaluation suite still passes at or above its previous score, which is
 * Chapter 11's rule 2.
 */
export const INTENT_PROMPT_VERSION = 'intent/1'

export const PLAN_PROMPT_VERSION = 'plan/1'

/**
 * Turning an utterance into a structured reading of it.
 *
 * ★ The instruction that matters most is the one about *not guessing*.
 * Chapter 12's ambiguity ladder ends in **ask the owner**, and a parser that
 * silently resolves everything is indistinguishable from one that guessed —
 * so what it declined to decide has to come back as data.
 */
export function intentPrompt(input: {
  readonly utterance: string
  readonly actions: readonly string[]
}): string {
  return [
    'You read what someone asked for and describe it as structured data.',
    'You do not act, you do not plan, and you do not choose which capability runs.',
    '',
    'Rules:',
    '- Report what you are NOT sure about in `ambiguities`. This is the most important field.',
    '  Two people with the same name, an unstated date, an unclear target: all ambiguities.',
    '- Never invent a detail to make the request look complete.',
    '- `kind` describes the sort of request. It is NOT a capability name.',
    '- `confidence` is how sure you are overall, from 0 to 1.',
    '',
    'For context only, these are the kinds of thing this system can do:',
    ...input.actions.map((action) => `  ${action}`),
    '',
    'Respond with JSON only: { kind, confidence, entities, ambiguities }.',
    '',
    'What was asked:',
    // ★ Delimited and labelled as data, never concatenated into the
    // instruction section. Chapter 11's first defence against injection.
    '<<<REQUEST',
    input.utterance,
    'REQUEST',
  ].join('\n')
}

/**
 * Turning a reading into ordered steps.
 *
 * ★ The planner has **no tools**. It receives context and returns a structure;
 * it cannot read anything, call anything, or act. It is a pure function from
 * context to shape, which is what makes the plan inspectable before it runs.
 */
export function planPrompt(input: {
  readonly utterance: string
  readonly intentKind: string
  readonly actions: readonly { readonly action: string; readonly description: string }[]
  readonly maxSteps: number
  readonly maxDepth: number
}): string {
  return [
    'You break a request into ordered steps. You do not carry them out.',
    '',
    'Rules:',
    `- At most ${input.maxSteps} steps, and no chain of dependencies deeper than ${input.maxDepth}.`,
    '- Use ONLY the actions listed below. Never invent one.',
    '- `dependsOn` lists the steps that must finish first. Leave it empty when a step',
    '  can start immediately — steps that do not depend on each other run at the same time.',
    '- `description` is read by someone who does not program. Write it for them.',
    '- `onFailure` says what to do if the step fails: retry, skip, abort, ask_user, or alternate.',
    '  Decide it now. There is no default.',
    '- Do NOT say how risky a step is. That is not yours to decide.',
    '',
    'Available actions:',
    ...input.actions.map((entry) => `  ${entry.action} — ${entry.description}`),
    '',
    'Respond with JSON only: { rationale, steps: [{ sequence, dependsOn, description,',
    'actionType, department, onFailure }] }.',
    '`rationale` explains why you split the work this way, in one or two plain sentences.',
    '',
    `The reading of the request: ${input.intentKind}`,
    '',
    'What was asked:',
    '<<<REQUEST',
    input.utterance,
    'REQUEST',
  ].join('\n')
}
