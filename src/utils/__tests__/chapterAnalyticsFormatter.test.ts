import { describe, it, expect } from 'vitest';
import { formatChapterBreakdownStats } from '../chapterAnalyticsFormatter';

describe('formatChapterBreakdownStats', () => {
  it('formats objective-only chapters without showing subjective', () => {
    const result = formatChapterBreakdownStats({
      questionsAttempted: 5,
      correct: 3,
      wrong: 2,
      skipped: 0,
      subjectiveCount: 0,
    });
    expect(result).toBe('5 questions attempted · 3 correct · 2 wrong · 0 skipped');
  });

  it('formats subjective-only chapters (Laws of Motion case)', () => {
    const result = formatChapterBreakdownStats({
      questionsAttempted: 4,
      correct: 0,
      wrong: 0,
      skipped: 0,
      subjectiveCount: 4,
    });
    expect(result).toBe('4 questions attempted · 4 subjective · 0 skipped');
  });

  it('formats mixed objective and subjective chapters', () => {
    const result = formatChapterBreakdownStats({
      questionsAttempted: 7,
      correct: 3,
      wrong: 1,
      skipped: 0,
      subjectiveCount: 3,
    });
    expect(result).toBe('7 questions attempted · 3 correct · 1 wrong · 3 subjective · 0 skipped');
  });

  it('formats subjective-only with skipped questions', () => {
    const result = formatChapterBreakdownStats({
      questionsAttempted: 3,
      correct: 0,
      wrong: 0,
      skipped: 2,
      subjectiveCount: 3,
    });
    expect(result).toBe('3 questions attempted · 3 subjective · 2 skipped');
  });

  it('formats objective-only when subjectiveCount is undefined', () => {
    const result = formatChapterBreakdownStats({
      questionsAttempted: 10,
      correct: 8,
      wrong: 1,
      skipped: 1,
    });
    expect(result).toBe('10 questions attempted · 8 correct · 1 wrong · 1 skipped');
  });
});
