import { Link } from 'react-router-dom'

interface DomainSummary {
  unitName: string
  practiced: number
  total: number
}

interface Props {
  packId: string
  daysUntilExam: number
  domainSummary: DomainSummary[]
}

// Home.jsx renders this in place of the normal course card (and skips both
// the "Log today's class" prompt and the "Quiz coming up?" button — NMSQT
// has no classroom-log or quiz-prep concept at all, see
// session-orchestrator.js's startSession) for any pack with
// exam_type === 'nmsqt'. Domain counts come from the existing
// /api/progress?type=mastery-summary endpoint — "domain" here is this
// pack's term for a topic (Home.jsx groups by unit and counts
// attempts > 0), the same data MasteryHeatmap already renders per-topic
// for AP packs.
export default function NMSQTCard({ packId, daysUntilExam, domainSummary }: Props) {
  return (
    <div className="rounded-xl border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
      <p className="text-base font-semibold text-indigo-900 dark:text-indigo-200">PSAT/NMSQT Prep</p>

      <p className="mt-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">
        {daysUntilExam >= 0
          ? `${daysUntilExam} day${daysUntilExam === 1 ? '' : 's'} until the exam`
          : 'Exam date passed'}
      </p>

      {domainSummary.length > 0 && (
        <div className="mt-3 space-y-1">
          {domainSummary.map((d) => (
            <p key={d.unitName} className="text-sm text-indigo-700 dark:text-indigo-300">
              {d.unitName}: {d.practiced} of {d.total} domains practiced
            </p>
          ))}
        </div>
      )}

      <Link
        to={`/session/${packId}`}
        className="mt-3 block w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-center text-base font-medium text-white dark:bg-indigo-600"
      >
        Start Practice Session
      </Link>

      <Link
        to={`/progress/${packId}`}
        className="mt-2 flex min-h-[44px] items-center justify-center rounded-lg border border-indigo-200 bg-white px-3 text-sm font-medium text-indigo-700 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
      >
        My Progress →
      </Link>
    </div>
  )
}
