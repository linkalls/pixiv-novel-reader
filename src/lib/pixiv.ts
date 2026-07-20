import {
  BookmarkRestrict,
  FollowRestrict,
  NovelRankingMode,
  parseNextUrl,
  PixivClient,
  SearchDuration,
  SearchSort,
  SearchTarget,
  type NovelSeriesDetail,
  type PixivError,
  type PixivNovelItem,
  type PixivUserItem,
  type PixivUserProfile,
  type PixivUserProfilePublicity,
  type PixivUserProfileWorkspace,
  type Result,
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
export type NovelWorkLanguage = 'ja' | 'en' | 'ko' | 'zh-cn' | 'zh-tw' | 'other';

type PixivSearchDuration =
  (typeof SearchDuration)[keyof typeof SearchDuration];
type PixivSearchSort = (typeof SearchSort)[keyof typeof SearchSort];
type PixivSearchTarget = (typeof SearchTarget)[keyof typeof SearchTarget];

export interface NovelSearchCursor {
  duration?: PixivSearchDuration;
  endDate?: string;
  offset?: number;
  searchAiType?: 0 | 1;
  searchTarget?: PixivSearchTarget;
  sort?: PixivSearchSort;
  startDate?: string;
  word?: string;
}

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

export interface UserProfileResult {
  profile: PixivUserProfile;
  profilePublicity: PixivUserProfilePublicity;
  refreshToken: string;
  user: PixivUserItem;
  workspace: PixivUserProfileWorkspace;
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
let recoveryPromise: Promise<PixivClient> | null = null;
let lastNotifiedRefreshToken: string | null = null;
const refreshTokenListeners = new Set<
  (refreshToken: string) => void | Promise<void>
>();

/**
 * Pixiv側でrefresh tokenがローテーションされたときに通知する。
 * ルートレイアウト側でSecureStoreへ保存し、画面遷移中も最新tokenを失わない。
 */
export function subscribePixivRefreshToken(
  listener: (refreshToken: string) => void | Promise<void>,
): () => void {
  refreshTokenListeners.add(listener);

  if (currentClient) {
    void Promise.resolve(listener(currentClient.getRefreshToken())).catch(() => {});
  }

  return () => {
    refreshTokenListeners.delete(listener);
  };
}

/**
 * refresh tokenからPixivクライアントを初期化する。
 *
 * Pixiv側でrefresh tokenが更新される場合があるため、呼び出し元には
 * 常にクライアントが保持している最新tokenを返す。
 */
export async function connectPixiv(refreshToken: string): Promise<PixivSession> {
  const normalizedToken = refreshToken.trim();

  if (normalizedToken.length === 0) {
    throw new Error('refresh tokenが空です');
  }

  currentClient = await createPixivClient(normalizedToken);
  notifyRefreshToken(currentClient);

  return getSession(currentClient);
}

export function disconnectPixiv(): void {
  currentClient = null;
  recoveryPromise = null;
  lastNotifiedRefreshToken = null;
}

export async function fetchRecommendedNovels(
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.novels.recommended({
      offset: cursor.offset,
      maxBookmarkIdForRecommend: cursor.maxBookmarkIdForRecommend,
    }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

export async function fetchFollowedNovels(
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.users.following({
      userId: client.userId,
      restrict: FollowRestrict.PUBLIC,
      offset: cursor.offset,
    }),
  );

  const seenIds = new Set<number>();
  const novels = page.userPreviews
    .flatMap((preview) => preview.novels)
    .filter((novel) => {
      if (seenIds.has(novel.id)) {
        return false;
      }
      seenIds.add(novel.id);
      return true;
    })
    .sort(
      (left, right) =>
        new Date(right.createDate).getTime() -
        new Date(left.createDate).getTime(),
    );

  return {
    novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

export async function setUserFollow(
  userId: number,
  shouldFollow: boolean,
): Promise<string> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('ユーザーIDが不正です');
  }

  await performPixivRequest((client) =>
    shouldFollow
      ? client.users.followAdd({
          userId,
          restrict: FollowRestrict.PUBLIC,
        })
      : client.users.followDelete({ userId }),
  );

  return requireClient().getRefreshToken();
}

export async function fetchBookmarkedNovels(
  visibility: BookmarkVisibility,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.users.bookmarks.novels({
      userId: client.userId,
      restrict:
        visibility === 'private'
          ? BookmarkRestrict.PRIVATE
          : BookmarkRestrict.PUBLIC,
      maxBookmarkId: cursor.maxBookmarkId,
      offset: cursor.offset,
    }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

export async function fetchNovelRanking(
  mode: NovelRanking,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.novels.ranking({
      mode: toRankingMode(mode),
      offset: cursor.offset,
    }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

export async function searchNovels(
  word: string,
  sort: NovelSearchSort,
  target: NovelSearchTarget,
  nextUrl?: string | null,
  workLanguage?: NovelWorkLanguage | null,
): Promise<NovelPageResult> {
  const normalizedWord = word.trim();

  if (normalizedWord.length === 0) {
    throw new Error('検索語を入力してください');
  }

  if (workLanguage) {
    return searchOfficialWebNovels(normalizedWord, sort, target, workLanguage, nextUrl);
  }

  // next_urlにはoffsetだけでなく、検索語・検索対象・期間・日付範囲などが
  // 含まれることがある。offsetだけ抜き出して再構築すると、2ページ目以降で
  // 条件が欠落して結果が途中で途切れるため、返されたカーソルを優先する。
  const cursor = nextUrl ? parseNovelSearchNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.novels.search({
      word: cursor.word ?? normalizedWord,
      searchTarget: cursor.searchTarget ?? toSearchTarget(target),
      sort: cursor.sort ?? toSearchSort(sort),
      duration: cursor.duration,
      startDate: cursor.startDate,
      endDate: cursor.endDate,
      searchAiType: cursor.searchAiType,
      offset: cursor.offset,
    }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}


interface OfficialNovelSearchItem {
  aiType?: unknown;
  bookmarkCount?: unknown;
  bookmarkData?: unknown;
  createDate?: unknown;
  description?: unknown;
  id?: unknown;
  isOriginal?: unknown;
  language?: unknown;
  profileImageUrl?: unknown;
  restrict?: unknown;
  seriesId?: unknown;
  seriesTitle?: unknown;
  tags?: unknown;
  textCount?: unknown;
  title?: unknown;
  url?: unknown;
  userId?: unknown;
  userName?: unknown;
  xRestrict?: unknown;
}

async function searchOfficialWebNovels(
  word: string,
  sort: NovelSearchSort,
  target: NovelSearchTarget,
  workLanguage: NovelWorkLanguage,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  const page = nextUrl ? Number(new URL(nextUrl).searchParams.get('p') ?? '1') : 1;
  const params = new URLSearchParams({
    word,
    order: toOfficialSearchOrder(sort),
    mode: 'all',
    p: String(Number.isInteger(page) && page > 0 ? page : 1),
    s_mode: toOfficialSearchTarget(target),
    work_lang: workLanguage,
  });
  const url = `https://www.pixiv.net/ajax/search/novels/${encodeURIComponent(word)}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'pixiv-novel-reader' },
  });
  if (!response.ok) {
    throw new Error(`Pixiv公式検索を取得できませんでした (${response.status})`);
  }
  const payload = await response.json() as {
    error?: unknown;
    message?: unknown;
    body?: { novel?: { data?: unknown; lastPage?: unknown } };
  };
  if (payload.error === true) {
    throw new Error(typeof payload.message === 'string' ? payload.message : 'Pixiv公式検索でエラーが発生しました');
  }
  const rawItems = payload.body?.novel?.data;
  const novels = Array.isArray(rawItems)
    ? rawItems.map(mapOfficialNovelSearchItem).filter((item): item is PixivNovelItem => item !== null)
    : [];
  const lastPage = Number(payload.body?.novel?.lastPage ?? page);
  const nextPage = page < lastPage ? page + 1 : null;
  const nextPageUrl = nextPage
    ? `https://www.pixiv.net/ajax/search/novels/${encodeURIComponent(word)}?${new URLSearchParams({
        word,
        order: toOfficialSearchOrder(sort),
        mode: 'all',
        p: String(nextPage),
        s_mode: toOfficialSearchTarget(target),
        work_lang: workLanguage,
      }).toString()}`
    : null;
  return {
    novels,
    nextUrl: nextPageUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

function mapOfficialNovelSearchItem(value: unknown): PixivNovelItem | null {
  if (!isRecord(value)) return null;
  const item = value as OfficialNovelSearchItem;
  const id = Number(item.id);
  const userId = Number(item.userId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(userId) || userId <= 0) return null;
  const cover = typeof item.url === 'string' ? item.url : '';
  const profile = typeof item.profileImageUrl === 'string' ? item.profileImageUrl : '';
  const seriesId = Number(item.seriesId);
  return {
    id,
    title: typeof item.title === 'string' ? item.title : String(id),
    caption: typeof item.description === 'string' ? item.description : '',
    restrict: Number(item.restrict) || 0,
    xRestrict: Number(item.xRestrict) || 0,
    isOriginal: item.isOriginal === true,
    imageUrls: { squareMedium: cover, medium: cover, large: cover },
    createDate: typeof item.createDate === 'string' ? item.createDate : new Date(0).toISOString(),
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((name) => ({ name, translatedName: null }))
      : [],
    pageCount: 1,
    textLength: Number(item.textCount) || 0,
    user: {
      id: userId,
      name: typeof item.userName === 'string' ? item.userName : String(userId),
      account: '',
      profileImageUrls: { medium: profile },
      isFollowed: false,
    },
    series: Number.isInteger(seriesId) && seriesId > 0
      ? { id: seriesId, title: typeof item.seriesTitle === 'string' ? item.seriesTitle : String(seriesId) }
      : {},
    isBookmarked: isRecord(item.bookmarkData),
    totalBookmarks: Number(item.bookmarkCount) || 0,
    totalView: 0,
    visible: true,
    totalComments: 0,
    isMuted: false,
    isMypixivOnly: false,
    isXRestricted: Number(item.xRestrict) > 0,
    novelAiType: Number(item.aiType) || 0,
  };
}

function toOfficialSearchOrder(sort: NovelSearchSort): string {
  if (sort === 'date_asc') return 'date';
  if (sort === 'popular_desc') return 'popular_d';
  return 'date_d';
}

function toOfficialSearchTarget(target: NovelSearchTarget): string {
  if (target === 'exact_match_for_tags') return 's_tag_full';
  if (target === 'title_and_caption') return 'tc';
  if (target === 'keyword') return 'tag_tc';
  return 's_tag';
}

export async function fetchNovelDetail(
  novelId: number,
): Promise<PixivNovelItem> {
  const detail = await performPixivRequest((client) =>
    client.novels.detail({ novelId }),
  );
  return detail.novel;
}

export async function fetchUserProfile(
  userId: number,
): Promise<UserProfileResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('ユーザーIDが不正です');
  }

  const detail = await performPixivRequest((client) =>
    client.users.detail({ userId }),
  );

  return {
    profile: detail.profile,
    profilePublicity: detail.profilePublicity,
    refreshToken: requireClient().getRefreshToken(),
    user: detail.user,
    workspace: detail.workspace,
  };
}

export async function fetchUserNovels(
  userId: number,
  nextUrl?: string | null,
): Promise<NovelPageResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('ユーザーIDが不正です');
  }

  const cursor = nextUrl ? parseNextUrl(nextUrl) : {};
  const page = await performPixivRequest((client) =>
    client.users.novels({
      userId,
      offset: cursor.offset,
    }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

export async function fetchAllUserNovels(
  userId: number,
): Promise<PixivNovelItem[]> {
  const novels: PixivNovelItem[] = [];
  const seenIds = new Set<number>();
  let nextUrl: string | null = null;

  for (let pageNumber = 0; pageNumber < 200; pageNumber += 1) {
    const page = await fetchUserNovels(userId, nextUrl);
    for (const novel of page.novels) {
      if (!seenIds.has(novel.id)) {
        seenIds.add(novel.id);
        novels.push(novel);
      }
    }
    if (!page.nextUrl || page.nextUrl === nextUrl) break;
    nextUrl = page.nextUrl;
  }

  return novels;
}

/** 現在の作品に近い小説をApp APIから取得する。 */
export async function fetchRelatedNovels(
  novelId: number,
): Promise<NovelPageResult> {
  const page = await performPixivRequest((client) =>
    client.novels.related({ novelId }),
  );

  return {
    novels: page.novels,
    nextUrl: page.nextUrl,
    refreshToken: requireClient().getRefreshToken(),
  };
}

/** シリーズ作品を全ページ取得し、前後移動と一覧表示に使う。 */
export async function fetchNovelSeries(
  seriesId: number,
): Promise<NovelSeriesResult> {
  const novels: PixivNovelItem[] = [];
  const seenIds = new Set<number>();
  let lastOrder: number | undefined;
  let detail: NovelSeriesDetail | null = null;

  for (let pageNumber = 0; pageNumber < 200; pageNumber += 1) {
    const page = await performPixivRequest((client) =>
      client.novels.series({ seriesId, lastOrder }),
    );

    detail ??= page.novelSeriesDetail;

    for (const novel of page.novels) {
      if (!seenIds.has(novel.id)) {
        seenIds.add(novel.id);
        novels.push(novel);
      }
    }

    if (!page.nextUrl) {
      break;
    }

    const cursor = parseNextUrl(page.nextUrl);

    if (cursor.lastOrder === undefined || cursor.lastOrder === lastOrder) {
      break;
    }

    lastOrder = cursor.lastOrder;
  }

  if (!detail) {
    throw new Error('シリーズ情報を取得できませんでした');
  }

  return {
    detail,
    novels,
    refreshToken: requireClient().getRefreshToken(),
  };
}

/**
 * App APIのWebView HTMLから本文を取得するフォールバック。
 * 通常はWebView cookieを利用した `/ajax/novel/{id}` を先に試す。
 */
export async function fetchNovelText(
  novelId: number,
): Promise<NovelReaderContent> {
  const html = await performPixivRequest((client) =>
    client.novels.text({ novelId }),
  );
  return parseNovelWebviewHtml(html, novelId);
}

export async function setNovelBookmark(
  novelId: number,
  shouldBookmark: boolean,
): Promise<string> {
  await performPixivRequest((client) =>
    shouldBookmark
      ? client.novels.bookmarkAdd({
          novelId,
          restrict: BookmarkRestrict.PUBLIC,
        })
      : client.novels.bookmarkDelete({ novelId }),
  );

  return requireClient().getRefreshToken();
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
      `PixivのAjax JSONを解析できませんでした: ${toUnknownError(error)}`,
    );
  }

  if (envelope.error !== false) {
    const message =
      typeof envelope.message === 'string' && envelope.message.trim().length > 0
        ? envelope.message
        : 'PixivのWebログインcookieを利用できませんでした';
    throw new Error(message);
  }

  if (!isRecord(envelope.body)) {
    throw new Error('PixivのAjaxレスポンスに本文データがありません');
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
    throw new Error('Pixivの本文データが見つかりません');
  }

  const objectStart = html.indexOf('{', markerIndex);

  if (objectStart < 0) {
    throw new Error('Pixivの本文JSONを読み取れませんでした');
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
    throw new Error('Pixivの本文JSONが途中で切れています');
  }

  let payload: EmbeddedNovelPayload;

  try {
    payload = JSON.parse(
      html.slice(objectStart, objectEnd),
    ) as EmbeddedNovelPayload;
  } catch (error) {
    throw new Error(
      `Pixivの本文JSONを解析できませんでした: ${toUnknownError(error)}`,
    );
  }

  if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
    throw new Error('この作品の本文が空です');
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
    throw new Error('PixivのAjaxレスポンス本文が空です');
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

type PixivOperation<T> = (
  client: PixivClient,
) => PromiseLike<Result<T, PixivError>>;

async function createPixivClient(refreshToken: string): Promise<PixivClient> {
  return PixivClient.of(refreshToken, {
    retry: {
      maxRetries: 2,
      waitMs: 1_500,
    },
  });
}

/**
 * 期限切れaccess tokenをPixiv側が401ではなく400/403で返す場合もある。
 * 認証由来と判定できる失敗だけクライアントを作り直し、同じ要求を一度だけ再実行する。
 */
async function performPixivRequest<T>(
  operation: PixivOperation<T>,
): Promise<T> {
  let client = requireClient();
  let result = await operation(client);

  if (result.isErr && shouldRecoverSession(result.error)) {
    try {
      client = await recoverPixivClient(client);
      result = await operation(client);
    } catch {
      throw new Error(
        'Pixiv認証を更新できませんでした。設定から再ログインしてください',
      );
    }
  }

  if (result.isErr) {
    if (shouldRecoverSession(result.error)) {
      throw new Error(
        'Pixiv認証を更新できませんでした。設定から再ログインしてください',
      );
    }
    throw new Error(formatPixivError(result.error));
  }

  notifyRefreshToken(client);
  return result.value;
}

async function recoverPixivClient(failedClient: PixivClient): Promise<PixivClient> {
  if (currentClient && currentClient !== failedClient) {
    return currentClient;
  }

  if (!recoveryPromise) {
    const refreshToken = failedClient.getRefreshToken();
    recoveryPromise = createPixivClient(refreshToken)
      .then((client) => {
        currentClient = client;
        notifyRefreshToken(client);
        return client;
      })
      .finally(() => {
        recoveryPromise = null;
      });
  }

  return recoveryPromise;
}

function shouldRecoverSession(error: PixivError): boolean {
  if (error.type === 'auth_failed') {
    return true;
  }

  if (
    error.type !== 'api_error' ||
    ![400, 401, 403].includes(error.status)
  ) {
    return false;
  }

  const bodyText = stringifyErrorBody(error.body).toLocaleLowerCase('en-US');
  return /oauth|access[ _-]?token|invalid[ _-]?token|authentication|authenticate|invalid_grant/.test(
    bodyText,
  );
}

function stringifyErrorBody(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function notifyRefreshToken(client: PixivClient): void {
  const refreshToken = client.getRefreshToken();

  if (
    refreshToken.length === 0 ||
    refreshToken === lastNotifiedRefreshToken
  ) {
    return;
  }

  lastNotifiedRefreshToken = refreshToken;

  for (const listener of refreshTokenListeners) {
    void Promise.resolve(listener(refreshToken)).catch(() => {});
  }
}

export function parseNovelSearchNextUrl(nextUrl: string): NovelSearchCursor {
  const url = new URL(nextUrl, 'https://app-api.pixiv.net');
  const parameters = url.searchParams;
  const cursor: NovelSearchCursor = {};
  const word = parameters.get('word')?.trim();
  const searchTarget = parameters.get('search_target');
  const sort = parameters.get('sort');
  const duration = parameters.get('duration');
  const startDate = parameters.get('start_date')?.trim();
  const endDate = parameters.get('end_date')?.trim();
  const offset = parseOptionalNumber(parameters.get('offset'));
  const searchAiType = parseOptionalNumber(parameters.get('search_ai_type'));

  if (word) {
    cursor.word = word;
  }
  if (isPixivSearchTarget(searchTarget)) {
    cursor.searchTarget = searchTarget;
  }
  if (isPixivSearchSort(sort)) {
    cursor.sort = sort;
  }
  if (isPixivSearchDuration(duration)) {
    cursor.duration = duration;
  }
  if (startDate) {
    cursor.startDate = startDate;
  }
  if (endDate) {
    cursor.endDate = endDate;
  }
  if (offset !== undefined) {
    cursor.offset = offset;
  }
  if (searchAiType === 0 || searchAiType === 1) {
    cursor.searchAiType = searchAiType;
  }

  return cursor;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPixivSearchTarget(value: string | null): value is PixivSearchTarget {
  return Object.values(SearchTarget).some((candidate) => candidate === value);
}

function isPixivSearchSort(value: string | null): value is PixivSearchSort {
  return Object.values(SearchSort).some((candidate) => candidate === value);
}

function isPixivSearchDuration(
  value: string | null,
): value is PixivSearchDuration {
  return Object.values(SearchDuration).some((candidate) => candidate === value);
}

function requireClient(): PixivClient {
  if (!currentClient) {
    throw new Error('Pixivへ再ログインしてください');
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
      return `Pixiv認証の有効期限が切れています（HTTP ${error.status}）`;
    case 'api_error':
      return `Pixiv APIがエラーを返しました（HTTP ${error.status}）`;
    case 'network':
      return 'Pixivへの通信に失敗しました。ネットワーク接続を確認してください';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
