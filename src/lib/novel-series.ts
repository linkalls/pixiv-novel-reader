import type { PixivNovelItem, Series } from '@book000/pixivts';

export interface AdjacentSeriesNovels {
  currentIndex: number;
  next: PixivNovelItem | null;
  previous: PixivNovelItem | null;
}

/** PixivNovelItem.series は空objectの場合があるため、安全にSeriesへ絞る。 */
export function getNovelSeries(
  novel: Pick<PixivNovelItem, 'series'> | null | undefined,
): Series | null {
  if (!novel || !isRecord(novel.series)) {
    return null;
  }

  const { id, title } = novel.series;
  return typeof id === 'number' && typeof title === 'string'
    ? { id, title }
    : null;
}

export function getAdjacentSeriesNovels(
  novels: PixivNovelItem[],
  currentNovelId: number,
): AdjacentSeriesNovels {
  const currentIndex = novels.findIndex((novel) => novel.id === currentNovelId);

  if (currentIndex < 0) {
    return { currentIndex: -1, next: null, previous: null };
  }

  return {
    currentIndex,
    previous: currentIndex > 0 ? novels[currentIndex - 1] ?? null : null,
    next:
      currentIndex < novels.length - 1
        ? novels[currentIndex + 1] ?? null
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
