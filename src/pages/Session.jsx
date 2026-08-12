import { useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { loadCoursePack } from '../packs/loader.js'

export default function Session() {
  const { packId } = useParams()

  let pack = null
  try {
    pack = loadCoursePack(packId)
  } catch {
    pack = null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">{pack ? pack.name : packId}</h1>
        <p className="mt-2 text-slate-500">Session coming in Phase 11.</p>
      </main>
    </div>
  )
}
