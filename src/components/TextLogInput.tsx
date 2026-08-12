import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const MAX_LENGTH = 500

interface ParseResult {
  topicsFound: string[]
  confidence: 'high' | 'medium' | 'low'
  notes: string
}

interface Props {
  packId: string
  onResult: (result: ParseResult, rawInput: string) => void
}

export default function TextLogInput({ packId, onResult }: Props) {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return

    setLoading(true)
    setError(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/api/classroom/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description, pack_id: packId })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Request failed')

      onResult({ topicsFound: body.topics_found, confidence: body.confidence, notes: body.notes }, description)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong mapping your description.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="classroom-description" className="block text-sm font-medium text-slate-700">
        What did you learn today?
      </label>
      <textarea
        id="classroom-description"
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, MAX_LENGTH))}
        maxLength={MAX_LENGTH}
        rows={5}
        placeholder="e.g. We learned about Newton's third law and started drawing free body diagrams"
        className="w-full rounded-lg border border-slate-300 p-3 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      <p className="text-right text-xs text-slate-400">
        {description.length}/{MAX_LENGTH}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !description.trim()}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Mapping to topics...' : 'Continue'}
      </button>
    </form>
  )
}
