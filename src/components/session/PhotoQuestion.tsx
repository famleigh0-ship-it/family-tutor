import { useRef, useState } from 'react'
import HintButton from './HintButton'
import TypedQuestion, { ThinkingDots } from './TypedQuestion'
import type { GradeResult, PhotoGradeResult, ServedQuestion, TypedGradeResult } from './types'

interface Props {
  question: ServedQuestion
  onSubmit: (payload: { image_base64: string } | { student_answer: string }) => Promise<GradeResult>
  onGraded: (result: GradeResult) => void
}

// Same downscale approach as PhotoCapture.tsx (Phase 5) — Vercel functions
// reject bodies over ~4.5MB and a raw phone photo blows past that once
// base64-encoded.
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

export default function PhotoQuestion({ question, onSubmit, onGraded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notReadable, setNotReadable] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFullQuestion, setShowFullQuestion] = useState(false)
  const [typedFallback, setTypedFallback] = useState(false)
  const [hintText, setHintText] = useState<string | null>(null)

  if (typedFallback) {
    return (
      <TypedQuestion
        question={question}
        onSubmit={async (payload) => (await onSubmit(payload)) as TypedGradeResult}
        onGraded={onGraded}
      />
    )
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setError('No photo was received — tap the button below to try again.')
      return
    }
    setError(null)
    setNotReadable(null)
    try {
      setImageDataUrl(await resizeImage(file))
    } catch {
      setError('Could not process that photo — please try again.')
    }
  }

  function handleRetake() {
    setImageDataUrl(null)
    setNotReadable(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmitPhoto() {
    if (!imageDataUrl) return
    setLoading(true)
    setError(null)
    setNotReadable(null)
    try {
      const result = (await onSubmit({ image_base64: imageDataUrl })) as PhotoGradeResult | { readable: false; feedback: string }
      if (result.readable === false) {
        setNotReadable(result.feedback)
        setLoading(false)
        return
      }
      onGraded(result)
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {hintText && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">💡 Hint</p>
          <p className="mt-1">{hintText}</p>
        </div>
      )}

      {!imageDataUrl ? (
        <>
          <p className="text-base leading-relaxed text-slate-900 dark:text-slate-50">{question.question_text}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">Work this out on paper, then take a photo of your work.</p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="block w-full rounded-lg border-2 border-dashed border-slate-300 px-4 py-10 text-center text-base font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            📷 Take Photo
          </button>

          <p className="text-xs text-slate-400 dark:text-slate-500">Tips: Write large and dark. Good lighting helps.</p>

          <HintButton questionId={question.id} disabled={loading} onHint={setHintText} />
        </>
      ) : (
        <>
          <div>
            <p className={`text-base leading-relaxed text-slate-900 dark:text-slate-50 ${showFullQuestion ? '' : 'line-clamp-2'}`}>
              {question.question_text}
            </p>
            {!showFullQuestion && (
              <button type="button" onClick={() => setShowFullQuestion(true)} className="mt-0.5 text-sm text-slate-500 underline dark:text-slate-400">
                Show more
              </button>
            )}
          </div>

          <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <img src={imageDataUrl} alt="Your work" className="h-full w-full object-cover" />
          </div>

          {notReadable && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p>Couldn't read your handwriting clearly. Try better lighting or write larger.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={handleRetake} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm dark:border-amber-700">
                  Retake Photo
                </button>
                <button
                  type="button"
                  onClick={() => setTypedFallback(true)}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm dark:border-amber-700"
                >
                  Type your answer instead
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {loading && (
            <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              Reading your work... <ThinkingDots />
            </p>
          )}

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
                onClick={handleSubmitPhoto}
                disabled={loading}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {loading ? 'Reading...' : 'Submit Work'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
