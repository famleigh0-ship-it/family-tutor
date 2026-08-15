// Gray placeholder blocks shaped like the content that will load, used by
// Progress.tsx and ParentDashboard/ParentStudentDetail while their
// api/progress requests are in flight — "feels faster than a spinner even
// if load time is the same" per the Phase 9 spec.

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <SkeletonBlock className="h-4 w-1/3" />
      <SkeletonBlock className="h-3 w-2/3" />
      <SkeletonBlock className="h-3 w-1/2" />
    </div>
  )
}

export function SkeletonHeatmap() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <SkeletonBlock className="h-4 w-1/3" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => (
              <SkeletonBlock key={j} className="h-14" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
