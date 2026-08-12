/**
 * Course-agnostic mastery scoring. Operates purely on mastery_records-shaped
 * data — no knowledge of any specific course pack's content.
 */

export function computeMasteryScore({ attempts, correct, frqAttempts, frqScoreTotal }) {
  if (attempts === 0 && frqAttempts === 0) return 0

  const mcAccuracy = attempts > 0 ? correct / attempts : null
  const frqAccuracy = frqAttempts > 0 ? frqScoreTotal / frqAttempts : null

  const parts = [mcAccuracy, frqAccuracy].filter((v) => v !== null)
  const score = parts.reduce((sum, v) => sum + v, 0) / parts.length

  return Math.max(0, Math.min(1, score))
}
