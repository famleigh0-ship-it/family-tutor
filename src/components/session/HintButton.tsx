import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

interface Props {
  questionId: string
  studentAnswerSoFar?: string
  disabled?: boolean
  // Hint text is rendered by the parent (above the answer input, per
  // spec), not here next to the button — this component only owns the
  // request + its own button state.
  onHint: (hintText: string) => void
}

export default function HintButton({ questionId, studentAnswerSoFar, disabled, onHint }: Props) {
  const [loading, setLoading] = useState(false)
  const [used, setUsed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/api/hints/get-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question_id: questionId, student_answer_so_far: studentAnswerSoFar })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not get a hint')

      setUsed(true)
      onHint(body.hint)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get a hint')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading || used}
        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
      >
        {used ? 'Hint used' : loading ? '...' : '💡 Hint'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
