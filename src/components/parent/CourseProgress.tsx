import ExamCountdown from '../progress/ExamCountdown'
import MasteryHeatmap from '../progress/MasteryHeatmap'
import WeakSpotCard from '../progress/WeakSpotCard'
import LastLogStatus from './LastLogStatus'
import QuizPrepStatus from './QuizPrepStatus'
import type { ParentCourse } from './types'

interface Props {
  course: ParentCourse
}

export default function CourseProgress({ course }: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{course.pack_name}</h3>

      <ExamCountdown packName={course.pack_name} examDate={course.exam_date} schoolYearStart={course.school_year_start} />

      <LastLogStatus lastLogAt={course.last_log?.logged_at ?? null} method={course.last_log?.input_method ?? null} />

      <QuizPrepStatus active={course.active_quiz_prep} history={course.quiz_prep_history} />

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Mastery by Topic</p>
        <MasteryHeatmap packId={course.pack_id} units={course.units} readOnly />
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Focus Areas</p>
        <WeakSpotCard packId={course.pack_id} weakSpots={course.weak_spots} readOnly />
      </div>
    </div>
  )
}
