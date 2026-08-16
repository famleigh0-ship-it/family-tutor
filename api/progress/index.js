// GET-only, dispatched on ?type= — combines what the Phase 9 spec describes
// as five separate files (progress/mastery-summary.js, session-history.js,
// weak-spots.js, parent/students.js, parent/student-detail.js) into one
// function, plus a sixth type (streak-calendar) the spec didn't call out as
// its own file but needs the same server-side (no-RLS) access to `sessions`.
// Same reasoning as every other api/ route note in README.md: Vercel
// Hobby's 12-function cap. This phase's whole API surface is one new
// function (api/session and api/quiz-prep together already used the last
// bit of headroom Phase 6 left), landing the deployment at exactly 12.
//
// All six types read tables with no RLS policy for the browser client
// (mastery_records, sessions, question_log, quiz_prep_events) or that a
// parent needs to read for a student they don't have direct RLS access to
// (streaks — its only policy is "select own"), so everything goes through
// the service role here rather than any direct Supabase client read.

import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getPack, getAllPacks } from '../../src/packs/loader.js'
import { getMasteryLabel, applyDecay } from '../../src/engine/mastery.js'
import { runPacingCalendarSweep } from '../../src/engine/unlock.js'
import { expireAllStaleQuizPrepEvents, rowToMasteryRecord } from '../../src/engine/session-orchestrator.js'
import { checkBankHealth, triggerBankFill } from '../../src/engine/bank-manager.js'

const MS_PER_DAY = 86_400_000
const STREAK_CALENDAR_DAYS = 84 // 12 weeks
const SESSION_HISTORY_DEFAULT_LIMIT = 10
const SESSION_HISTORY_MAX_LIMIT = 50
const WEAK_SPOT_COUNT = 3
const QUIZ_PREP_HISTORY_LIMIT = 5
// Phase 10 daily-maintenance job constants.
const DECAY_GRACE_DAYS = 7 // matches src/engine/mastery.js's DECAY_GRACE_DAYS
// checkBankHealth's "unseen" counts are inherently per-student — for a
// pack-wide daily report with no specific student in mind, this reuses the
// same reference account scripts/manage-bank.js's status/fill-all commands
// already use, so all three share one well-known reference point.
const BANK_HEALTH_REFERENCE_EMAIL = 'engine-test@family-tutor.local'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

function unitWeightMid(unit) {
  return (unit.ap_exam_weight_min + unit.ap_exam_weight_max) / 2
}

// The Progress heatmap's color scale (see MasteryHeatmap.tsx) uses
// different score boundaries and labels than mastery.js's getMasteryLabel
// (0.4-0.59 is "Developing" there but "Practicing" here) — a deliberate,
// spec-driven split. getMasteryLabel stays the label shown throughout the
// session flow (SessionSummary, api/session's leanTopic, WeakSpotCard
// below); this scale exists only for heatmap cell coloring. "Not started"
// is attempts === 0, not merely a low score, so a topic that's been tried
// and is still struggling reads differently from one never attempted.
function heatmapTier(masteryScore, attempts) {
  if (attempts === 0) return { tier: 'none', label: 'Not started' }
  if (masteryScore < 0.4) return { tier: 'developing', label: 'Developing' }
  if (masteryScore < 0.6) return { tier: 'practicing', label: 'Practicing' }
  if (masteryScore < 0.8) return { tier: 'solid', label: 'Solid' }
  return { tier: 'mastered', label: 'Mastered' }
}

function daysSinceSeenMultiplier(daysSinceSeen) {
  if (daysSinceSeen === null) return 2.0
  if (daysSinceSeen > 14) return 1.5
  if (daysSinceSeen >= 7) return 1.2
  return 1.0
}

function daysSinceSeenFor(lastSeenIso) {
  if (!lastSeenIso) return null
  return Math.floor((Date.now() - new Date(lastSeenIso).getTime()) / MS_PER_DAY)
}

