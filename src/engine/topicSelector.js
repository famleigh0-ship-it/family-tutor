/**
 * Course-agnostic topic selection. Given a set of unlocked topics and the
 * learner's mastery records for those topics, picks what to serve next.
 * Course packs supply the topic graph; this module has no subject knowledge.
 */

export function selectNextTopic({ unlockedTopicIds, masteryByTopicId }) {
  if (!unlockedTopicIds || unlockedTopicIds.length === 0) return null

  const scored = unlockedTopicIds.map((topicId) => ({
    topicId,
    masteryScore: masteryByTopicId[topicId]?.mastery_score ?? 0
  }))

  scored.sort((a, b) => a.masteryScore - b.masteryScore)

  return scored[0].topicId
}
