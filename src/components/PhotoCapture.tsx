import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface ParseResult {
  topicsFound: string[]
  confidence: 'high' | 'medium' | 'low'
  notes: string
}

interface Props {
  packId: string
  onResult: (result: ParseResult, rawInput: null) => void
  onSwitchToChecklist: () => void
}

// Uses a plain file input with capture="environment" rather than
// getUserMedia — much more reliable across mobile browsers for a PWA, per
// spec.
export default function PhotoCapture({ packId, onResult, onSwitchToChecklist }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notReadable, setNotReadable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(reader.result as string)
    reader.readAsDataURL(file)
    setError(null)
    setNotReadable(false)
  }

  function handleRetake() {
    setImageDataUrl(null)
    setNotReadable(false)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleAnalyze() {
    if (!imageDataUrl) return
    setLoading(true)
    setError(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/api/classroom/parse-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_base64: imageDataUrl, pack_id: packId })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Request failed')

      if (body.readable === false) {
        setNotReadable(true)
        setLoading(false)
        return
      }

      onResult({ topicsFound: body.topics_found, confidence: body.confidence, notes: body.notes }, null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong analyzing your notes.')
      setLoading(false)
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {!imageDataUrl ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="block w-full rounded-lg border-2 border-dashed border-slate-300 px-4 py-10 text-center text-base font-medium text-slate-600"
        >
          📷 Tap to take a photo of your notes
        </button>
      ) : (
        <div className="space-y-3">
          <img src={imageDataUrl} alt="Your notes" className="w-full rounded-lg border border-slate-200" />

          {notReadable && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <p>I couldn't quite read that. Try better lighting, or:</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={handleRetake} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm">
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onSwitchToChecklist}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm"
                >
                  Switch to checklist
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!notReadable && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRetake}
                disabled={loading}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900 disabled:opacity-50"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50"
              >
                {loading ? 'Reading your notes...' : 'Analyze notes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
