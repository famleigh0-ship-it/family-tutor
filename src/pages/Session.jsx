import TopBar from '../components/TopBar.jsx'

export default function Session() {
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="Session" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <p className="text-slate-500">
          Adaptive question session UI goes here. Depends on the engine and course pack
          loader (Phase 2).
        </p>
      </main>
    </div>
  )
}
