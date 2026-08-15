interface Props {
  onDone: () => void
}

// Shown once, right after the 2nd onboarding session finishes (Session.tsx
// routes here instead of straight back to /home when plan.notes includes
// "2 of 2" — see session-orchestrator.js's onboarding note). "Go to home
// screen" sets the falp:onboarding_complete flag Home.jsx checks before
// ever showing WelcomeFlow again.
export default function PostOnboardingTransition({ onDone }: Props) {
  function handleDone() {
    localStorage.setItem('falp:onboarding_complete', 'true')
    onDone()
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center space-y-6 px-4 py-10 text-center">
      <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50">You're all set! 🎉</p>
      <p className="text-base text-slate-600 dark:text-slate-300">
        You've completed your intro sessions. Here's what happens next:
      </p>

      <div className="space-y-4 rounded-xl border border-slate-200 p-5 text-left dark:border-slate-800">
        <div>
          <p className="text-base font-medium text-slate-900 dark:text-slate-50">📅 When school starts</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Log what you cover in class after each session.</p>
        </div>
        <div>
          <p className="text-base font-medium text-slate-900 dark:text-slate-50">🎯 Before quizzes</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Set quiz prep mode to focus your practice.</p>
        </div>
        <div>
          <p className="text-base font-medium text-slate-900 dark:text-slate-50">📊 Check your progress</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Anytime, from the home screen.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleDone}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Go to home screen
      </button>
    </div>
  )
}
