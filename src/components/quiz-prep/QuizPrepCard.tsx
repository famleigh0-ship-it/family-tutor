import { Link } from 'react-router-dom'

interface Props {
  packId: string
  topicNames: string[]
  daysUntilQuiz: number
}

const URGENT_THRESHOLD_DAYS = 2
const TRUNCATE_AFTER = 2

function truncatedTopics(topicNames: string[]) {
  if (topicNames.length <= TRUNCATE_AFTER) return topicNames.join(', ')
  const shown = topicNames.slice(0, TRUNCATE_AFTER).join(', ')
  return `${shown} and ${topicNames.length - TRUNCATE_AFTER} more`
}

function quizTimingLabel(daysUntilQuiz: number) {
  if (daysUntilQuiz <= 0) return 'Quiz today!'
  if (daysUntilQuiz === 1) return 'Quiz tomorrow!'
  return `Quiz in ${daysUntilQuiz} days`
}

export default function QuizPrepCard({ packId, topicNames, daysUntilQuiz }: Props) {
  const urgent = daysUntilQuiz <= URGENT_THRESHOLD_DAYS

  return (
    <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm dark:bg-indigo-950/40">
      <p className="font-medium text-indigo-800 dark:text-indigo-300">🎯 Quiz prep active</p>
      <p className="mt-0.5 line-clamp-2 text-indigo-700 dark:text-indigo-400">{truncatedTopics(topicNames)}</p>
      <p className={`mt-1 font-medium ${urgent ? 'text-red-600 dark:text-red-400' : 'text-indigo-700 dark:text-indigo-400'}`}>
        📅 {quizTimingLabel(daysUntilQuiz)}
      </p>
      {/* Start Practice is the missing primary action here, found during
          Phase 11 launch testing — this card had no way back into a session
          at all, only the edit link. A plain /session/:packId request (no
          forced topics) is correct: startSession detects the active
          quiz_prep_event server-side and prioritizes its topics
          automatically, same as any other quiz-prep session. */}
      <Link
        to={`/session/${packId}`}
        className="mt-3 block min-h-[44px] w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-center text-base font-medium text-white dark:bg-indigo-600"
      >
        Start Practice
      </Link>
      <Link
        to={`/quiz-prep/${packId}`}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"
      >
        Edit quiz prep
      </Link>
    </div>
  )
}
