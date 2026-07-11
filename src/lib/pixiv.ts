import {
  BookmarkRestrict,
  NovelRankingMode,
  parseNextUrl,
  PixivClient,
  SearchSort,
  SearchTarget,
  type PixivError,
  type PixivNovelItem,
} from '@book000/pixivts';

export type BookmarkVisibility = 'public' | 'private';
export type NovelRanking =
  | 'day'
  | 'week'
  | 'day_male'
  | 'day_female'
  | 'week_rookie'
  | 'day_r18'
  | 'week_r18'
  | 'day_r18_ai';
export type NovelSearchSort = 'date_desc' | 'date_asc' | 'popular_desc';
export type NovelSearchTarget =
  | 'keyword'
  | 'partial_match_for_tags'
  | 'exact_match_for_tags'
  | 'title_and_caption';

export interface PixivSession {
  userId: number;
  refreshToken: string;
}

export interface NovelPageResult {
  novels: PixivNovelItem[];
  nextUrl: string | null;
  refreshToken: string;
}

let currentClient: PixivClient | null = null;

/**
 * refresh tokenからPixivクライアントを初期化する。
 *
 * Pixiv側でrefresh tokenが更新される場合があるため、呼び出し元には
 * 常にクライアントが保持している最新tokenを返す。
 */
export async function connectPixiv(refreshToken: string): Promise<PixivSession> {
  const normalizedToken = refreshToken.trim();

  if (normalizedToken.length === 0) {
    throw new Error('refresh tokenが空だよ');
  }

  currentClient = await PixivClient.of(normalizedToken, {
    retry: {
      maxRetries: 2,
      waitMs: 1_500,
    },
  });

  return getSession(currentClient);
}

export function disconnectPixiv(): void {
  currentClient = null;
}

export async function fetchRecommendedNovels(
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const client = requireClient();
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const result = await client.novels.recommended({
    offset: cursor.offset,
    maxBookmarkIdForRecommend: cursor.maxBookmarkIdForRecommend,
  });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return {
    novels: result.value.novels,
    nextUrl: result.value.nextUrl,
    refreshToken: client.getRefreshToken(),
  };
}

export async function fetchBookmarkedNovels(
  visibility: BookmarkVisibility,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const client = requireClient();
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const result = await client.users.bookmarks.novels({
    userId: client.userId,
    restrict:
      visibility === 'private'
        ? BookmarkRestrict.PRIVATE
        : BookmarkRestrict.PUBLIC,
    maxBookmarkId: cursor.maxBookmarkId,
    offset: cursor.offset,
  });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return {
    novels: result.value.novels,
    nextUrl: result.value.nextUrl,
    refreshToken: client.getRefreshToken(),
  };
}

export async function fetchNovelRanking(
  mode: NovelRanking,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const client = requireClient();
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const result = await client.novels.ranking({
    mode: toRankingMode(mode),
    offset: cursor.offset,
  });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return {
    novels: result.value.novels,
    nextUrl: result.value.nextUrl,
    refreshToken: client.getRefreshToken(),
  };
}

export async function searchNovels(
  word: string,
  sort: NovelSearchSort,
  target: NovelSearchTarget,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const normalizedWord = word.trim();

  if (normalizedWord.length === 0) {
    throw new Error('検索語を入力してね');
  }

  const client = requireClient();
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const result = await client.novels.search({
    word: normalizedWord,
    searchTarget: toSearchTarget(target),
    sort: toSearchSort(sort),
    offset: cursor.offset,
  });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return {
    novels: result.value.novels,
    nextUrl: result.value.nextUrl,
    refreshToken: client.getRefreshToken(),
  };
}

export async function fetchNovelDetail(
  novelId: number,
): Promise<PixivNovelItem> {
  const client = requireClient();
  const result = await client.novels.detail({ novelId });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return result.value.novel;
}

export async function fetchNovelText(novelId: number): Promise<string> {
  const client = requireClient();
  const result = await client.novels.text({ novelId });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return result.value;
}

export async function setNovelBookmark(
  novelId: number,
  shouldBookmark: boolean,
): Promise<string> {
  const client = requireClient();
  const result = shouldBookmark
    ? await client.novels.bookmarkAdd({
        novelId,
        restrict: BookmarkRestrict.PUBLIC,
      })
    : await client.novels.bookmarkDelete({ novelId });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return client.getRefreshToken();
}

function requireClient(): PixivClient {
  if (!currentClient) {
    throw new Error('Pixivへログインし直してね');
  }

  return currentClient;
}

function getSession(client: PixivClient): PixivSession {
  return {
    userId: client.userId,
    refreshToken: client.getRefreshToken(),
  };
}

function toRankingMode(mode: NovelRanking) {
  switch (mode) {
    case 'day':
      return NovelRankingMode.DAY;
    case 'week':
      return NovelRankingMode.WEEK;
    case 'day_male':
      return NovelRankingMode.DAY_MALE;
    case 'day_female':
      return NovelRankingMode.DAY_FEMALE;
    case 'week_rookie':
      return NovelRankingMode.WEEK_ROOKIE;
    case 'day_r18':
      return NovelRankingMode.DAY_R18;
    case 'week_r18':
      return NovelRankingMode.WEEK_R18;
    case 'day_r18_ai':
      return NovelRankingMode.DAY_R18_AI;
  }
}

function toSearchTarget(target: NovelSearchTarget) {
  switch (target) {
    case 'keyword':
      return SearchTarget.KEYWORD;
    case 'partial_match_for_tags':
      return SearchTarget.PARTIAL_MATCH_FOR_TAGS;
    case 'exact_match_for_tags':
      return SearchTarget.EXACT_MATCH_FOR_TAGS;
    case 'title_and_caption':
      return SearchTarget.TITLE_AND_CAPTION;
  }
}

function toSearchSort(sort: NovelSearchSort) {
  switch (sort) {
    case 'date_desc':
      return SearchSort.DATE_DESC;
    case 'date_asc':
      return SearchSort.DATE_ASC;
    case 'popular_desc':
      return SearchSort.POPULAR_DESC;
  }
}

function formatPixivError(error: PixivError): string {
  switch (error.type) {
    case 'rate_limit':
      return `Pixiv APIのレート制限中。${Math.ceil(error.retryAfter / 1_000)}秒ほど待ってね`;
    case 'auth_failed':
      return `Pixiv認証の有効期限が切れてるよ（HTTP ${error.status}）`;
    case 'api_error':
      return `Pixiv APIがエラーを返したよ（HTTP ${error.status}）`;
    case 'network':
      return 'Pixivへの通信に失敗したよ。ネット接続を確認してね';
  }
}
