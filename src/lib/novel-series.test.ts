import { describe, expect, test } from 'bun:test';
import type { PixivNovelItem } from '@book000/pixivts';

import { getAdjacentSeriesNovels, getNovelSeries } from './novel-series';

function novel(id: number): PixivNovelItem {
  return { id, title: `第${id}話` } as PixivNovelItem;
}

describe('getNovelSeries', () => {
  test('空objectをシリーズなしとして扱う', () => {
    expect(getNovelSeries({ series: {} })).toBeNull();
  });

  test('有効なシリーズを返す', () => {
    expect(getNovelSeries({ series: { id: 7, title: '連載' } })).toEqual({
      id: 7,
      title: '連載',
    });
  });
});

describe('getAdjacentSeriesNovels', () => {
  test('前後作品と現在位置を返す', () => {
    const result = getAdjacentSeriesNovels([novel(1), novel(2), novel(3)], 2);
    expect(result.currentIndex).toBe(1);
    expect(result.previous?.id).toBe(1);
    expect(result.next?.id).toBe(3);
  });

  test('端では存在しない側をnullにする', () => {
    const result = getAdjacentSeriesNovels([novel(1), novel(2)], 1);
    expect(result.previous).toBeNull();
    expect(result.next?.id).toBe(2);
  });
});
