import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import SessionShell from '../components/session/SessionShell'
import QuestionCard from '../components/session/QuestionCard'
import FeedbackCard from '../components/session/FeedbackCard'
import SessionSummary from '../components/session/SessionSummary'
import PostOnboardingTransition from '../components/onboarding/PostOnboardingTransition'
import SessionError, { BankLoadingNotice } from '../components/session/SessionError'
import type { SessionErrorKind } from '../components/session/SessionError'
import type {
  AnsweredResult,
  GradeResult,
  QuestionType,
  ServedQuestion,
  SessionEndResponse,
  SessionPlanResponse,
  SessionTopic,
  StoredSessionState
} from '../components/session/types'

type Phase = 'loading' | 'resume-prompt' | 'question' | 'feedback' | 'summary' | 'post-onboarding' | 'error'

interface ErrorInfo {
  kind: SessionErrorKind
  message?: string
  onRetry?: () => void
  onSkip?: () => void
  exhausted?: boolean
}

const QUESTION_TYPE_CYCLE: QuestionType[] = ['mc', 'conceptual', 'frq']
// Onboarding never serves FRQ ("too intimidating to start" per spec) — a
// 3-question onboarding session cycling the normal 3-type list would hit
// FRQ on question 3, so onboarding gets its own fixed cycle.
const ONBOARDING_QUESTION_TYPE_CYCLE: QuestionType[] = ['mc', 'conceptual', 'mc']
const BANK_EMPTY_MAX_RETRIES = 3
const BANK_EMPTY_RETRY_DELAY_MS = 5000
const GRADING_TIMEOUT_MS = 15000
const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const CRUNCH_ENCOURAGEMENT_SECONDS = 20 * 60

function storageKey(packId: string) {
  return `falp:activeSession:${packId}`
}

function readStoredSession(packId: string): StoredSessionState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(packId))
    return raw ? (JSON.parse(raw) as StoredSessionState) : null
  } catch {
    return null
  }
}

function writeStoredSession(packId: string, state: StoredSessionState) {
  sessionStorage.setItem(storageKey(packId), JSON.stringify(state))
}

function clearStoredSession(packId: string) {
  sessionStorage.removeItem(storageKey(packId))
}

async function authToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}

// Photo grading omits a `correct` boolean entirely (see api/grading/grade.js
// gradePhoto's prompt) — every result type is normalized down to a single
// correct/incorrect boolean here so the session summary can score topics
// uniformly regardless of which question type produced the result.
function deriveCorrect(result: GradeResult, questionType: QuestionType): boolean {
  if (questionType === 'mc' && 'correct' in result) return result.correct
  if ('frq_score' in result && result.frq_score !== null) return result.frq_score >= 3
  if ('score_normalized' in result) return result.score_normalized >= 0.75
  return 'correct' in result ? result.correct : false
}

