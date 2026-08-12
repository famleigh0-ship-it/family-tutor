import TopBar from '../components/TopBar.jsx'

export default function ParentDashboard() {
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="Parent Dashboard" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <p className="text-slate-500">
          Linked students, streaks, and pacing overview goes here (Phase 2).
        </p>
      </main>
    </div>
  )
}
