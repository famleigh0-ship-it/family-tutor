import TopBar from '../components/TopBar.jsx'

export default function Progress() {
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="Progress" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <p className="text-slate-500">
          Mastery breakdown by topic goes here, backed by mastery_records (Phase 2).
        </p>
      </main>
    </div>
  )
}