export default function Session() {
  const { packId } = useParams<{ packId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // Set by the Progress view's "Practice this topic" / "Practice weak
  // spots" shortcuts (src/components/progress) — forces these topics into
  // the plan instead of normal adaptive selection. Read once on mount;
  // not re-read on subsequent renders since initSession only ever runs once.
  const forceTopicIdsRef = useRef<string[] | undefined>(
    Array.isArray((location.state as { forceTopicIds?: string[] } | null)?.forceTopicIds)
      ? (location.state as { forceTopicIds: string[] }).forceTopicIds
      : undefined
  )

  const [phase, setPhase] = useState<Phase>('loading')
  const [plan, setPlan] = useState<SessionPlanResponse | null>(null)
  const [storedForPrompt, setStoredForPrompt] = useState<StoredSessionState | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [currentQuestion, setCurrentQuestion] = useState<ServedQuestion | null>(null)
  const [currentTopic, setCurrentTopic] = useState<SessionTopic | null>(null)
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null)
  const [answeredResults, setAnsweredResults] = useState<AnsweredResult[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [summary, setSummary] = useState<SessionEndResponse | null>(null)

  const startedAtMsRef = useRef<number | null>(null)
  const questionStartedAtRef = useRef<number>(Date.now())
  const bankRetryCountRef = useRef(0)

  function goHome() {
    navigate('/home')
  }

  function persistProgress(index: number, answered: AnsweredResult[], currentPlan: SessionPlanResponse) {
    if (!packId || !startedAtMsRef.current) return
    writeStoredSession(packId, {
      sessionId: currentPlan.session_id,
      packName: currentPlan.pack_name,
      mode: currentPlan.mode,
      topics: currentPlan.topics,
      targetQuestionCount: currentPlan.target_question_count,
      targetDurationMinutes: currentPlan.target_duration_minutes,
      questionIndex: index,
      answeredResults: answered,
      startedAtIso: new Date(startedAtMsRef.current).toISOString()
    })
  }

  async function serveQuestionAt(forPlan: SessionPlanResponse, index: number) {
    setPhase('loading')
    const topic = forPlan.topics[index % forPlan.topics.length]
    const cycle = forPlan.mode === 'onboarding' ? ONBOARDING_QUESTION_TYPE_CYCLE : QUESTION_TYPE_CYCLE
    const questionType = cycle[index % cycle.length]

    try {
      const token = await authToken()
      const params = new URLSearchParams({
        pack_id: packId as string,
        topic_id: topic.id,
        question_type: questionType,
        difficulty: String(topic.difficulty)
      })
      const res = await fetch(`/api/bank?${params}`, { headers: { Authorization: `Bearer ${token}` } })

      if (res.status === 503) {
        bankRetryCountRef.current += 1
        if (bankRetryCountRef.current > BANK_EMPTY_MAX_RETRIES) {
          setErrorInfo({ kind: 'bank-empty', exhausted: true })
          setPhase('error')
        } else {
          setErrorInfo({ kind: 'bank-empty', exhausted: false })
          setPhase('error')
          setTimeout(() => serveQuestionAt(forPlan, index), BANK_EMPTY_RETRY_DELAY_MS)
        }
        return
      }

      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to load question')

      bankRetryCountRef.current = 0
      setCurrentQuestion(body.question)
      setCurrentTopic(topic)
      setGradeResult(null)
      questionStartedAtRef.current = Date.now()
      setPhase('question')
    } catch (err) {
      setErrorInfo({
        kind: 'network',
        message: err instanceof Error ? err.message : undefined,
        onRetry: () => serveQuestionAt(forPlan, index)
      })
      setPhase('error')
    }
  }

  async function beginPlan(planResp: SessionPlanResponse, resumeIndex: number, resumeAnswered: AnsweredResult[]) {
    if (planResp.topics.length === 0 || planResp.target_question_count === 0) {
      setErrorInfo({ kind: 'session-load', message: 'No topics are unlocked yet for this course.' })
      setPhase('error')
      return
    }
    setPlan(planResp)
    setQuestionIndex(resumeIndex)
    setAnsweredResults(resumeAnswered)
    await serveQuestionAt(planResp, resumeIndex)
  }

  async function initSession() {
    setPhase('loading')
    try {
      const token = await authToken()
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pack_id: packId,
          ...(forceTopicIdsRef.current ? { topic_ids: forceTopicIdsRef.current } : {})
        })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to start session')

      // startSession found a quiz_prep_event whose quiz passed with no
      // post_quiz_result yet and returned early without creating a
      // session row (see session-orchestrator.js). Bounce back to Home,
      // which shows PostQuizPrompt overlaid — no session ever starts here.
      if (body.requires_post_quiz) {
        navigate('/home', {
          replace: true,
          state: { postQuizPrompt: { eventId: body.event_id, topicNames: body.topic_names } }
        })
        return
      }

      // A real session actually started (not the requires_post_quiz early
      // return above) — used by Home.jsx's onboarding-welcome gate so a
      // page refresh or navigating away mid-first-session never re-shows
      // WelcomeFlow.
      localStorage.setItem('falp:hasStartedFirstSession', 'true')

      startedAtMsRef.current = Date.now()
      setElapsedSeconds(0)
      await beginPlan(body as SessionPlanResponse, 0, [])
    } catch (err) {
      setErrorInfo({ kind: 'session-load', message: err instanceof Error ? err.message : undefined, onRetry: initSession })
      setPhase('error')
    }
  }

  async function resumeStoredSession(stored: StoredSessionState) {
    const restoredPlan: SessionPlanResponse = {
      session_id: stored.sessionId,
      pack_name: stored.packName,
      mode: stored.mode,
      topics: stored.topics,
      target_question_count: stored.targetQuestionCount,
      target_duration_minutes: stored.targetDurationMinutes,
      notes: []
    }
    startedAtMsRef.current = Date.parse(stored.startedAtIso)
    setElapsedSeconds(Math.floor((Date.now() - startedAtMsRef.current) / 1000))
    await beginPlan(restoredPlan, stored.questionIndex, stored.answeredResults)
  }

  async function endStoredSessionBestEffort(sessionId: string) {
    try {
      const token = await authToken()
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId })
      })
    } catch {
      // Best effort — a stale session getting cleaned up server-side isn't
      // worth blocking a fresh start over.
    }
  }

  useEffect(() => {
    if (!packId) return

    // A forced-topic request (Practice this topic / Practice weak spots)
    // is an explicit, deliberate choice — don't let a stale resumable
    // session for this pack intercept it with the resume prompt instead.
    if (forceTopicIdsRef.current) {
      clearStoredSession(packId)
      initSession()
      return
    }

    const stored = readStoredSession(packId)
    if (!stored) {
      initSession()
      return
    }

    const ageMs = Date.now() - Date.parse(stored.startedAtIso)
    if (ageMs > TWO_HOURS_MS) {
      endStoredSessionBestEffort(stored.sessionId)
      clearStoredSession(packId)
      initSession()
      return
    }

    setStoredForPrompt(stored)
    setPhase('resume-prompt')
    // Only ever needs to run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])

  useEffect(() => {
    if (!plan || phase === 'summary') return
    const id = setInterval(() => {
      if (startedAtMsRef.current) setElapsedSeconds(Math.floor((Date.now() - startedAtMsRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [plan, phase])

  async function submitAnswer(payload: Record<string, unknown>): Promise<GradeResult> {
    if (!currentQuestion || !plan) throw new Error('No active question')
    const timeSpentSeconds = Math.round((Date.now() - questionStartedAtRef.current) / 1000)
    const body = { question_id: currentQuestion.id, session_id: plan.session_id, time_spent_seconds: timeSpentSeconds, ...payload }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GRADING_TIMEOUT_MS)

    try {
      const token = await authToken()
      const res = await fetch('/api/grading/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const resBody = await res.json()
      if (!res.ok) throw new Error(resBody.error || 'Grading failed')
      return resBody as GradeResult
    } catch (err) {
      clearTimeout(timeoutId)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'

      const retry = async () => {
        try {
          const result = await submitAnswer(payload)
          handleGraded(result)
        } catch {
          // submitAnswer already set a fresh error state on failure.
        }
      }

      setErrorInfo({
        kind: isTimeout ? 'grading-timeout' : 'network',
        message: !isTimeout && err instanceof Error ? err.message : undefined,
        onRetry: retry,
        onSkip: isTimeout ? skipCurrentQuestion : undefined
      })
      setPhase('error')
      throw err
    }
  }

  function handleGraded(result: GradeResult) {
    if (!currentQuestion || !currentTopic || !plan) return
    const frqScore = 'frq_score' in result ? result.frq_score : null

    const answered: AnsweredResult = {
      topic_id: currentTopic.id,
      topic_name: currentTopic.name,
      question_type: currentQuestion.question_type,
      correct: deriveCorrect(result, currentQuestion.question_type),
      frq_score: frqScore
    }
    const nextAnswered = [...answeredResults, answered]
    setAnsweredResults(nextAnswered)
    setGradeResult(result)
    persistProgress(questionIndex, nextAnswered, plan)
    setPhase('feedback')
  }

  function skipCurrentQuestion() {
    if (!plan) return
    const nextIndex = questionIndex + 1
    setQuestionIndex(nextIndex)
    persistProgress(nextIndex, answeredResults, plan)
    if (nextIndex >= plan.target_question_count) {
      finishSession()
    } else {
      serveQuestionAt(plan, nextIndex)
    }
  }

  function handleNext() {
    if (!plan) return
    const nextIndex = questionIndex + 1
    setQuestionIndex(nextIndex)
    persistProgress(nextIndex, answeredResults, plan)
    if (nextIndex >= plan.target_question_count) {
      finishSession()
    } else {
      serveQuestionAt(plan, nextIndex)
    }
  }

  async function finishSession() {
    if (!plan) return
    setPhase('loading')
    try {
      const token = await authToken()
      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: plan.session_id })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to end session')

      if (packId) clearStoredSession(packId)
      setSummary(body as SessionEndResponse)
      setPhase('summary')
    } catch (err) {
      setErrorInfo({ kind: 'network', message: err instanceof Error ? err.message : undefined, onRetry: finishSession })
      setPhase('error')
    }
  }

  if (!packId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Unknown course.
      </div>
    )
  }

  if (phase === 'resume-prompt' && storedForPrompt) {
    return (
      <div className="mx-auto min-h-screen max-w-sm animate-[fadeIn_150ms_ease-in] space-y-4 bg-slate-50 px-4 py-10 text-center dark:bg-slate-950">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-50">Continue where you left off?</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You have a session in progress for {storedForPrompt.packName}.
        </p>
        <button
          type="button"
          onClick={() => resumeStoredSession(storedForPrompt)}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Resume session
        </button>
        <button
          type="button"
          onClick={() => {
            if (packId) clearStoredSession(packId)
            initSession()
          }}
          className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900 dark:border-slate-700 dark:text-slate-100"
        >
          Start fresh
        </button>
      </div>
    )
  }

  // session-orchestrator.js appends this exact note only on the 2nd
  // onboarding session (see the "Onboarding session N of 2" note) — used
  // to route to PostOnboardingTransition instead of straight back to
  // /home once the summary is dismissed.
  const isSecondOnboardingSession = plan?.mode === 'onboarding' && (plan?.notes.some((n) => n.includes('2 of 2')) ?? false)

  if (phase === 'post-onboarding') {
    return <PostOnboardingTransition onDone={() => navigate('/home', { replace: true })} />
  }

  if (phase === 'summary' && summary && plan) {
    return (
      <SessionSummary
        packId={packId}
        mode={plan.mode}
        durationSeconds={summary.duration_seconds}
        questionsAttempted={summary.questions_attempted}
        questionsCorrect={summary.questions_correct}
        currentStreak={summary.current_streak}
        topicsBefore={plan.topics}
        topicsAfter={summary.topics}
        answeredResults={answeredResults}
        onBackHome={() => (isSecondOnboardingSession ? setPhase('post-onboarding') : navigate('/home', { replace: true }))}
      />
    )
  }

  if (!plan) {
    if (phase === 'error' && errorInfo) {
      return (
        <div className="mx-auto max-w-sm px-4 py-10">
          <SessionError kind={errorInfo.kind} message={errorInfo.message} onRetry={errorInfo.onRetry} onBackHome={goHome} />
        </div>
      )
    }
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading your session...
      </div>
    )
  }

  // topic-selector.js pushes a "Quiz today!"/"Quiz prep: ..." line into
  // plan.notes for quiz-prep mode (see selectTopics) — surface it as a
  // banner rather than requiring the student to read the notes array.
  const quizPrepBanner = plan.mode === 'quiz-prep' ? (plan.notes.find((n) => n.startsWith('Quiz')) ?? null) : null

  const isCrunch = plan.mode === 'exam-crunch'
  const crunchNote = isCrunch ? plan.notes.find((n) => n.startsWith('EXAM CRUNCH:')) : undefined
  const crunchDaysMatch = crunchNote?.match(/(\d+) days/)
  const crunchBanner = isCrunch ? `🔴 Crunch mode — ${crunchDaysMatch ? crunchDaysMatch[1] : '?'} days to exam` : null

  const showCrunchEncouragement = isCrunch && phase === 'question' && elapsedSeconds >= CRUNCH_ENCOURAGEMENT_SECONDS

  return (
    <SessionShell
      packName={plan.pack_name}
      elapsedSeconds={elapsedSeconds}
      currentQuestionNumber={Math.min(questionIndex + 1, plan.target_question_count)}
      totalQuestions={plan.target_question_count}
      completedQuestions={answeredResults.length}
      topicName={currentTopic?.name ?? ''}
      onLeave={goHome}
      banner={isCrunch ? crunchBanner : quizPrepBanner}
      urgent={isCrunch}
    >
      {showCrunchEncouragement && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Good progress — keep going if you can 💪
        </div>
      )}

      {phase === 'loading' && (
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-24 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      )}

      {phase === 'question' && currentQuestion && (
        <QuestionCard key={currentQuestion.id} question={currentQuestion} onSubmit={submitAnswer} onGraded={handleGraded} />
      )}

      {phase === 'feedback' && currentQuestion && gradeResult && (
        <FeedbackCard
          question={currentQuestion}
          result={gradeResult}
          isLast={questionIndex + 1 >= plan.target_question_count}
          onNext={handleNext}
          crunchMode={isCrunch}
        />
      )}

      {phase === 'error' && errorInfo && (
        errorInfo.kind === 'bank-empty' && !errorInfo.exhausted ? (
          <BankLoadingNotice />
        ) : (
          <SessionError kind={errorInfo.kind} message={errorInfo.message} onRetry={errorInfo.onRetry} onSkip={errorInfo.onSkip} onBackHome={goHome} />
        )
      )}
    </SessionShell>
  )
}
