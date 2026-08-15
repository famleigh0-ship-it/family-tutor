import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'

// Stub for now, per spec — a real settings page isn't in scope for Phase 10.
export default function Settings() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm space-y-4 px-4 py-8">
        <Link to="/home" className="text-sm text-slate-500 underline dark:text-slate-400">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400">Settings coming soon. Contact your admin to update your account.</p>
      </main>
    </div>
  )
}
