import { describe, expect, test } from 'bun:test';
import type { PixivNovelItem } from '@book000/pixivts';

import { getRecommendationReason } from './recommendation-reason';

function novel(options: {
  id: number;
  authorId?: number;
  seriesId?: number;
  tags?: string[];
}): PixivNovelItem {
  return {
    id: options.id,
    series:
      options.seriesId === undefined
        ? {}
        : { id: options.seriesId, title: 'シリーズ' },
    tags: (options.tags ?? []).map((name) => ({ name })),
    user: { id: options.authorId ?? options.id },
  } as PixivNovelItem;
}

describe('getRecommendationReason', () => {
  test('同じ作者を最優先する', () => {
    expect(
      getRecommendationReason(
        novel({ id: 1, authorId: 9, tags: ['恋愛'] }),
        novel({ id: 2, authorId: 9, tags: ['恋愛'] }),
        'related',
      ),
    ).toBe('同じ作者の作品');
  });

  test('同じシリーズを表示する', () => {
    expect(
      getRecommendationReason(
        novel({ id: 1, seriesId: 5 }),
        novel({ id: 2, seriesId: 5 }),
        'related',
      ),
    ).toBe('同じシリーズ');
  });

  test('共通タグを表示する', () => {
    expect(
      getRecommendationReason(
        novel({ id: 1, tags: ['青春', '学校'] }),
        novel({ id: 2, tags: ['学校'] }),
        'discovery',
      ),
    ).toBe('#学校 が共通');
  });

  test('関係が不明なら取得元を理由にする', () => {
    expect(
      getRecommendationReason(
        novel({ id: 1 }),
        novel({ id: 2 }),
        'discovery',
      ),
    ).toBe('Pixivのディスカバリー');
  });
});
