import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import QuizPrepCard from '../components/quiz-prep/QuizPrepCard.tsx'
import PostQuizPrompt from '../components/quiz-prep/PostQuizPrompt.tsx'
import CrunchCard from '../components/crunch/CrunchCard.tsx'
import WelcomeFlow from '../components/onboarding/WelcomeFlow.tsx'
import InstallPrompt from '../components/InstallPrompt.tsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { getAllPacks, getPack, getUnit, getTopic, getTopicsForWeek, getUnlockedTopics } from '../packs/loader'

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  return Math.ceil((target - today) / 86_400_000)
}

// Phase 10: same condition session-mode.js's detectSessionMode uses for
// exam-crunch — computed here from pack data alone (no engine/API call
// needed) so Home can decide which card to show before a session ever
// starts.
function isCrunchActive(pack) {
  return daysUntil(pack.exam_date) <= pack.exam_crunch_weeks * 7
}

function isSchoolYear(pack) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today >= new Date(pack.school_year_start)
}

export default function Home() {
  const { session, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [streak, setStreak] = useState(0)
  const [loggedToday, setLoggedToday] = useState({}) // pack_id -> topics_confirmed count
  const [sessionCompleteToday, setSessionCompleteToday] = useState({}) // pack_id -> { date, topicName, masteryLabel }
  const [activeQuizPrep, setActiveQuizPrep] = useState({}) // pack_id -> active event summary | null
  const [crunchPriorities, setCrunchPriorities] = useState({}) // pack_id -> [{ topic_name, mastery_label }]
  // Session.tsx bounces back here with this in location.state when
  // startSession finds an unanswered post-quiz prompt (see api/session's
  // requires_post_quiz branch) — "overlaid on Home, not blocking
  // navigation" per the Phase 8 spec.
  const [postQuizPrompt, setPostQuizPrompt] = useState(location.state?.postQuizPrompt ?? null)

  // Phase 10 summer onboarding gate: shown full-screen in place of the
  // normal Home body when this student has neither started a session
  // (falp:hasStartedFirstSession, set by Session.tsx's initSession) nor
  // finished the 2-session onboarding flow (falp:onboarding_complete, set
  // by PostOnboardingTransition). Read once — a session starting or
  // onboarding completing navigates away from /home anyway, so this never
  // needs to re-evaluate mid-mount.
  const [showWelcome] = useState(
    () =>
      localStorage.getItem('falp:hasStartedFirstSession') !== 'true' &&
      localStorage.getItem('falp:onboarding_complete') !== 'true'
  )

  useEffect(() => {
    let cancelled = false
    supabase
      .from('streaks')
      .select('current_streak')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStreak(data?.current_streak ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  useEffect(() => {
    let cancelled = false

    async function checkLoggedToday() {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data } = await supabase
        .from('classroom_logs')
        .select('pack_id, topics_confirmed, logged_at')
        .eq('user_id', session.user.id)
        .gte('logged_at', todayStart.toISOString())

      if (cancelled) return

      const byPack = {}
      for (const row of data ?? []) {
        byPack[row.pack_id] = (row.topics_confirmed ?? []).length
      }
      setLoggedToday(byPack)
    }

    checkLoggedToday()
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  useEffect(() => {
    // Written by SessionSummary.tsx when a session finishes — read here
    // rather than from Supabase since sessions/mastery_records have no RLS
    // policy yet (see migrations/002 and 003), so the frontend never
    // queries them directly with the anon key.
    const todayStr = new Date().toISOString().slice(0, 10)
    const result = {}
    for (const pack of getAllPacks()) {
      try {
        const raw = localStorage.getItem(`falp:sessionComplete:${pack.id}`)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        if (parsed.date === todayStr) result[pack.id] = parsed
      } catch {
        // Malformed entry — skip it rather than breaking the page.
      }
    }
    setSessionCompleteToday(result)
  }, [])

  useEffect(() => {
    // Consume location.state.postQuizPrompt once so a page refresh or
    // navigating back here later doesn't resurface it.
    if (location.state?.postQuizPrompt) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // Only ever needs to run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // quiz_prep_events has no RLS policy (same reasoning as the
    // sessionCompleteToday comment above) — read through the API, not
    // Supabase directly.
    let cancelled = false

    async function loadActiveQuizPrep() {
      const token = session?.access_token
      if (!token) return

      const entries = await Promise.all(
        getAllPacks().map(async (pack) => {
          try {
            const res = await fetch(`/api/quiz-prep?pack_id=${pack.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            })
            const body = await res.json()
            return [pack.id, res.ok ? body.active : null]
          } catch {
            return [pack.id, null]
          }
        })
      )

      if (!cancelled) setActiveQuizPrep(Object.fromEntries(entries))
    }

    loadActiveQuizPrep()
    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  useEffect(() => {
    // Crunch priorities (top 3, exam-weight-aware) — only fetched for
    // packs actually in crunch, reusing the existing weak-spots endpoint
    // Progress.tsx already calls rather than adding a new one.
    let cancelled = false

    async function loadCrunchPriorities() {
      const token = session?.access_token
      if (!token) return

      const crunchPacks = getAllPacks().filter(isCrunchActive)
      if (crunchPacks.length === 0) return

      const entries = await Promise.all(
        crunchPacks.map(async (pack) => {
          try {
            const res = await fetch(`/api/progress?type=weak-spots&pack_id=${pack.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            })
            const body = await res.json()
            const top3 = res.ok ? (body.weak_spots ?? []).slice(0, 3) : []
            return [pack.id, top3.map((w) => ({ topic_name: w.topic_name, mastery_label: w.mastery_label }))]
          } catch {
            return [pack.id, []]
          }
        })
      )

      if (!cancelled) setCrunchPriorities(Object.fromEntries(entries))
    }

    loadCrunchPriorities()
    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    // Exposed for manual testing per the Phase 3 milestone, e.g.
    // getPack('ap-physics-1') or getUnlockedTopics('ap-physics-1', '2026-08-11')
    window.getPack = getPack
    window.getAllPacks = getAllPacks
    window.getUnit = getUnit
    window.getTopic = getTopic
    window.getTopicsForWeek = getTopicsForWeek
    window.getUnlockedTopics = getUnlockedTopics
  }, [])

  if (showWelcome) {
    return <WelcomeFlow />
  }

  const packs = getAllPacks()

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar
        title="FALP"
        rightSlot={
          <Link to="/settings" aria-label="Settings" className="text-slate-500">
            ⚙️
          </Link>
        }
      />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {profile.name}</h1>

        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
          🔥 {streak} day streak
        </div>

        <div className="mt-6 space-y-3">
          {packs.map((pack) => {
            const days = daysUntil(pack.exam_date)
            const topicsLoggedCount = loggedToday[pack.id]
            const crunch = isCrunchActive(pack)
            const quizPrep = activeQuizPrep[pack.id]
            const completedToday = sessionCompleteToday[pack.id]

            // Home Screen Final Polish — exactly one primary card state
            // per course, in priority order: crunch > quiz-prep >
            // completed-today > default.
            const primaryState = crunch ? 'crunch' : quizPrep ? 'quiz-prep' : completedToday ? 'completed' : 'default'

            return (
              <div key={pack.id} className="space-y-2">
                {primaryState === 'crunch' && (
                  <CrunchCard
                    packId={pack.id}
                    packName={pack.name}
                    daysUntilExam={days}
                    examCrunchWeeks={pack.exam_crunch_weeks}
                    priorities={crunchPriorities[pack.id] ?? []}
                  />
                )}

                {primaryState === 'quiz-prep' && (
                  <QuizPrepCard packId={pack.id} topicNames={quizPrep.topic_names} daysUntilQuiz={quizPrep.days_until_quiz} />
                )}

                {primaryState === 'completed' && (
                  <div className="rounded-lg bg-emerald-50 px-4 py-3">
                    <p className="text-sm text-emerald-700">
                      Session complete ✓ — {completedToday.date}
                      {completedToday.topicName && (
                        <span className="block text-xs text-emerald-600">
                          {completedToday.topicName}
                          {completedToday.masteryLabel ? ` — ${completedToday.masteryLabel}` : ''}
                        </span>
                      )}
                    </p>
                    <Link to={`/session/${pack.id}`} className="mt-2 inline-block text-sm font-medium text-emerald-700 underline">
                      Practice more?
                    </Link>
                  </div>
                )}

                {primaryState === 'default' && (
                  <Link to={`/session/${pack.id}`} className="block rounded-lg border border-slate-200 bg-slate-100 px-4 py-5">
                    <p className="text-base font-medium text-slate-700">{pack.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{pack.units.length} units</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {days >= 0 ? `${days} days until exam` : 'Exam date passed'}
                    </p>
                  </Link>
                )}

                <Link to={`/progress/${pack.id}`} className="block text-sm text-slate-500 underline">
                  My Progress →
                </Link>

                {!isSchoolYear(pack) ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
                    School starts in {daysUntil(pack.school_year_start)} days. You'll log your classes here.
                  </p>
                ) : topicsLoggedCount !== undefined ? (
                  <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Logged ✓ — {topicsLoggedCount} topic{topicsLoggedCount === 1 ? '' : 's'} today
                  </div>
                ) : (
                  <Link
                    to={`/log/${pack.id}`}
                    className="block rounded-lg border border-dashed border-slate-300 px-4 py-3"
                  >
                    <span className="text-sm font-medium text-slate-700">{pack.name}</span>
                    <span className="block text-sm text-slate-500">What did you cover today? 📝</span>
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </main>

      {postQuizPrompt && (
        <PostQuizPrompt
          eventId={postQuizPrompt.eventId}
          topicNames={postQuizPrompt.topicNames}
          onDone={() => setPostQuizPrompt(null)}
        />
      )}

      <InstallPrompt />
    </div>
  )
}
