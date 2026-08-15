import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import SessionShell from '../components/session/SessionShell'
import QuestionCard from '../components/session/QuestionCard'
import FeedbackCard from '../components/session/FeedbackCard'
import SessionSummary from '../components/session/SessionSummary'
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

type Phase = 'loading' | 'resume-prompt' | 'question' | 'feedback' | 'summary' | 'error'

interface ErrorInfo {
  kind: SessionErrorKind
  message?: string
  onRetry?: () => void
  onSkip?: () => void
  exhausted?: boolean
}

const QUESTION_TYPE_CYCLE: QuestionType[] = ['mc', 'conceptual', 'frq']
const BANK_EMPTY_MAX_RETRIES = 3
const BANK_EMPTY_RETRY_DELAY_MS = 5000
const GRADING_TIMEOUT_MS = 15000
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

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
    const questionType = QUESTION_TYPE_CYCLE[index % QUESTION_TYPE_CYCLE.length]

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
        body: JSON.stringify({ pack_id: packId })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to start session')

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
      <div className="flex h-screen items-center justify-center text-slate-500 dark:text-slate-400">Unknown course.</div>
    )
  }

  if (phase === 'resume-prompt' && storedForPrompt) {
    return (
      <div className="mx-auto max-w-sm space-y-4 px-4 py-10 text-center">
        <p className="text-lg font-medium text-slate-900 dark:text-slate-50">Continue where you left off?</p>
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

  if (phase === 'summary' && summary && plan) {
    return (
      <SessionSummary
        packId={packId}
        durationSeconds={summary.duration_seconds}
        questionsAttempted={summary.questions_attempted}
        questionsCorrect={summary.questions_correct}
        currentStreak={summary.current_streak}
        topicsBefore={plan.topics}
        topicsAfter={summary.topics}
        answeredResults={answeredResults}
        onBackHome={() => navigate('/home', { replace: true })}
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
    return <div className="flex h-screen items-center justify-center text-slate-500 dark:text-slate-400">Loading your session...</div>
  }

  return (
    <SessionShell
      packName={plan.pack_name}
      elapsedSeconds={elapsedSeconds}
      currentQuestionNumber={Math.min(questionIndex + 1, plan.target_question_count)}
      totalQuestions={plan.target_question_count}
      completedQuestions={answeredResults.length}
      topicName={currentTopic?.name ?? ''}
      onLeave={goHome}
    >
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
