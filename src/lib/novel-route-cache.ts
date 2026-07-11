import type { PixivNovelItem } from '@book000/pixivts';

const novelRouteCache = new Map<number, PixivNovelItem>();

/**
 * 一覧から詳細Routeへ移る際、既に取得済みの作品情報を一時的に共有する。
 * URLには作品IDだけを載せ、長大な作品JSONをパラメータへ詰めないためのキャッシュ。
 */
export function cacheNovelForRoute(novel: PixivNovelItem): void {
  novelRouteCache.set(novel.id, novel);
}

export function getCachedNovelForRoute(
  novelId: number,
): PixivNovelItem | null {
  return novelRouteCache.get(novelId) ?? null;
}
