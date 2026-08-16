import { Component } from 'react'

// Top-level safety net (Phase 11) — without this, ANY uncaught error
// anywhere in the render tree unmounts the whole app to a blank white
// screen with no recovery path. Found live: opening the installed PWA
// fully offline sometimes produced exactly that (a "Loading..." screen
// that then went white, persisting across close/reopen, resolving only
// once back online) — the exact root cause on that specific device
// wasn't fully pinnable down without live debugging access, but this
// closes off the whole class of failure regardless of trigger, matching
// the "no blank screens at any point" requirement.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught an error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center dark:bg-slate-950">
          <p className="text-base font-medium text-slate-900 dark:text-slate-50">Something went wrong.</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Try reloading. Your progress is saved — an in-progress session persists on this device even if the app
            needs to restart.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
