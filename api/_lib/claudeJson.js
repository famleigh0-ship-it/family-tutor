// Shared helpers for classroom-log routes that ask Claude to return JSON.

// Claude sometimes wraps JSON in a markdown code fence even when told not
// to — strip it before parsing.
export function parseClaudeJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned)
}

export function buildTopicList(pack) {
  return pack.units.flatMap((unit) => unit.topics.map((t) => ({ id: t.id, name: t.name })))
}