function buildMasterySummaryUnits(pack, masteryByTopicId, unlockedTopicIds) {
  const unlockedSet = new Set(unlockedTopicIds)

  return [...pack.units]
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      ap_exam_weight_min: unit.ap_exam_weight_min,
      ap_exam_weight_max: unit.ap_exam_weight_max,
      topics: unit.topics.map((topic) => {
        const record = masteryByTopicId.get(topic.id)
        const attempts = record?.attempts ?? 0
        const masteryScore = record?.mastery_score ?? 0
        const { tier, label } = heatmapTier(masteryScore, attempts)

        return {
          id: topic.id,
          name: topic.name,
          type: topic.type,
          difficulty: topic.difficulty,
          input_mode: topic.input_mode,
          bc_only: topic.bc_only ?? false,
          unlocked: unlockedSet.has(topic.id),
          mastery_score: masteryScore,
          attempts,
          last_seen: record?.last_seen ?? null,
          tier,
          label
        }
      })
    }))
    .sort((a, b) => unitWeightMid(b) - unitWeightMid(a))
}

function buildWeakSpots(pack, masteryByTopicId, unlockedTopicIds, limit = WEAK_SPOT_COUNT) {
  const unlockedSet = new Set(unlockedTopicIds)
  const scored = []

  for (const unit of pack.units) {
    for (const topic of unit.topics) {
      if (!unlockedSet.has(topic.id)) continue

      const record = masteryByTopicId.get(topic.id)
      const attempts = record?.attempts ?? 0
      const masteryScore = record?.mastery_score ?? 0
      const daysSinceSeen = daysSinceSeenFor(record?.last_seen ?? null)
      const score =
        (1 - masteryScore) * unitWeightMid(unit) * daysSinceSeenMultiplier(daysSinceSeen) * (attempts === 0 ? 1.5 : 1.0)

      scored.push({
        topic_id: topic.id,
        topic_name: topic.name,
        unit_name: unit.name,
        mastery_score: masteryScore,
        mastery_label: getMasteryLabel(masteryScore),
        attempts,
        days_since_seen: daysSinceSeen,
        score
      })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

function topicNamesFor(pack, topicIds) {
  const nameById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t.name])))
  return (topicIds ?? []).map((id) => nameById.get(id) ?? id)
}

function quizEventSummary(pack, row) {
  const daysUntil = Math.ceil((new Date(`${row.quiz_date}T00:00:00.000Z`).getTime() - Date.now()) / MS_PER_DAY)
  return {
    id: row.id,
    pack_id: row.pack_id,
    topic_names: topicNamesFor(pack, row.topic_ids),
    quiz_date: row.quiz_date,
    days_until_quiz: daysUntil
  }
}

function quizResultSummary(pack, row) {
  return {
    id: row.id,
    topic_names: topicNamesFor(pack, row.topic_ids),
    quiz_date: row.quiz_date,
    post_quiz_result: row.post_quiz_result
  }
}

// Builds the last-84-days activity grid from a flat list of session start
// timestamps — collapses same-day sessions to one active day, same
// "did she study anything that day" semantics the spec's parent combined
// view asks for.
function buildStreakDays(startedAtList) {
  const activeDates = new Set(startedAtList.map((iso) => toDateOnly(new Date(iso))))
  const days = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  for (let i = STREAK_CALENDAR_DAYS - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * MS_PER_DAY)
    const dateStr = toDateOnly(date)
    days.push({ date: dateStr, active: activeDates.has(dateStr) })
  }

  return days
}

async function requireRole(res, profile, role) {
  if (profile.role !== role) {
    res.status(403).json({ error: 'Forbidden' })
    return false
  }
  return true
}

// ---- student: own-data types -------------------------------------------

// Which packs this student is actually enrolled in (user_course_packs has
// no RLS policy — same reasoning as every other table this file reads —
// so the client can't query it directly). Home.jsx and WelcomeFlow.tsx use
// this to stop showing every pack that exists in the codebase; previously
// both called getAllPacks() unfiltered, so a student saw every course pack
// ever authored regardless of whether anyone actually assigned it to them.
async function handleEnrolledPacks(req, res, user, admin) {
  const { data: rows, error } = await admin.from('user_course_packs').select('pack_id').eq('user_id', user.id)
  if (error) throw error
  res.status(200).json({ pack_ids: (rows ?? []).map((r) => r.pack_id) })
}

