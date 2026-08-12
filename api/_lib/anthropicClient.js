import Anthropic from '@anthropic-ai/sdk'

let client

/**
 * Anthropic client for serverless functions only. Never import this from
 * src/ — the API key must stay server-side.
 */
export function getAnthropicClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY in the function environment.')
    }
    client = new Anthropic({ apiKey })
  }
  return client
}
