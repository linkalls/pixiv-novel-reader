import type { PixivNovelItem } from '@book000/pixivts';

export type RecommendationSource = 'related' | 'discovery';

/** 現在作品との関係から、短く分かりやすいおすすめ理由を返す。 */
export function getRecommendationReason(
  current: PixivNovelItem | null,
  candidate: PixivNovelItem,
  source: RecommendationSource,
): string {
  if (current) {
    if (current.user.id === candidate.user.id) {
      return '同じ作者の作品';
    }

    const currentSeriesId = getSeriesId(current);
    const candidateSeriesId = getSeriesId(candidate);
    if (
      currentSeriesId !== null &&
      candidateSeriesId !== null &&
      currentSeriesId === candidateSeriesId
    ) {
      return '同じシリーズ';
    }

    const currentTags = new Set(
      current.tags.map((tag) => tag.name.trim()).filter(Boolean),
    );
    const sharedTag = candidate.tags.find((tag) =>
      currentTags.has(tag.name.trim()),
    );
    if (sharedTag) {
      return `#${sharedTag.name} が共通`;
    }
  }

  return source === 'related'
    ? 'この作品に近い小説'
    : 'Pixivのディスカバリー';
}

function getSeriesId(novel: PixivNovelItem): number | null {
  const series = novel.series;
  if (!series || typeof series !== 'object' || !('id' in series)) {
    return null;
  }

  return typeof series.id === 'number' ? series.id : null;
}