async function handleMasterySummary(req, res, user, admin) {
  const packId = typeof req.query.pack_id === 'string' ? req.query.pack_id : null
  if (!packId) return res.status(400).json({ error: 'pack_id is required' })

  let pack
  try {
    pack = getPack(packId)
  } catch {
    return res.status(400).json({ error: `Unknown pack "${packId}"` })
  }

  const [{ data: masteryRows, error: masteryErr }, { data: unlockRows, error: unlockErr }] = await Promise.all([
    admin.from('mastery_records').select('*').eq('user_id', user.id).eq('pack_id', packId),
    admin.from('topic_unlock_log').select('topic_id').eq('user_id', user.id).eq('pack_id', packId)
  ])
  if (masteryErr) throw masteryErr
  if (unlockErr) throw unlockErr

  const masteryByTopicId = new Map((masteryRows ?? []).map((r) => [r.topic_id, r]))
  const unlockedTopicIds = (unlockRows ?? []).map((r) => r.topic_id)

  res.status(200).json({
    pack_name: pack.name,
    units: buildMasterySummaryUnits(pack, masteryByTopicId, unlockedTopicIds)
  })
}

async function handleWeakSpots(req, res, user, admin) {
  const packId = typeof req.query.pack_id === 'string' ? req.query.pack_id : null
  if (!packId) return res.status(400).json({ error: 'pack_id is required' })

  let pack
  try {
    pack = getPack(packId)
  } catch {
    return res.status(400).json({ error: `Unknown pack "${packId}"` })
  }

  const [{ data: masteryRows, error: masteryErr }, { data: unlockRows, error: unlockErr }] = await Promise.all([
    admin.from('mastery_records').select('*').eq('user_id', user.id).eq('pack_id', packId),
    admin.from('topic_unlock_log').select('topic_id').eq('user_id', user.id).eq('pack_id', packId)
  ])
  if (masteryErr) throw masteryErr
  if (unlockErr) throw unlockErr

  const masteryByTopicId = new Map((masteryRows ?? []).map((r) => [r.topic_id, r]))
  const unlockedTopicIds = (unlockRows ?? []).map((r) => r.topic_id)

  res.status(200).json({ weak_spots: buildWeakSpots(pack, masteryByTopicId, unlockedTopicIds) })
}

async function handleSessionHistory(req, res, user, admin) {
  const packId = typeof req.query.pack_id === 'string' ? req.query.pack_id : null
  if (!packId) return res.status(400).json({ error: 'pack_id is required' })

  let pack
  try {
    pack = getPack(packId)
  } catch {
    return res.status(400).json({ error: `Unknown pack "${packId}"` })
  }

  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : null

  if (sessionId) {
    const { data: sessionRow, error: sessionErr } = await admin
      .from('sessions')
      .select('id, user_id, pack_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (sessionErr) throw sessionErr
    if (!sessionRow || sessionRow.user_id !== user.id || sessionRow.pack_id !== packId) {
      return res.status(403).json({ error: 'Session does not belong to this user' })
    }

    const { data: logRows, error: logErr } = await admin
      .from('question_log')
      .select('topic_id, question_type, correct, frq_score, question_id, timestamp')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true })
    if (logErr) throw logErr

    const questionIds = (logRows ?? []).map((r) => r.question_id).filter(Boolean)
    let questionTextById = new Map()
    if (questionIds.length > 0) {
      const { data: bankRows, error: bankErr } = await admin
        .from('question_bank')
        .select('id, question_text')
        .in('id', questionIds)
      if (bankErr) throw bankErr
      // Only question_text is selected — never correct_answer/explanation/
      // key_reasoning/rubric, same "answer key stays server-side" rule
      // api/bank/index.js's GET handler enforces (see README's Phase 6
      // bug-fix notes on what "strip the answer key" actually required).
      questionTextById = new Map((bankRows ?? []).map((r) => [r.id, r.question_text]))
    }

    const topicNameById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t.name])))

    res.status(200).json({
      session_id: sessionId,
      questions: (logRows ?? []).map((r) => ({
        topic_name: topicNameById.get(r.topic_id) ?? r.topic_id,
        question_type: r.question_type,
        question_text: r.question_id ? questionTextById.get(r.question_id) ?? null : null,
        correct: r.correct,
        frq_score: r.frq_score
      }))
    })
    return
  }

  const limitParam = Number(req.query.limit)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, SESSION_HISTORY_MAX_LIMIT) : SESSION_HISTORY_DEFAULT_LIMIT

  const { data: sessionRows, error: sessionsErr } = await admin
    .from('sessions')
    .select('id, started_at, ended_at, duration_seconds, questions_attempted, questions_correct, topics_covered')
    .eq('user_id', user.id)
    .eq('pack_id', packId)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (sessionsErr) throw sessionsErr

  res.status(200).json({
    sessions: (sessionRows ?? []).map((s) => ({
      id: s.id,
      started_at: s.started_at,
      duration_seconds: s.duration_seconds,
      questions_attempted: s.questions_attempted,
      questions_correct: s.questions_correct,
      topic_names: topicNamesFor(pack, s.topics_covered)
    }))
  })
}

