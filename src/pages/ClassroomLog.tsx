import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import LogMethodSelector from '../components/LogMethodSelector.tsx'
import PhotoCapture from '../components/PhotoCapture.tsx'
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
      <div className="min-h-screen bg-slate-50">
        <TopBar title="FALP" />
        <main className="mx-auto max-w-sm px-4 py-8">
          <p className="text-slate-500">Unknown course.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">{pack.name}</h1>
        <p className="mt-1 text-sm text-slate-500">What did you cover in class today?</p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6">
          {step === 'method' && (
            <LogMethodSelector
              onSelect={(method) => {
                setInputMethod(method)
                setStep(method)
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
            <div className="rounded-lg bg-emerald-50 p-4 text-center">
              <p className="text-base font-medium text-emerald-800">
                Got it! {savedCount} topic{savedCount === 1 ? '' : 's'} added to your practice.
              </p>
              <p className="mt-1 text-sm text-emerald-700">These will show up prioritized in your next session.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
