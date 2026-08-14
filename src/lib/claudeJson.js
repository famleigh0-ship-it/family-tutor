// Shared helpers for anything that asks Claude to return JSON — used by
// both api/*.js routes and plain Node scripts (e.g. src/lib/bankFill.js,
// called directly from scripts/manage-bank.js).

// Claude sometimes wraps JSON in a markdown code fence even when told not
// to — strip it before parsing.
export function parseClaudeJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned)
}

export function buildTopicList(pack) {
  return pack.units.flatMap((unit) => unit.topics.map((t) => ({ id: t.id, name: t.name })))
}