async function handleStreakCalendar(req, res, user, admin) {
  const packId = typeof req.query.pack_id === 'string' ? req.query.pack_id : null
  const cutoffIso = new Date(Date.now() - STREAK_CALENDAR_DAYS * MS_PER_DAY).toISOString()

  let query = admin.from('sessions').select('started_at').eq('user_id', user.id).gte('started_at', cutoffIso)
  if (packId) query = query.eq('pack_id', packId)

  const { data, error } = await query
  if (error) throw error

  res.status(200).json({ days: buildStreakDays((data ?? []).map((r) => r.started_at)) })
}

// ---- parent: linked-student types ---------------------------------------

async function handleParentStudents(req, res, user, admin) {
  const { data: links, error: linksErr } = await admin.from('family_links').select('student_id').eq('parent_id', user.id)
  if (linksErr) throw linksErr

  const studentIds = (links ?? []).map((l) => l.student_id)
  if (studentIds.length === 0) return res.status(200).json({ students: [] })

  const [
    { data: users, error: usersErr },
    { data: enrollments, error: enrollErr },
    { data: streakRows, error: streakErr },
    { data: logRows, error: logErr },
    { data: sessionRows, error: sessionErr }
  ] = await Promise.all([
    admin.from('users').select('id, name').in('id', studentIds),
    admin.from('user_course_packs').select('user_id, pack_id').in('user_id', studentIds),
    admin.from('streaks').select('user_id, current_streak, longest_streak').in('user_id', studentIds),
    admin.from('classroom_logs').select('user_id, logged_at').in('user_id', studentIds).order('logged_at', { ascending: false }),
    admin.from('sessions').select('user_id, started_at').in('user_id', studentIds).order('started_at', { ascending: false })
  ])
  if (usersErr) throw usersErr
  if (enrollErr) throw enrollErr
  if (streakErr) throw streakErr
  if (logErr) throw logErr
  if (sessionErr) throw sessionErr

  const streakByUser = new Map((streakRows ?? []).map((r) => [r.user_id, r]))
  const courseCountByUser = new Map()
  for (const e of enrollments ?? []) courseCountByUser.set(e.user_id, (courseCountByUser.get(e.user_id) ?? 0) + 1)

  // Phase 10 crunch badge — same daysUntilExam <= examCrunchWeeks*7
  // condition session-mode.js's detectSessionMode uses, computed here
  // (not fetched from the engine) since this is just a date comparison
  // against pack data, no session/mastery state needed.
  const crunchCoursesByUser = new Map()
  for (const e of enrollments ?? []) {
    let pack
    try {
      pack = getPack(e.pack_id)
    } catch {
      continue // stale/unknown pack id — skip rather than 500 the dashboard
    }
    const daysUntilExam = Math.ceil((new Date(pack.exam_date).getTime() - Date.now()) / MS_PER_DAY)
    if (daysUntilExam > pack.exam_crunch_weeks * 7) continue

    if (!crunchCoursesByUser.has(e.user_id)) crunchCoursesByUser.set(e.user_id, [])
    crunchCoursesByUser.get(e.user_id).push({ pack_name: pack.name, days_until_exam: daysUntilExam })
  }

  // Rows are ordered descending, so the first occurrence per user is the
  // most recent — same "keep only the first" trick the pre-Phase-9
  // ParentDashboard.jsx used for classroom_logs.
  const lastLogByUser = new Map()
  for (const row of logRows ?? []) {
    if (!lastLogByUser.has(row.user_id)) lastLogByUser.set(row.user_id, row.logged_at)
  }
  const lastSessionByUser = new Map()
  for (const row of sessionRows ?? []) {
    if (!lastSessionByUser.has(row.user_id)) lastSessionByUser.set(row.user_id, row.started_at)
  }

  const students = (users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    current_streak: streakByUser.get(u.id)?.current_streak ?? 0,
    course_count: courseCountByUser.get(u.id) ?? 0,
    last_session_at: lastSessionByUser.get(u.id) ?? null,
    last_log_at: lastLogByUser.get(u.id) ?? null,
    crunch_courses: crunchCoursesByUser.get(u.id) ?? []
  }))

  res.status(200).json({ students })
}

