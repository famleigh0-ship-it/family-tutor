import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import TopicSelector from '../components/quiz-prep/TopicSelector.tsx'
import DatePicker from '../components/quiz-prep/DatePicker.tsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { getPack } from '../packs/loader'

type Step = 'loading' | 'topics' | 'date' | 'replace-confirm' | 'saving' | 'confirm' | 'error'

interface ActiveEvent {
  id: string
  topic_ids: string[]
  topic_names: string[]
  quiz_date: string
}

const MS_PER_DAY = 86_400_000

function daysUntil(dateStr: string) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  const target = new Date(`${dateStr}T00:00:00.000Z`)
  return Math.ceil((target.getTime() - today.getTime()) / MS_PER_DAY)
}

export default function QuizPrep() {
  const { packId } = useParams<{ packId: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [step, setStep] = useState<Step>('loading')
  const [existingEvent, setExistingEvent] = useState<ActiveEvent | null>(null)
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [quizDate, setQuizDate] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  let pack = null
  try {
    pack = packId ? getPack(packId) : null
  } catch {
    pack = null
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!packId || !session) return
      try {
        const res = await fetch(`/api/quiz-prep?pack_id=${packId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        const body = await res.json()
        if (cancelled) return
        if (res.ok && body.active) {
          setExistingEvent(body.active)
          setSelectedTopicIds(body.active.topic_ids)
          setQuizDate(body.active.quiz_date)
        }
      } finally {
        if (!cancelled) setStep('topics')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [packId, session])

  // Accepts an explicit date rather than always reading the `quizDate`
  // state: handleDateNext below calls this in the same tick as
  // setQuizDate(date), and state updates aren't applied until the next
  // render, so reading `quizDate` there would send the stale (often
  // still-empty) value instead of what was just picked.
  async function save(quizDateOverride?: string) {
    setStep('saving')
    setError(null)
    try {
      const res = await fetch('/api/quiz-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ pack_id: packId, topic_ids: selectedTopicIds, quiz_date: quizDateOverride ?? quizDate })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to save quiz prep')
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setStep('error')
    }
  }

  function handleDateNext(date: string) {
    setQuizDate(date)
    setStep(existingEvent ? 'replace-confirm' : 'saving')
    if (!existingEvent) save(date)
  }

  if (!pack || !packId) {
    return (
      <div className="min-h-screen bg-slate-50">
        <TopBar title="FALP" />
        <main className="mx-auto max-w-sm px-4 py-8">
          <p className="text-slate-500">Unknown course.</p>
        </main>
      </div>
    )
  }

  const topicNameById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t.name])))
  const selectedTopicNames = selectedTopicIds.map((id) => topicNameById.get(id) ?? id)

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">{pack.name} — Quiz Prep</h1>

        <div className="mt-6">
          {step === 'loading' && <p className="text-slate-500">Loading...</p>}

          {step === 'topics' && session && (
            <TopicSelector
              packId={packId}
              userId={session.user.id}
              initialSelected={selectedTopicIds}
              onNext={(ids) => {
                setSelectedTopicIds(ids)
                setStep('date')
              }}
            />
          )}

          {step === 'date' && <DatePicker initialDate={quizDate} onNext={handleDateNext} />}

          {step === 'replace-confirm' && existingEvent && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                You already have quiz prep active for {existingEvent.topic_names.join(', ')}. Replace it with this
                new one?
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/home', { replace: true })}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => save()}
                  className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white"
                >
                  Replace
                </button>
              </div>
            </div>
          )}

          {step === 'saving' && <p className="text-slate-500">Saving...</p>}

          {step === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => setStep('date')}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white"
              >
                Try again
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4 text-center">
              <p className="text-lg font-medium text-slate-900">Quiz prep is set!</p>

              <div className="space-y-2 rounded-lg bg-slate-100 p-4 text-left text-sm text-slate-700">
                <p>📅 Quiz: {new Date(`${quizDate}T00:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}</p>
                <p className="flex flex-wrap gap-1.5">
                  📚 Topics:
                  {selectedTopicNames.map((name) => (
                    <span key={name} className="rounded-full bg-white px-2 py-0.5 text-xs">
                      {name}
                    </span>
                  ))}
                </p>
                <p>⏱ {daysUntil(quizDate)} days of focused practice</p>
              </div>

              <p className="text-sm text-slate-500">Your next session will focus on these topics.</p>

              <button
                type="button"
                onClick={() => navigate('/home', { replace: true })}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white"
              >
                Back to Home
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
