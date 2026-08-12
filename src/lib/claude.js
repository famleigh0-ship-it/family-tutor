import Anthropic from '@anthropic-ai/sdk'

// Plain JS (not .ts) so api/bank/fill.js, api/grading/grade-typed.js,
// api/grading/grade-photo.js, and api/hints/get-hint.js can import this
// directly. Vercel's serverless function bundler cannot resolve a
// directly-imported .ts file at runtime — see src/packs/loader.js
// (Phase 5) for the original discovery of this limitation.

export const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const MODELS = {
  SONNET: 'claude-sonnet-4-6',
  HAIKU: 'claude-haiku-4-5'
}

// Model routing table — matches spec exactly.
export const MODEL_FOR_TASK = {
  mc_generation: MODELS.HAIKU,
  mc_grading: MODELS.HAIKU,
  conceptual_generation: MODELS.SONNET,
  conceptual_grading: MODELS.SONNET,
  frq_generation: MODELS.SONNET,
  frq_grading: MODELS.SONNET,
  text_log_parsing: MODELS.HAIKU,
  photo_log_parsing: MODELS.SONNET,
  hint_generation: MODELS.HAIKU,
  bank_fill_mc: MODELS.HAIKU,
  bank_fill_frq: MODELS.SONNET,
  bank_fill_conceptual: MODELS.SONNET
}

/** @param {keyof typeof MODEL_FOR_TASK} task */
export function getModel(task) {
  const model = MODEL_FOR_TASK[task]
  if (!model) throw new Error(`Unknown Claude task: ${task}`)
  return model
}

// Token budget: trim context to last 5 sessions only.
export const MAX_HISTORY_SESSIONS = 5

/**
 * @param {{
 *   task: keyof typeof MODEL_FOR_TASK,
 *   system: string,
 *   messages: import('@anthropic-ai/sdk').default.MessageParam[],
 *   max_tokens?: number
 * }} params
 * @returns {Promise<{ content: string, tokens_used: number }>}
 */
export async function callClaude(params) {
  const model = getModel(params.task)
  const response = await claude.messages.create({
    model,
    max_tokens: params.max_tokens ?? 1000,
    system: params.system,
    messages: params.messages
  })
  const content = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const tokens_used = response.usage.input_tokens + response.usage.output_tokens
  return { content, tokens_used }
}