async function handleParentStudentDetail(req, res, user, admin) {
  const studentId = typeof req.query.student_id === 'string' ? req.query.student_id : null
  if (!studentId) return res.status(400).json({ error: 'student_id is required' })

  const { data: link, error: linkErr } = await admin
    .from('family_links')
    .select('student_id')
    .eq('parent_id', user.id)
    .eq('student_id', studentId)
    .maybeSingle()
  if (linkErr) throw linkErr
  if (!link) return res.status(403).json({ error: 'Not linked to this student' })

  const [{ data: studentRow, error: studentErr }, { data: enrollments, error: enrollErr }, { data: streakRow, error: streakErr }] =
    await Promise.all([
      admin.from('users').select('id, name').eq('id', studentId).maybeSingle(),
      admin.from('user_course_packs').select('pack_id').eq('user_id', studentId),
      admin.from('streaks').select('current_streak, longest_streak').eq('user_id', studentId).maybeSingle()
    ])
  if (studentErr) throw studentErr
  if (enrollErr) throw enrollErr
  if (streakErr) throw streakErr
  if (!studentRow) return res.status(404).json({ error: 'Student not found' })

  const packIds = Array.from(
    new Set((enrollments ?? []).map((e) => e.pack_id).filter((id) => {
      try {
        getPack(id)
        return true
      } catch {
        return false // stale/unknown pack id — skip rather than 500 the whole dashboard
      }
    }))
  )

  if (packIds.length === 0) {
    return res.status(200).json({
      student: studentRow,
      streak: { current_streak: streakRow?.current_streak ?? 0, longest_streak: streakRow?.longest_streak ?? 0 },
      courses: [],
      streak_calendar: { days: buildStreakDays([]) },
      session_history: []
    })
  }

  const streakCutoffIso = new Date(Date.now() - STREAK_CALENDAR_DAYS * MS_PER_DAY).toISOString()

  const [
    { data: masteryRows, error: masteryErr },
    { data: unlockRows, error: unlockErr },
    { data: logRows, error: logErr },
    { data: quizRows, error: quizErr },
    { data: historySessionRows, error: historyErr },
    { data: streakSessionRows, error: streakSessionErr }
  ] = await Promise.all([
    admin.from('mastery_records').select('*').eq('user_id', studentId).in('pack_id', packIds),
    admin.from('topic_unlock_log').select('pack_id, topic_id').eq('user_id', studentId).in('pack_id', packIds),
    admin
      .from('classroom_logs')
      .select('pack_id, logged_at, input_method')
      .eq('user_id', studentId)
      .in('pack_id', packIds)
      .order('logged_at', { ascending: false }),
    admin.from('quiz_prep_events').select('*').eq('user_id', studentId).in('pack_id', packIds).order('quiz_date', { ascending: false }),
    admin
      .from('sessions')
      .select('id, pack_id, started_at, duration_seconds, questions_attempted, questions_correct, topics_covered')
      .eq('user_id', studentId)
      .in('pack_id', packIds)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(SESSION_HISTORY_DEFAULT_LIMIT),
    admin.from('sessions').select('started_at').eq('user_id', studentId).in('pack_id', packIds).gte('started_at', streakCutoffIso)
  ])
  if (masteryErr) throw masteryErr
  if (unlockErr) throw unlockErr
  if (logErr) throw logErr
  if (quizErr) throw quizErr
  if (historyErr) throw historyErr
  if (streakSessionErr) throw streakSessionErr

  const masteryByPack = new Map()
  for (const row of masteryRows ?? []) {
    if (!masteryByPack.has(row.pack_id)) masteryByPack.set(row.pack_id, new Map())
    masteryByPack.get(row.pack_id).set(row.topic_id, row)
  }

  const unlockedByPack = new Map()
  for (const row of unlockRows ?? []) {
    if (!unlockedByPack.has(row.pack_id)) unlockedByPack.set(row.pack_id, [])
    unlockedByPack.get(row.pack_id).push(row.topic_id)
  }

  const lastLogByPack = new Map()
  for (const row of logRows ?? []) {
    if (!lastLogByPack.has(row.pack_id)) lastLogByPack.set(row.pack_id, row) // first occurrence = most recent (desc order)
  }

  const quizRowsByPack = new Map()
  for (const row of quizRows ?? []) {
    if (!quizRowsByPack.has(row.pack_id)) quizRowsByPack.set(row.pack_id, [])
    quizRowsByPack.get(row.pack_id).push(row)
  }

  const today = todayStr()
  const courses = packIds.map((packId) => {
    const pack = getPack(packId)
    const masteryByTopicId = masteryByPack.get(packId) ?? new Map()
    const unlockedTopicIds = unlockedByPack.get(packId) ?? []
    const packQuizRows = quizRowsByPack.get(packId) ?? []

    const activeRow = packQuizRows
      .filter((r) => r.expired_at === null && r.quiz_date >= today)
      .sort((a, b) => new Date(a.quiz_date).getTime() - new Date(b.quiz_date).getTime())[0]

    const historyRows = packQuizRows.filter((r) => r.post_quiz_result !== null).slice(0, QUIZ_PREP_HISTORY_LIMIT)
    const lastLog = lastLogByPack.get(packId)

    return {
      pack_id: packId,
      pack_name: pack.name,
      exam_date: pack.exam_date,
      school_year_start: pack.school_year_start,
      exam_crunch_weeks: pack.exam_crunch_weeks,
      units: buildMasterySummaryUnits(pack, masteryByTopicId, unlockedTopicIds),
      weak_spots: buildWeakSpots(pack, masteryByTopicId, unlockedTopicIds),
      last_log: lastLog ? { logged_at: lastLog.logged_at, input_method: lastLog.input_method } : null,
      active_quiz_prep: activeRow ? quizEventSummary(pack, activeRow) : null,
      quiz_prep_history: historyRows.map((r) => quizResultSummary(pack, r))
    }
  })

  const packNameById = new Map(courses.map((c) => [c.pack_id, c.pack_name]))

  res.status(200).json({
    student: studentRow,
    streak: { current_streak: streakRow?.current_streak ?? 0, longest_streak: streakRow?.longest_streak ?? 0 },
    courses,
    streak_calendar: { days: buildStreakDays((streakSessionRows ?? []).map((r) => r.started_at)) },
    session_history: (historySessionRows ?? []).map((s) => ({
      id: s.id,
      pack_id: s.pack_id,
      pack_name: packNameById.get(s.pack_id) ?? s.pack_id,
      started_at: s.started_at,
      duration_seconds: s.duration_seconds,
      questions_attempted: s.questions_attempted,
      questions_correct: s.questions_correct,
      topic_names: topicNamesFor(getPack(s.pack_id), s.topics_covered)
    }))
  })
}

