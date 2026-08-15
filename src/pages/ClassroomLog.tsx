import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import LogMethodSelector from '../components/LogMethodSelector.tsx'
import PhotoCapture, { PHOTO_CAPTURE_FLAG_KEY } from '../components/PhotoCapture.tsx'
import TextLogInput from '../components/TextLogInput.tsx'
import TopicChecklist from '../components/TopicChecklist.tsx'
import TopicConfirmation from '../components/TopicConfirmation.tsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { getPack } from '../packs/loader'

type Step = 'method' | 'photo' | 'text' | 'checklist' | 'confirm' | 'success'
type InputMethod = 'photo' | 'text' | 'checklist'
type Confidence = 'high' | 'medium' | 'low'

export default function ClassroomLog() {
  const { packId } = useParams<{ packId: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [step, setStep] = useState<Step>('method')
  const [inputMethod, setInputMethod] = useState<InputMethod | null>(null)
  const [rawInput, setRawInput] = useState<string | null>(null)
  const [extractedTopicIds, setExtractedTopicIds] = useState<string[]>([])
  const [confidence, setConfidence] = useState<Confidence>('high')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [reloadedDuringPhoto, setReloadedDuringPhoto] = useState(false)

  useEffect(() => {
    // If this flag is still set on a fresh mount, the page reloaded (and
    // lost all React state) while the native camera app had control —
    // rather than silently resetting to the method selector with no
    // explanation, tell the student what happened. See PhotoCapture.tsx.
    if (sessionStorage.getItem(PHOTO_CAPTURE_FLAG_KEY) === packId) {
      setReloadedDuringPhoto(true)
      sessionStorage.removeItem(PHOTO_CAPTURE_FLAG_KEY)
    }
  }, [packId])

  let pack = null
  try {
    pack = packId ? getPack(packId) : null
  } catch {
    pack = null
  }

  async function commitLog(
    topicsConfirmed: string[],
    method: InputMethod,
    raw: string | null,
    extracted: string[]
  ) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/classroom/confirm-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          pack_id: packId,
          input_method: method,
          raw_input: raw,
          topics_extracted: extracted,
          topics_confirmed: topicsConfirmed
        })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to save log')

      setSavedCount(topicsConfirmed.length)
      setStep('success')
      setTimeout(() => navigate('/home', { replace: true }), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving your log.')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setStep('method')
    setInputMethod(null)
    setRawInput(null)
    setExtractedTopicIds([])
    setError(null)
  }

  if (!pack || !packId) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <TopBar title="FALP" />
        <main className="mx-auto max-w-sm px-4 py-8">
          <p className="text-slate-500 dark:text-slate-400">Unknown course.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen animate-[fadeIn_150ms_ease-in] bg-slate-50 dark:bg-slate-950">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{pack.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">What did you cover in class today?</p>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {reloadedDuringPhoto && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Your browser reloaded while the camera was open — this can happen on some phones. Please try the photo again, or use "Describe what we covered" instead.
          </div>
        )}

        <div className="mt-6">
          {step === 'method' && (
            <LogMethodSelector
              onSelect={(method) => {
                setInputMethod(method)
                setStep(method)
                setReloadedDuringPhoto(false)
              }}
              onSkip={() => navigate('/home', { replace: true })}
            />
          )}

          {step === 'photo' && (
            <PhotoCapture
              packId={packId}
              onResult={(result, raw) => {
                setExtractedTopicIds(result.topicsFound)
                setConfidence(result.confidence)
                setRawInput(raw)
                setStep('confirm')
              }}
              onSwitchToChecklist={() => setStep('checklist')}
            />
          )}

          {step === 'text' && (
            <TextLogInput
              packId={packId}
              onResult={(result, raw) => {
                setExtractedTopicIds(result.topicsFound)
                setConfidence(result.confidence)
                setRawInput(raw)
                setStep('confirm')
              }}
            />
          )}

          {step === 'checklist' && session && (
            <TopicChecklist
              packId={packId}
              userId={session.user.id}
              onSave={(selectedIds) => commitLog(selectedIds, 'checklist', null, selectedIds)}
            />
          )}

          {step === 'confirm' && inputMethod && inputMethod !== 'checklist' && (
            <TopicConfirmation
              packId={packId}
              extractedTopicIds={extractedTopicIds}
              confidence={confidence}
              sourceLabel={
                inputMethod === 'photo'
                  ? "Here's what I found in your notes:"
                  : "Here's what I found in your description:"
              }
              saving={saving}
              onSave={(confirmedIds) => commitLog(confirmedIds, inputMethod, rawInput, extractedTopicIds)}
              onStartOver={reset}
            />
          )}

          {step === 'success' && (
            <div className="rounded-lg bg-emerald-50 p-4 text-center [animation:fadeIn_300ms_ease-in] dark:bg-emerald-950/40">
              <p className="text-base font-medium text-emerald-800 dark:text-emerald-200">
                Got it! {savedCount} topic{savedCount === 1 ? '' : 's'} added to your practice.
              </p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">These will show up prioritized in your next session.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
