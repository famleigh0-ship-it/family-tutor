import MCQuestion from './MCQuestion'
import TypedQuestion from './TypedQuestion'
import PhotoQuestion from './PhotoQuestion'
import type { GradeResult, MCGradeResult, ServedQuestion, TypedGradeResult } from './types'

interface Props {
  question: ServedQuestion
  onSubmit: (payload: Record<string, unknown>) => Promise<GradeResult>
  onGraded: (result: GradeResult) => void
}

// Dispatches on the served question's own shape — question_type plus
// input_mode (an FRQ's input_mode is baked into the question row at
// generation time, see src/lib/bankFill.js, so there's nothing else to
// infer here). Callers should key this by question.id so each question
// gets fresh local state (selection, hint, textarea, photo) for free via
// remount rather than needing manual resets.
export default function QuestionCard({ question, onSubmit, onGraded }: Props) {
  if (question.question_type === 'mc') {
    return <MCQuestion question={question} onSubmit={(p) => onSubmit(p) as Promise<MCGradeResult>} onGraded={onGraded} />
  }

  if (question.question_type === 'frq' && question.input_mode === 'photo') {
    return <PhotoQuestion question={question} onSubmit={onSubmit} onGraded={onGraded} />
  }

  return <TypedQuestion question={question} onSubmit={(p) => onSubmit(p) as Promise<TypedGradeResult>} onGraded={onGraded} />
}
