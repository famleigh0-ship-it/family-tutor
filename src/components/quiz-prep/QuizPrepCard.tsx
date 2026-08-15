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
      <Link
        to={`/quiz-prep/${packId}`}
        className="mt-2 flex min-h-[44px] w-fit items-center text-xs text-indigo-600 underline dark:text-indigo-400"
      >
        Edit quiz prep
      </Link>
    </div>
  )
}