// ---- cron: daily maintenance ---------------------------------------------
//
// Phase 10. No dedicated api/jobs/daily-maintenance.js file — the app is
// already at Vercel Hobby's 12-function cap (see README's Phase 6/8/9
// notes on this same constraint), so this is a new `type=` branch on the
// existing GET dispatcher instead. vercel.json's cron `path` points at
// `/api/progress?type=daily-maintenance` directly. Auth is a CRON_SECRET
// bearer check, not the normal Supabase-JWT flow below (a Vercel Cron
// request carries no user session) — dispatched before getUserFromRequest
// runs at all, see handler() below.

async function getBankHealthReferenceUserId(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email === BANK_HEALTH_REFERENCE_EMAIL)?.id ?? null
}

// Batch counterpart to startSession's per-user decay step
// (session-orchestrator.js) — same pure applyDecay() function, just run
// across every stale mastery_records row in one sweep instead of one
// user/pack at a time.
async function runMasteryDecaySweep(admin) {
  const cutoffIso = new Date(Date.now() - DECAY_GRACE_DAYS * MS_PER_DAY).toISOString()

  const { data: rows, error } = await admin.from('mastery_records').select('*').lt('last_seen', cutoffIso)
  if (error) throw error

  // rowToMasteryRecord's shape has no user_id (session-orchestrator.js only
  // ever calls it already scoped to one user/pack) — added back here since
  // this sweep spans every user.
  const records = (rows ?? []).map((row) => ({ ...rowToMasteryRecord(row), user_id: row.user_id }))
  const decayed = applyDecay(records)

  let changed = 0
  for (let i = 0; i < decayed.length; i++) {
    if (decayed[i].mastery_score === records[i].mastery_score) continue
    const { error: updateErr } = await admin
      .from('mastery_records')
      .update({ mastery_score: decayed[i].mastery_score, updated_at: decayed[i].updated_at.toISOString() })
      .eq('user_id', decayed[i].user_id)
      .eq('pack_id', decayed[i].pack_id)
      .eq('topic_id', decayed[i].topic_id)
    if (updateErr) throw updateErr
    changed++
  }

  return { changed }
}

