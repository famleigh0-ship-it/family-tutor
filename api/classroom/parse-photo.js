import { getUserFromRequest, getUserProfile } from '../_lib/supabaseAdmin.js'
import { getAnthropicClient } from '../_lib/anthropicClient.js'
import { parseClaudeJson, buildTopicList } from '../_lib/claudeJson.js'
import { getPack } from '../../src/packs/loader.js'

const SYSTEM_PROMPT = `You are a curriculum mapper for a high school course. Your job is to identify which academic topics appear in a student's handwritten class notes. You must only identify topics from the provided list — do not invent or infer topics not explicitly present in the notes. Be conservative: only flag a topic if there is clear evidence of it in the notes. Return JSON only, no other text.`

// Accepts either a raw base64 string or a data: URL and returns the media
// type + bare base64 payload Claude's image block expects.
function extractImageParts(imageBase64) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/s.exec(imageBase64)
  if (match) return { mediaType: match[1], data: match[2] }
  return { mediaType: 'image/jpeg', data: imageBase64 }
}

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

  const { image_base64: imageBase64, pack_id: packId } = req.body || {}
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    res.status(400).json({ error: 'image_base64 is required' })
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
  const { mediaType, data } = extractImageParts(imageBase64)

  const userText = `Here is the complete list of topics in this course:\n${JSON.stringify(topicList)}\n\nWhich of these topics appear in these class notes?\nReturn this exact JSON structure:\n{\n  "topics_found": ["topic-id-1", "topic-id-2"],\n  "confidence": "high" | "medium" | "low",\n  "readable": true | false,\n  "notes": "brief description of what you saw in the image"\n}`

  let response
  try {
    response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: userText }
          ]
        }
      ]
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

  if (parsed.readable === false) {
    res.status(200).json({
      topics_found: [],
      confidence: parsed.confidence ?? 'low',
      readable: false,
      notes: parsed.notes ?? 'Notes were not readable.'
    })
    return
  }

  const validTopicIds = new Set(topicList.map((t) => t.id))
  const topicsFound = Array.isArray(parsed.topics_found)
    ? parsed.topics_found.filter((id) => validTopicIds.has(id))
    : []

  res.status(200).json({
    topics_found: topicsFound,
    confidence: parsed.confidence ?? 'low',
    readable: true,
    notes: parsed.notes ?? ''
  })
}
