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

// Uses a plain file input rather than getUserMedia — much more reliable
// across mobile browsers for a PWA, per spec. Deliberately does NOT set
// capture="environment": forcing straight-to-camera turned out to be
// unreliable on at least one real Android device (the file input's change
// event never fired at all after the camera closed — no photo, no error,
// no state change of any kind). Letting the OS show its normal
// Camera/Gallery/Files chooser is the more broadly-compatible behavior;
// the trade-off is one extra tap to pick "Camera" from that chooser.
// sessionStorage here lets ClassroomLog detect a mid-capture page reload
// (a separate, real risk on some devices when backgrounded for the camera)
// and tell the student what happened instead of silently resetting to the
// method selector with no explanation. See the matching check in
// ClassroomLog.tsx.
export const PHOTO_CAPTURE_FLAG_KEY = 'falp:photoCaptureInProgress'

// Vercel serverless functions reject request bodies over ~4.5MB, and a
// phone gallery photo (often several MB, then +33% from base64 encoding)
// blows past that easily. Downscale to a max dimension and re-encode as
// JPEG before it ever hits the network — plenty of resolution to read
// handwritten notes, comfortably under the limit.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load the selected image'))
    }
    img.src = objectUrl
  })
}

export default function PhotoCapture({ packId, onResult, onSwitchToChecklist }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notReadable, setNotReadable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    // The change event firing at all (even with no file attached) proves
    // the page survived the round trip to the camera app without
    // reloading — see the reload-detection effect in ClassroomLog.tsx.
    sessionStorage.removeItem(PHOTO_CAPTURE_FLAG_KEY)
    const file = e.target.files?.[0]
    if (!file) {
      // Camera closed without delivering a photo back (cancelled, or a
      // device-specific quirk in how it hands off the captured image).
      // Previously this silently did nothing, which looked identical to
      // the button being unresponsive — always give some feedback.
      setError('No photo was received — tap the button below to try again.')
      return
    }
    setError(null)
    setNotReadable(false)
    try {
      setImageDataUrl(await resizeImage(file))
    } catch {
      setError('Could not process that photo — please try again.')
    }
  }

  function handleOpenCamera() {
    sessionStorage.setItem(PHOTO_CAPTURE_FLAG_KEY, packId)
    fileInputRef.current?.click()
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
        onChange={handleFileChange}
        className="hidden"
      />

      {!imageDataUrl ? (
        <div className="space-y-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleOpenCamera}
            className="block w-full rounded-lg border-2 border-dashed border-slate-300 px-4 py-10 text-center text-base font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            📷 Tap to add a photo of your notes
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <img src={imageDataUrl} alt="Your notes" className="w-full rounded-lg border border-slate-200 dark:border-slate-800" />

          {notReadable && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p>I couldn't quite read that. Try better lighting, or:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="min-h-[44px] rounded-lg border border-amber-300 px-3 py-1.5 text-sm dark:border-amber-700"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onSwitchToChecklist}
                  className="min-h-[44px] rounded-lg border border-amber-300 px-3 py-1.5 text-sm dark:border-amber-700"
                >
                  Switch to checklist
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!notReadable && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRetake}
                disabled={loading}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
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
