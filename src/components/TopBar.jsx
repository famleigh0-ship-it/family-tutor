import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function TopBar({ title, rightSlot = null }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <Link to="/" className="text-base font-semibold text-slate-900">
        {title}
      </Link>
      <div className="flex items-center gap-3">
        {rightSlot}
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-slate-500 underline"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
