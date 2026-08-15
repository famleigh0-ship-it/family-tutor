import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllPacks } from '../../packs/loader'

type Screen = 'welcome' | 'how-it-works' | 'choose-course'

const PACK_EMOJI: Record<string, string> = {
  'ap-physics-1': '⚛️',
  'calc-ab-bc': '∫'
}

function examMonthYear(examDate: string) {
  return new Date(examDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Shown full-screen (not a modal) on a brand-new student's first login —
// Home.jsx renders this in place of the normal page when neither
// falp:hasStartedFirstSession nor falp:onboarding_complete is set in
// localStorage. Tapping a course on the last screen navigates straight
// into /session/:packId — session-mode.js's sessionCount < 2 check takes
// care of actually putting that session into onboarding mode server-side.
export default function WelcomeFlow() {
  const navigate = useNavigate()
  const [screen, setScreen] = useState<Screen>('welcome')
  const packs = getAllPacks()

  const shell = (content: React.ReactNode) => (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-sm animate-[fadeIn_150ms_ease-in] flex-col justify-center px-6 py-10">
        {content}
      </div>
    </div>
  )

  if (screen === 'welcome') {
    return shell(
      <div className="space-y-6 text-center">
        <p className="text-4xl">👋</p>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Welcome!</h1>
        <p className="text-base text-slate-600 dark:text-slate-300">This is your personal AP exam practice app.</p>
        <p className="text-base text-slate-600 dark:text-slate-300">
          15-30 minutes a day keeps the AP exam stress away.
        </p>
        <p className="text-base text-slate-600 dark:text-slate-300">
          Let's start with a quick intro session to see how it works.
        </p>
        <button
          type="button"
          onClick={() => setScreen('how-it-works')}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Let's go →
        </button>
      </div>
    )
  }

  if (screen === 'how-it-works') {
    return shell(
      <div className="space-y-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Here's how a session works:</h1>
        <div className="space-y-3 text-left">
          <p className="text-base text-slate-700 dark:text-slate-300">📝 You get a question</p>
          <p className="text-base text-slate-700 dark:text-slate-300">✍️ You answer it</p>
          <p className="text-base text-slate-700 dark:text-slate-300">💬 You get feedback</p>
          <p className="text-base text-slate-700 dark:text-slate-300">📈 Your mastery grows</p>
        </div>
        <p className="text-base text-slate-600 dark:text-slate-300">
          The app learns what you know and focuses practice where you need it most.
        </p>
        <button
          type="button"
          onClick={() => setScreen('choose-course')}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Start my first session →
        </button>
      </div>
    )
  }

  return shell(
    <div className="space-y-6">
      <h1 className="text-center text-xl font-semibold text-slate-900 dark:text-slate-50">
        Which course would you like to try first?
      </h1>
      <div className="space-y-3">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => navigate(`/session/${pack.id}`)}
            className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-4 text-left dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-base font-medium text-slate-900 dark:text-slate-50">
              {PACK_EMOJI[pack.id] ?? '📚'} {pack.name}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Exam: {examMonthYear(pack.exam_date)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
