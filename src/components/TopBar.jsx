import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function TopBar({ title, rightSlot = null }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <Link
        to="/"
        className="flex min-h-[44px] items-center text-base font-semibold text-slate-900 dark:text-slate-50"
      >
        {title}
      </Link>
      <div className="flex items-center gap-3">
        {rightSlot}
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex min-h-[44px] items-center text-sm text-slate-500 underline dark:text-slate-400"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
