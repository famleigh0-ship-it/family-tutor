import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { supabase } from '../lib/supabaseClient'

export default function ParentStudentDetail() {
  const { studentId } = useParams()
  const [name, setName] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('users')
      .select('name')
      .eq('id', studentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setName(data?.name ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="Parent Dashboard" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">{name || 'Student'}</h1>
        <p className="mt-2 text-slate-500">Detail view coming in Phase 12.</p>
      </main>
    </div>
  )
}
