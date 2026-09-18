/**
 * Formats the summary text for chapter-wise breakdown items.
 *
 * Rules:
 * 1. Subjective-only (subjectiveCount > 0 && correct === 0 && wrong === 0):
 *    "X questions attempted · S subjective · K skipped"
 * 2. Mixed (subjectiveCount > 0 && (correct > 0 || wrong > 0)):
 *    "X questions attempted · C correct · W wrong · S subjective · K skipped"
 * 3. Objective-only (subjectiveCount === 0 or undefined):
 *    "X questions attempted · C correct · W wrong · K skipped"
 *
 * Note: Never displays "0 subjective".
 */
export function formatChapterBreakdownStats(chap: {
  questionsAttempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  subjectiveCount?: number;
}): string {
  const subjective = chap.subjectiveCount ?? 0;
  if (subjective > 0 && chap.correct === 0 && chap.wrong === 0) {
    return `${chap.questionsAttempted} questions attempted · ${subjective} subjective · ${chap.skipped} skipped`;
  }
  if (subjective > 0) {
    return `${chap.questionsAttempted} questions attempted · ${chap.correct} correct · ${chap.wrong} wrong · ${subjective} subjective · ${chap.skipped} skipped`;
  }
  return `${chap.questionsAttempted} questions attempted · ${chap.correct} correct · ${chap.wrong} wrong · ${chap.skipped} skipped`;
}
