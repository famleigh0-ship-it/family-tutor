import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Home() {
  const { session } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <p className="text-sm text-slate-500">Signed in as</p>
        <p className="mb-6 text-base font-medium text-slate-900">{session?.user?.email}</p>

        <div className="space-y-3">
          <Link
            to="/session"
            className="block w-full rounded-lg bg-slate-900 px-4 py-3 text-center text-base font-medium text-white"
          >
            Start a session
          </Link>
          <Link
            to="/progress"
            className="block w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-base font-medium text-slate-900"
          >
            View progress
          </Link>
          <Link
            to="/parent"
            className="block w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-base font-medium text-slate-900"
          >
            Parent dashboard
          </Link>
        </div>
      </main>
    </div>
  )
}
