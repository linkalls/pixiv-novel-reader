import {
  BookmarkRestrict,
  NovelRankingMode,
  parseNextUrl,
  PixivClient,
  SearchSort,
  SearchTarget,
  type NovelSeriesDetail,
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

export interface NovelSeriesResult {
  detail: NovelSeriesDetail;
  novels: PixivNovelItem[];
  refreshToken: string;
}

export interface NovelReaderContent {
  id: string;
  title: string | null;
  seriesTitle: string | null;
  text: string;
  embeddedImages: Record<string, string>;
}

interface PixivAjaxNovelImage {
  urls?: unknown;
}

interface PixivAjaxNovelBody {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  seriesTitle?: unknown;
  seriesNavData?: unknown;
  textEmbeddedImages?: unknown;
}

interface PixivAjaxNovelEnvelope {
  error?: unknown;
  message?: unknown;
  body?: unknown;
}

interface EmbeddedNovelPayload {
  id?: unknown;
  title?: unknown;
  seriesTitle?: unknown;
  text?: unknown;
  images?: unknown;
  illusts?: unknown;
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

/** 現在の作品に近い小説をApp APIから取得する。 */
export async function fetchRelatedNovels(
  novelId: number,
): Promise<NovelPageResult> {
  const client = requireClient();
  const result = await client.novels.related({ novelId });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return {
    novels: result.value.novels,
    nextUrl: result.value.nextUrl,
    refreshToken: client.getRefreshToken(),
  };
}

/** シリーズ作品を全ページ取得し、前後移動と一覧表示に使う。 */
export async function fetchNovelSeries(
  seriesId: number,
): Promise<NovelSeriesResult> {
  const client = requireClient();
  const novels: PixivNovelItem[] = [];
  const seenIds = new Set<number>();
  let lastOrder: number | undefined;
  let detail: NovelSeriesDetail | null = null;

  for (let pageNumber = 0; pageNumber < 200; pageNumber += 1) {
    const result = await client.novels.series({ seriesId, lastOrder });

    if (result.isErr) {
      throw new Error(formatPixivError(result.error));
    }

    detail ??= result.value.novelSeriesDetail;

    for (const novel of result.value.novels) {
      if (!seenIds.has(novel.id)) {
        seenIds.add(novel.id);
        novels.push(novel);
      }
    }

    if (!result.value.nextUrl) {
      break;
    }

    const cursor = parseNextUrl(result.value.nextUrl);

    if (cursor.lastOrder === undefined || cursor.lastOrder === lastOrder) {
      break;
    }

    lastOrder = cursor.lastOrder;
  }

  if (!detail) {
    throw new Error('シリーズ情報を取得できなかったよ');
  }

  return {
    detail,
    novels,
    refreshToken: client.getRefreshToken(),
  };
}

/**
 * App APIのWebView HTMLから本文を取得するフォールバック。
 * 通常はWebView cookieを利用した `/ajax/novel/{id}` を先に試す。
 */
export async function fetchNovelText(
  novelId: number,
): Promise<NovelReaderContent> {
  const client = requireClient();
  const result = await client.novels.text({ novelId });

  if (result.isErr) {
    throw new Error(formatPixivError(result.error));
  }

  return parseNovelWebviewHtml(result.value, novelId);
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

/** `www.pixiv.net/ajax/novel/{id}` のJSONをリーダー用データへ変換する。 */
export function parseNovelAjaxResponse(
  rawResponse: string,
  fallbackNovelId = 0,
): NovelReaderContent {
  let envelope: PixivAjaxNovelEnvelope;

  try {
    envelope = JSON.parse(rawResponse.trim()) as PixivAjaxNovelEnvelope;
  } catch (error) {
    throw new Error(
      `PixivのAjax JSONを解析できなかったよ: ${toUnknownError(error)}`,
    );
  }

  if (envelope.error !== false) {
    const message =
      typeof envelope.message === 'string' && envelope.message.trim().length > 0
        ? envelope.message
        : 'PixivのWebログインcookieを使えなかったよ';
    throw new Error(message);
  }

  if (!isRecord(envelope.body)) {
    throw new Error('PixivのAjaxレスポンスに本文データがなかったよ');
  }

  return parseAjaxNovelBody(envelope.body, fallbackNovelId);
}

/**
 * App APIのWebViewレスポンスに埋め込まれた `novel: {...}` を取り出す。
 * 単純な正規表現では本文中の波括弧や引用符で壊れるため、文字列を
 * 認識しながら対応する閉じ括弧まで走査する。
 */
export function parseNovelWebviewHtml(
  html: string,
  fallbackNovelId = 0,
): NovelReaderContent {
  const markerIndex = html.search(/\bnovel\s*:/);

  if (markerIndex < 0) {
    throw new Error('Pixivの本文データが見つからなかったよ');
  }

  const objectStart = html.indexOf('{', markerIndex);

  if (objectStart < 0) {
    throw new Error('Pixivの本文JSONを読み取れなかったよ');
  }

  let depth = 0;
  let isInsideString = false;
  let isEscaped = false;
  let objectEnd = -1;

  for (let index = objectStart; index < html.length; index += 1) {
    const character = html[index];

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        isInsideString = false;
      }

      continue;
    }

    if (character === '"') {
      isInsideString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        objectEnd = index + 1;
        break;
      }
    }
  }

  if (objectEnd < 0) {
    throw new Error('Pixivの本文JSONが途中で切れてるよ');
  }

  let payload: EmbeddedNovelPayload;

  try {
    payload = JSON.parse(
      html.slice(objectStart, objectEnd),
    ) as EmbeddedNovelPayload;
  } catch (error) {
    throw new Error(
      `Pixivの本文JSONを解析できなかったよ: ${toUnknownError(error)}`,
    );
  }

  if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
    throw new Error('この作品の本文が空だったよ');
  }

  return {
    id:
      typeof payload.id === 'string' || typeof payload.id === 'number'
        ? String(payload.id)
        : String(fallbackNovelId),
    title: typeof payload.title === 'string' ? payload.title : null,
    seriesTitle:
      typeof payload.seriesTitle === 'string' ? payload.seriesTitle : null,
    text: payload.text,
    embeddedImages: collectLegacyEmbeddedImages(
      payload.images,
      payload.illusts,
    ),
  };
}