async function runBankHealthSweep(admin) {
  const referenceUserId = await getBankHealthReferenceUserId(admin)
  if (!referenceUserId) {
    return { triggered: 0, note: `${BANK_HEALTH_REFERENCE_EMAIL} not found — run scripts/test-engine.js once first` }
  }

  let triggered = 0
  for (const pack of getAllPacks()) {
    const health = await checkBankHealth(pack.id, referenceUserId)
    for (const entry of health.filter((h) => h.needs_fill)) {
      triggerBankFill(pack.id, entry.topic_id, entry.question_type)
      triggered++
    }
  }
  return { triggered }
}

async function runStreakStatsLog(admin) {
  const { data, error } = await admin.from('streaks').select('current_streak')
  if (error) throw error
  const rows = data ?? []
  const active = rows.filter((r) => r.current_streak > 0).length
  const longestCurrent = rows.reduce((max, r) => Math.max(max, r.current_streak), 0)
  return { total_students: rows.length, active_streaks: active, longest_current_streak: longestCurrent }
}

async function runStep(steps, name, fn) {
  try {
    const detail = await fn()
    steps.push({ name, ok: true, detail })
    console.log(`[daily-maintenance] ${name} ok:`, detail)
  } catch (err) {
    steps.push({ name, ok: false, error: err.message })
    console.error(`[daily-maintenance] ${name} failed:`, err)
  }
}

async function handleDailyMaintenance(req, res) {
  const admin = getSupabaseAdmin()
  const steps = []

  await runStep(steps, 'pacing_calendar_unlock', () => runPacingCalendarSweep(admin))
  await runStep(steps, 'mastery_decay', () => runMasteryDecaySweep(admin))
  await runStep(steps, 'quiz_prep_expiry', () => expireAllStaleQuizPrepEvents(admin))
  await runStep(steps, 'bank_health_check', () => runBankHealthSweep(admin))
  await runStep(steps, 'streak_stats', () => runStreakStatsLog(admin))

  const ok = steps.every((s) => s.ok)
  res.status(ok ? 200 : 207).json({ ok, steps })
}

// ---- dispatch --------------------------------------------------------

const STUDENT_TYPES = {
  'enrolled-packs': handleEnrolledPacks,
  'mastery-summary': handleMasterySummary,
  'weak-spots': handleWeakSpots,
  'session-history': handleSessionHistory,
  'streak-calendar': handleStreakCalendar
}

const PARENT_TYPES = {
  'parent-students': handleParentStudents,
  'parent-student-detail': handleParentStudentDetail
}

function isCronCaller(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const type = typeof req.query.type === 'string' ? req.query.type : null

  // Cron dispatch happens before any Supabase-JWT auth — a Vercel Cron
  // request has no user session, only the CRON_SECRET bearer header.
  if (type === 'daily-maintenance') {
    if (!isCronCaller(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      await handleDailyMaintenance(req, res)
    } catch (err) {
      res.status(500).json({ error: 'Daily maintenance failed', detail: err.message })
    }
    return
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getUserProfile(user.id)
  if (!profile) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const admin = getSupabaseAdmin()

  try {
    if (type && STUDENT_TYPES[type]) {
      if (!(await requireRole(res, profile, 'student'))) return
      await STUDENT_TYPES[type](req, res, user, admin)
      return
    }
    if (type && PARENT_TYPES[type]) {
      if (!(await requireRole(res, profile, 'parent'))) return
      await PARENT_TYPES[type](req, res, user, admin)
      return
    }
    res.status(400).json({ error: `Unknown or missing type "${type}"` })
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: err.message })
  }
}
