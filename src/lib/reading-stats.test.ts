import { describe, expect, test } from 'bun:test';

import {
  createRecentDateKeys,
  estimateCharactersRead,
  fillReadingDayBuckets,
  formatReadingDuration,
} from './reading-stats';

describe('estimateCharactersRead', () => {
  test('進捗差から読了文字数を推定する', () => {
    expect(estimateCharactersRead(10_000, 0.25, 0.7)).toBe(4_500);
  });

  test('読み戻しは負数にしない', () => {
    expect(estimateCharactersRead(10_000, 0.8, 0.3)).toBe(0);
  });
});

describe('formatReadingDuration', () => {
  test('分と時間へ整形する', () => {
    expect(formatReadingDuration(0)).toBe('0分');
    expect(formatReadingDuration(30_000)).toBe('1分未満');
    expect(formatReadingDuration(45 * 60_000)).toBe('45分');
    expect(formatReadingDuration(90 * 60_000)).toBe('1時間30分');
  });
});

describe('daily buckets', () => {
  const now = new Date(2026, 6, 11, 12, 0, 0);

  test('指定日数を古い順に生成する', () => {
    expect(createRecentDateKeys(3, now)).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
    ]);
  });

  test('欠けた日を0で補完する', () => {
    expect(
      fillReadingDayBuckets(
        [
          {
            date: '2026-07-10',
            durationMs: 1_000,
            charactersRead: 20,
            sessions: 1,
          },
        ],
        3,
        now,
      ),
    ).toEqual([
      { date: '2026-07-09', durationMs: 0, charactersRead: 0, sessions: 0 },
      { date: '2026-07-10', durationMs: 1_000, charactersRead: 20, sessions: 1 },
      { date: '2026-07-11', durationMs: 0, charactersRead: 0, sessions: 0 },
    ]);
  });
});
