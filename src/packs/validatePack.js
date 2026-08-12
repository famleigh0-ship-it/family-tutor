// Plain JS (not .ts) so this one implementation can be shared by both the
// Vite-bundled app (src/packs/loader.ts, via allowJs) and the standalone
// CLI (scripts/validate-packs.js, run directly with `node`).

const TOPIC_TYPES = ['conceptual', 'quantitative', 'mixed']
const DIFFICULTIES = [1, 2, 3]
const INPUT_MODES = ['typed', 'photo']

function fail(packId, message) {
  throw new Error(`[pack:${packId ?? 'unknown'}] ${message}`)
}

// Structural/shape validation: required fields, correct types, valid enum
// values. Does not check that cross-references (prerequisite ids, pacing
// topic ids) actually resolve — see checkPackIntegrity for that.
export function validatePackShape(data) {
  if (!data || typeof data !== 'object') fail(undefined, 'pack must be an object')
  const packId = data.id

  for (const field of [
    'id',
    'name',
    'school_year_start',
    'exam_date',
    'tutor_persona',
    'subject_context'
  ]) {
    if (typeof data[field] !== 'string' || !data[field]) {
      fail(packId, `"${field}" must be a non-empty string`)
    }
  }

  if (typeof data.exam_crunch_weeks !== 'number') {
    fail(packId, '"exam_crunch_weeks" must be a number')
  }

  if (!Array.isArray(data.units)) fail(packId, '"units" must be an array')
  for (const unit of data.units) {
    if (typeof unit.id !== 'string' || !unit.id) fail(packId, 'a unit is missing "id"')
    if (typeof unit.name !== 'string' || !unit.name) {
      fail(packId, `unit "${unit.id}" is missing "name"`)
    }
    if (typeof unit.ap_exam_weight_min !== 'number' || typeof unit.ap_exam_weight_max !== 'number') {
      fail(packId, `unit "${unit.id}" must have numeric ap_exam_weight_min/max`)
    }
    if (!Array.isArray(unit.prerequisite_unit_ids)) {
      fail(packId, `unit "${unit.id}" must have a prerequisite_unit_ids array`)
    }
    if (!Array.isArray(unit.topics)) fail(packId, `unit "${unit.id}" must have a topics array`)

    for (const topic of unit.topics) {
      if (typeof topic.id !== 'string' || !topic.id) {
        fail(packId, `unit "${unit.id}" has a topic missing "id"`)
      }
      if (typeof topic.name !== 'string' || !topic.name) {
        fail(packId, `topic "${topic.id}" is missing "name"`)
      }
      if (!TOPIC_TYPES.includes(topic.type)) {
        fail(packId, `topic "${topic.id}" has invalid type "${topic.type}"`)
      }
      if (!DIFFICULTIES.includes(topic.difficulty)) {
        fail(packId, `topic "${topic.id}" has invalid difficulty "${topic.difficulty}"`)
      }
      if (!Array.isArray(topic.prerequisite_topic_ids)) {
        fail(packId, `topic "${topic.id}" must have a prerequisite_topic_ids array`)
      }
      if (!INPUT_MODES.includes(topic.input_mode)) {
        fail(packId, `topic "${topic.id}" has invalid input_mode "${topic.input_mode}"`)
      }
      if (!Array.isArray(topic.prompt_hints)) {
        fail(packId, `topic "${topic.id}" must have a prompt_hints array`)
      }
      if (!Array.isArray(topic.common_errors)) {
        fail(packId, `topic "${topic.id}" must have a common_errors array`)
      }
      if (topic.bc_only !== undefined && typeof topic.bc_only !== 'boolean') {
        fail(packId, `topic "${topic.id}" bc_only must be boolean if present`)
      }
    }
  }

  if (!Array.isArray(data.pacing_calendar)) fail(packId, '"pacing_calendar" must be an array')
  for (const week of data.pacing_calendar) {
    if (typeof week.week !== 'number') fail(packId, 'a pacing_calendar entry is missing numeric "week"')
    if (!Array.isArray(week.topic_ids)) {
      fail(packId, `pacing_calendar week ${week.week} must have a topic_ids array`)
    }
  }

  if (!Array.isArray(data.common_misconceptions)) {
    fail(packId, '"common_misconceptions" must be an array')
  }
  for (const m of data.common_misconceptions) {
    if (typeof m.id !== 'string' || !m.id) fail(packId, 'a misconception is missing "id"')
    if (typeof m.description !== 'string' || !m.description) {
      fail(packId, `misconception "${m.id}" is missing "description"`)
    }
    if (!Array.isArray(m.affected_topic_ids)) {
      fail(packId, `misconception "${m.id}" must have an affected_topic_ids array`)
    }
    if (!Array.isArray(m.detection_hints)) {
      fail(packId, `misconception "${m.id}" must have a detection_hints array`)
    }
  }

  const rubric = data.frq_rubric
  if (!rubric || typeof rubric !== 'object') fail(packId, '"frq_rubric" must be an object')
  if (typeof rubric.general_guidance !== 'string' || !rubric.general_guidance) {
    fail(packId, 'frq_rubric.general_guidance must be a non-empty string')
  }
  if (typeof rubric.point_allocation_pattern !== 'string' || !rubric.point_allocation_pattern) {
    fail(packId, 'frq_rubric.point_allocation_pattern must be a non-empty string')
  }
  if (!Array.isArray(rubric.common_reasoning_gaps)) {
    fail(packId, 'frq_rubric.common_reasoning_gaps must be an array')
  }

  return data
}

// Cross-reference validation: every id referenced elsewhere in the pack
// must actually exist, and bc_only topics must never be calendar-scheduled
// (AB pacing) since BC content unlocks via prerequisite units instead.
export function checkPackIntegrity(pack) {
  const errors = []
  const unitIds = new Set(pack.units.map((u) => u.id))
  const topicIds = new Set(pack.units.flatMap((u) => u.topics.map((t) => t.id)))
  const topicById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t])))

  for (const unit of pack.units) {
    for (const prereqId of unit.prerequisite_unit_ids) {
      if (!unitIds.has(prereqId)) {
        errors.push(`Unit "${unit.id}" references unknown prerequisite unit "${prereqId}"`)
      }
    }
    for (const topic of unit.topics) {
      for (const prereqId of topic.prerequisite_topic_ids) {
        if (!topicIds.has(prereqId)) {
          errors.push(`Topic "${topic.id}" references unknown prerequisite topic "${prereqId}"`)
        }
      }
    }
  }

  for (const week of pack.pacing_calendar) {
    for (const topicId of week.topic_ids) {
      if (!topicIds.has(topicId)) {
        errors.push(`Pacing calendar week ${week.week} references unknown topic "${topicId}"`)
      }
    }
  }

  const abCalendarTopicIds = new Set(pack.pacing_calendar.flatMap((w) => w.topic_ids))
  for (const topicId of abCalendarTopicIds) {
    if (topicById.get(topicId)?.bc_only) {
      errors.push(`Topic "${topicId}" is bc_only but appears in the AB pacing calendar`)
    }
  }

  for (const m of pack.common_misconceptions) {
    for (const topicId of m.affected_topic_ids) {
      if (!topicIds.has(topicId)) {
        errors.push(`Misconception "${m.id}" references unknown topic "${topicId}"`)
      }
    }
  }

  return errors
}