function parseAjaxNovelBody(
  body: Record<string, unknown>,
  fallbackNovelId: number,
): NovelReaderContent {
  const typedBody = body as PixivAjaxNovelBody;

  if (
    typeof typedBody.content !== 'string' ||
    typedBody.content.trim().length === 0
  ) {
    throw new Error('PixivのAjaxレスポンス本文が空だったよ');
  }

  return {
    id:
      typeof typedBody.id === 'string' || typeof typedBody.id === 'number'
        ? String(typedBody.id)
        : String(fallbackNovelId),
    title: typeof typedBody.title === 'string' ? typedBody.title : null,
    seriesTitle: readAjaxSeriesTitle(typedBody),
    text: typedBody.content,
    embeddedImages: collectAjaxEmbeddedImages(typedBody.textEmbeddedImages),
  };
}

function readAjaxSeriesTitle(body: PixivAjaxNovelBody): string | null {
  if (typeof body.seriesTitle === 'string') {
    return body.seriesTitle;
  }

  if (isRecord(body.seriesNavData)) {
    const title = body.seriesNavData.title;
    return typeof title === 'string' ? title : null;
  }

  return null;
}

function collectAjaxEmbeddedImages(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [id, rawImage] of Object.entries(value)) {
    if (!isRecord(rawImage)) {
      continue;
    }

    const image = rawImage as PixivAjaxNovelImage;

    if (!isRecord(image.urls)) {
      continue;
    }

    for (const key of ['original', '1200x1200', '480mw', '128x128']) {
      const candidate = image.urls[key];

      if (typeof candidate === 'string' && candidate.length > 0) {
        result[id] = candidate;
        break;
      }
    }
  }

  return result;
}

function collectLegacyEmbeddedImages(
  images: unknown,
  illusts: unknown,
): Record<string, string> {
  const result: Record<string, string> = {};
  let index = 0;

  for (const value of [images, illusts]) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const candidate of value) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        result[String(index)] = candidate;
        index += 1;
      }
    }
  }

  return result;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
