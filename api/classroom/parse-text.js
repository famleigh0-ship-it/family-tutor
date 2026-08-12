import { getUserFromRequest, getUserProfile } from '../_lib/supabaseAdmin.js'
import { getAnthropicClient } from '../_lib/anthropicClient.js'
import { parseClaudeJson, buildTopicList } from '../_lib/claudeJson.js'
import { getPack } from '../../src/packs/loader.ts'

const SYSTEM_PROMPT = `You are a curriculum mapper for a high school course. Map the student's description of what they learned in class to specific topics from the provided list. Only match topics clearly described — do not over-match vague descriptions. Return JSON only, no other text.`

const MAX_DESCRIPTION_LENGTH = 500

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getUserProfile(user.id)
  if (!profile || profile.role !== 'student') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { description, pack_id: packId } = req.body || {}
  if (typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'description is required' })
    return
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    res.status(400).json({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` })
    return
  }
  if (typeof packId !== 'string' || !packId) {
    res.status(400).json({ error: 'pack_id is required' })
    return
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    res.status(400).json({ error: `Unknown pack "${packId}"` })
    return
  }

  const topicList = buildTopicList(pack)
  const userText = `Topic list: ${JSON.stringify(topicList)}\n\nStudent description: "${description}"\n\nReturn this exact JSON:\n{\n  "topics_found": ["topic-id-1", "topic-id-2"],\n  "confidence": "high" | "medium" | "low",\n  "notes": "brief explanation of your mapping"\n}`

  let response
  try {
    response = await getAnthropicClient().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }]
    })
  } catch (err) {
    res.status(502).json({ error: 'Claude API request failed', detail: err.message })
    return
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock) {
    res.status(502).json({ error: 'Claude returned no text content' })
    return
  }

  let parsed
  try {
    parsed = parseClaudeJson(textBlock.text)
  } catch {
    res.status(502).json({ error: 'Could not parse Claude response as JSON', raw: textBlock.text })
    return
  }

  const validTopicIds = new Set(topicList.map((t) => t.id))
  const topicsFound = Array.isArray(parsed.topics_found)
    ? parsed.topics_found.filter((id) => validTopicIds.has(id))
    : []

  res.status(200).json({
    topics_found: topicsFound,
    confidence: parsed.confidence ?? 'low',
    notes: parsed.notes ?? ''
  })
}
