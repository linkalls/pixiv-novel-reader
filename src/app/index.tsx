import type { PixivNovelItem } from '@book000/pixivts';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdvancedSearchModal } from '@/components/advanced-search-modal';
import { LibraryView } from '@/components/library-view';
import { NovelCard } from '@/components/novel-card';
import { PixivLoginModal } from '@/components/pixiv-login-modal';
import {
  getNovelReadingStatuses,
  listReadingHistory,
  type LibraryNovel,
  type NovelReadingStatus,
} from '@/lib/library-db';
import {
  applyAdvancedSearchFilters,
  filterMutedNovels,
  getAdvancedSearchFilters,
  muteAuthor,
  muteTag,
  saveAdvancedSearchFilters,
  type AdvancedSearchFilters,
} from '@/lib/content-preferences-db';
import {
  checkForAppUpdate,
  CURRENT_RELEASE_HIGHLIGHTS,
  getCurrentAppVersion,
  getReleasesUrl,
  markUpdateNotified,
  type AppUpdateInfo,
} from '@/lib/app-update';
import {
  cleanupInstalledUpdateApk,
  downloadUpdateApk,
  launchUpdateInstaller,
  openUnknownAppInstallSettings,
  type DownloadedUpdateApk,
} from '@/lib/app-installer';
import {
  isNewContentNotificationEnabled,
  notifyNewContent,
  setNewContentNotificationEnabled,
} from '@/lib/app-notifications';
import { processOfflineDownloadQueue } from '@/lib/offline-download-queue';
import { syncOfflineSeriesSubscriptions } from '@/lib/offline-series-subscriptions';
import { subscribeNovelChanged } from '@/lib/novel-events';
import { cacheNovelForRoute } from '@/lib/novel-route-cache';
import {
  connectPixiv,
  disconnectPixiv,
  fetchBookmarkedNovels,
  fetchFollowedNovels,
  fetchNovelDetail,
  fetchNovelRanking,
  fetchRecommendedNovels,
  searchNovels,
  type BookmarkVisibility,
  type NovelPageResult,
  type NovelRanking,
  type NovelSearchSort,
  type NovelSearchTarget,
} from '@/lib/pixiv';
import {
  clearRecentSearchHistory,
  deleteSearchHistoryItem,
  listSearchHistory,
  recordSearchHistory,
  setSearchHistoryPinned,
  type SearchHistoryItem,
} from '@/lib/search-history-db';
import { type AppColors, type ThemeMode, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';
const FOLLOWING_NEWEST_AT_KEY = 'following-feed-newest-at';

type AppTab =
  | 'recommended'
  | 'following'
  | 'bookmarks'
  | 'ranking'
  | 'search'
  | 'library';

interface SubmittedSearch {
  sort: NovelSearchSort;
  target: NovelSearchTarget;
  word: string;
}

interface FeedState {
  novels: PixivNovelItem[];
  nextUrl: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
}

const EMPTY_FEED: FeedState = {
  novels: [],
  nextUrl: null,
  hasLoaded: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  loadMoreError: null,
};

const TAB_ITEMS: { key: AppTab; label: string; icon: string }[] = [
  { key: 'recommended', label: 'おすすめ', icon: '✦' },
  { key: 'following', label: '新着', icon: '◉' },
  { key: 'bookmarks', label: 'ブックマーク', icon: '🔖' },
  { key: 'ranking', label: 'ランキング', icon: '🏆' },
  { key: 'search', label: '検索', icon: '🔎' },
  { key: 'library', label: 'ライブラリ', icon: '▤' },
];

const RANKING_OPTIONS: { value: NovelRanking; label: string }[] = [
  { value: 'day', label: 'デイリー' },
  { value: 'week', label: '週間' },
  { value: 'day_male', label: '男性向け' },
  { value: 'day_female', label: '女性向け' },
  { value: 'week_rookie', label: 'ルーキー' },
  { value: 'day_r18', label: 'R-18デイリー' },
  { value: 'week_r18', label: 'R-18週間' },
  { value: 'day_r18_ai', label: 'R-18 AI' },
];

const SEARCH_SORT_OPTIONS: { value: NovelSearchSort; label: string }[] = [
  { value: 'date_desc', label: '新しい順' },
  { value: 'date_asc', label: '古い順' },
  { value: 'popular_desc', label: '人気順' },
];

const SEARCH_TARGET_OPTIONS: { value: NovelSearchTarget; label: string }[] = [
  { value: 'keyword', label: 'キーワード' },
  { value: 'partial_match_for_tags', label: 'タグを含む' },
  { value: 'exact_match_for_tags', label: 'タグ完全一致' },
  { value: 'title_and_caption', label: 'タイトル・説明' },
];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '端末設定' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const requestedTag = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const handledTagRef = useRef<string | null>(null);
  const { colors, isDark, mode: themeMode, setMode: setThemeMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [activeTab, setActiveTab] = useState<AppTab>('recommended');
  const [feeds, setFeeds] = useState<Record<AppTab, FeedState>>({
    recommended: { ...EMPTY_FEED },
    following: { ...EMPTY_FEED },
    bookmarks: { ...EMPTY_FEED },
    ranking: { ...EMPTY_FEED },
    search: { ...EMPTY_FEED },
    library: { ...EMPTY_FEED, hasLoaded: true },
  });
  const feedsRef = useRef(feeds);
  const submittedSearchRef = useRef<SubmittedSearch | null>(null);
  const inFlightPagesRef = useRef(new Set<string>());
  const feedRequestVersionRef = useRef<Record<AppTab, number>>({
    recommended: 0,
    following: 0,
    bookmarks: 0,
    ranking: 0,
    search: 0,
    library: 0,
  });

  const connectingRef = useRef(false);
  const [isBooting, setIsBooting] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginVisible, setIsLoginVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);
  const [downloadedUpdateApk, setDownloadedUpdateApk] =
    useState<DownloadedUpdateApk | null>(null);
  const [isNewContentNotificationOn, setIsNewContentNotificationOn] = useState(false);
  const [isNotificationSaving, setIsNotificationSaving] = useState(false);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  const [bookmarkVisibility, setBookmarkVisibility] =
    useState<BookmarkVisibility>('public');
  const [rankingMode, setRankingMode] = useState<NovelRanking>('day');
  const [searchWord, setSearchWord] = useState('');
  const [submittedSearchWord, setSubmittedSearchWord] = useState('');
  const [searchSort, setSearchSort] =
    useState<NovelSearchSort>('date_desc');
  const [searchTarget, setSearchTarget] =
    useState<NovelSearchTarget>('keyword');
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [searchFilters, setSearchFilters] = useState<AdvancedSearchFilters>({
    minCharacters: null,
    maxCharacters: null,
    minBookmarks: null,
    includeR18: true,
    includeAi: true,
    dateRange: 'all',
    seriesMode: 'all',
    hideFinished: false,
  });
  const [isAdvancedSearchVisible, setIsAdvancedSearchVisible] = useState(false);
  const searchFiltersRef = useRef(searchFilters);
  const [readingStatuses, setReadingStatuses] = useState<
    Record<number, NovelReadingStatus>
  >({});
  const [continueReading, setContinueReading] = useState<LibraryNovel | null>(null);
  const [followingNewIds, setFollowingNewIds] = useState<Set<number>>(
    () => new Set(),
  );
  const persistRefreshToken = useCallback(async (refreshToken: string) => {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  }, []);

  const reloadSearchHistory = useCallback(async () => {
    setSearchHistory(await listSearchHistory());
  }, []);

  const reloadReadingStatuses = useCallback(async (novels: PixivNovelItem[]) => {
    const statusMap = await getNovelReadingStatuses(
      novels.map((novel) => novel.id),
    );
    setReadingStatuses(Object.fromEntries(statusMap));
  }, []);

  const updateFeed = useCallback(
    (tab: AppTab, updater: (current: FeedState) => FeedState) => {
      setFeeds((current) => {
        const nextFeeds = {
          ...current,
          [tab]: updater(current[tab]),
        };
        feedsRef.current = nextFeeds;
        return nextFeeds;
      });
    },
    [],
  );

  const requestFeed = useCallback(
    async (
      tab: AppTab,
      options?: {
        append?: boolean;
        bookmarkVisibility?: BookmarkVisibility;
        rankingMode?: NovelRanking;
        searchWord?: string;
        searchSort?: NovelSearchSort;
        searchTarget?: NovelSearchTarget;
      },
    ) => {
      if (tab === 'library') {
        return;
      }

      const append = options?.append ?? false;
      const currentFeed = feedsRef.current[tab];
      const nextUrl = append ? currentFeed.nextUrl : null;
      const searchRequest: SubmittedSearch | null =
        tab === 'search'
          ? {
              word:
                options?.searchWord ??
                submittedSearchRef.current?.word ??
                submittedSearchWord,
              sort:
                options?.searchSort ??
                submittedSearchRef.current?.sort ??
                searchSort,
              target:
                options?.searchTarget ??
                submittedSearchRef.current?.target ??
                searchTarget,
            }
          : null;

      if (append && (!nextUrl || currentFeed.isLoadingMore)) {
        return;
      }

      const requestKey = append
        ? `${tab}:page:${nextUrl}`
        : tab === 'search' && searchRequest
          ? `${tab}:first:${searchRequest.word}:${searchRequest.sort}:${searchRequest.target}`
          : `${tab}:first`;

      if (inFlightPagesRef.current.has(requestKey)) {
        return;
      }

      inFlightPagesRef.current.add(requestKey);
      const requestVersion = append
        ? feedRequestVersionRef.current[tab]
        : feedRequestVersionRef.current[tab] + 1;

      if (!append) {
        feedRequestVersionRef.current[tab] = requestVersion;
        if (searchRequest) {
          submittedSearchRef.current = searchRequest;
        }
      }

      updateFeed(tab, (current) => ({
        ...current,
        isLoading: !append,
        isLoadingMore: append,
        error: append ? current.error : null,
        loadMoreError: null,
        ...(append ? {} : { novels: [], nextUrl: null }),
      }));

      try {
        let result: NovelPageResult;

        switch (tab) {
          case 'recommended':
            result = await fetchRecommendedNovels(nextUrl);
            break;
          case 'following':
            result = await fetchFollowedNovels(nextUrl);
            break;
          case 'bookmarks':
            result = await fetchBookmarkedNovels(
              options?.bookmarkVisibility ?? bookmarkVisibility,
              nextUrl,
            );
            break;
          case 'ranking':
            result = await fetchNovelRanking(
              options?.rankingMode ?? rankingMode,
              nextUrl,
            );
            break;
          case 'search': {
            if (!searchRequest) {
              throw new Error('検索条件を読み取れませんでした');
            }
            result = await searchNovels(
              searchRequest.word,
              searchRequest.sort,
              searchRequest.target,
              nextUrl,
            );
            break;
          }
        }

        if (feedRequestVersionRef.current[tab] !== requestVersion) {
          return;
        }

        await persistRefreshToken(result.refreshToken);

        if (tab === 'search' && !append && searchRequest) {
          await recordSearchHistory(
            searchRequest.word,
            searchRequest.sort,
            searchRequest.target,
          );
          await reloadSearchHistory();
        }

        if (tab === 'following' && !append) {
          const rawPreviousNewestAt = await SecureStore.getItemAsync(
            FOLLOWING_NEWEST_AT_KEY,
          ).catch(() => null);
          const previousNewestAt = rawPreviousNewestAt
            ? Number(rawPreviousNewestAt)
            : 0;
          const newestAt = Math.max(
            0,
            ...result.novels.map((novel) =>
              new Date(novel.createDate).getTime(),
            ),
          );
          const nextNewIds =
            previousNewestAt > 0
              ? new Set(
                  result.novels
                    .filter(
                      (novel) =>
                        new Date(novel.createDate).getTime() > previousNewestAt,
                    )
                    .map((novel) => novel.id),
                )
              : new Set<number>();
          setFollowingNewIds(nextNewIds);
          if (nextNewIds.size > 0) {
            await notifyNewContent({
              title: 'フォロー中の作者に新着があります',
              body: `${nextNewIds.size}作品の新着小説を見つけました。`,
              data: { type: 'following-update' },
            });
          }
          if (newestAt > 0) {
            await SecureStore.setItemAsync(
              FOLLOWING_NEWEST_AT_KEY,
              String(newestAt),
            );
          }
        }

        let filteredPageNovels = await filterMutedNovels(result.novels);

        if (tab === 'search') {
          const pageStatuses = await getNovelReadingStatuses(
            filteredPageNovels.map((novel) => novel.id),
          );
          const finishedNovelIds = new Set(
            [...pageStatuses.entries()]
              .filter(([, status]) => status.isFinished)
              .map(([novelId]) => novelId),
          );
          filteredPageNovels = applyAdvancedSearchFilters(
            filteredPageNovels,
            searchFiltersRef.current,
            finishedNovelIds,
          );
        }

        const nextNovels = append
          ? mergeNovels(feedsRef.current[tab].novels, filteredPageNovels)
          : filteredPageNovels;

        updateFeed(tab, () => ({
          novels: nextNovels,
          nextUrl:
            append && result.nextUrl === nextUrl ? null : result.nextUrl,
          hasLoaded: true,
          isLoading: false,
          isLoadingMore: false,
          error: null,
          loadMoreError: null,
        }));
        void reloadReadingStatuses(nextNovels);
      } catch (error) {
        if (feedRequestVersionRef.current[tab] !== requestVersion) {
          return;
        }

        const message = toErrorMessage(error);
        updateFeed(tab, (current) => ({
          ...current,
          hasLoaded: true,
          isLoading: false,
          isLoadingMore: false,
          error: append ? current.error : message,
          loadMoreError: append ? message : null,
        }));
      } finally {
        inFlightPagesRef.current.delete(requestKey);
      }
    },
    [
      bookmarkVisibility,
      persistRefreshToken,
      reloadReadingStatuses,
      reloadSearchHistory,
      rankingMode,
      searchSort,
      searchTarget,
      submittedSearchWord,
      updateFeed,
    ],
  );

  const openTagSearch = useCallback(
    (rawTagName: string) => {
      const tagName = rawTagName.trim().replace(/^#+/, '');
      if (tagName.length === 0) {
        return;
      }

      setActiveTab('search');
      setSearchWord(tagName);
      setSubmittedSearchWord(tagName);
      setSearchTarget('exact_match_for_tags');
      void requestFeed('search', {
        searchWord: tagName,
        searchSort,
        searchTarget: 'exact_match_for_tags',
      });
    },
    [requestFeed, searchSort],
  );

  const openAuthorFromNovel = useCallback(
    async (novelId: number) => {
      try {
        const novel = await fetchNovelDetail(novelId);
        router.push({
          pathname: '/user/[id]',
          params: { id: String(novel.user.id) },
        });
      } catch (error) {
        Alert.alert(
          'プロフィールを開けませんでした',
          toErrorMessage(error),
        );
      }
    },
    [router],
  );

  useEffect(() => {
    if (
      isBooting ||
      !isAuthenticated ||
      !requestedTag ||
      handledTagRef.current === requestedTag
    ) {
      return;
    }

    handledTagRef.current = requestedTag;
    openTagSearch(requestedTag);
  }, [isAuthenticated, isBooting, openTagSearch, requestedTag]);

  const connectWithToken = useCallback(
    async (
      token: string,
      options?: {
        allowOffline?: boolean;
      },
    ) => {
      if (connectingRef.current) {
        return;
      }

      connectingRef.current = true;
      setIsConnecting(true);
      setAuthError(null);

      try {
        const session = await connectPixiv(token);
        await persistRefreshToken(session.refreshToken);
        setUserId(session.userId);
        setIsAuthenticated(true);
        setIsLoginVisible(false);
        setManualToken('');

        const recommended = await fetchRecommendedNovels();
        await persistRefreshToken(recommended.refreshToken);
        updateFeed('recommended', () => ({
          novels: recommended.novels,
          nextUrl: recommended.nextUrl,
          hasLoaded: true,
          isLoading: false,
          isLoadingMore: false,
          error: null,
          loadMoreError: null,
        }));
        void reloadReadingStatuses(recommended.novels);
      } catch (error) {
        disconnectPixiv();

        if (options?.allowOffline) {
          setIsAuthenticated(true);
          setUserId(null);
          setActiveTab('library');
          setAuthError(
            `Pixivへ接続できないためオフラインモードで開いたよ: ${toErrorMessage(error)}`,
          );
        } else {
          await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
          setIsAuthenticated(false);
          setUserId(null);
          setAuthError(toErrorMessage(error));
        }
      } finally {
        connectingRef.current = false;
        setIsConnecting(false);
        setIsBooting(false);
      }
    }, [persistRefreshToken, reloadReadingStatuses, updateFeed],
  );

  useEffect(() => {
    void cleanupInstalledUpdateApk();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const savedToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

        if (!isMounted) {
          return;
        }

        if (savedToken) {
          await connectWithToken(savedToken, { allowOffline: true });
        } else {
          setIsBooting(false);
        }
      } catch (error) {
        if (isMounted) {
          setAuthError(toErrorMessage(error));
          setIsBooting(false);
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, [connectWithToken]);

  async function toggleNewContentNotifications() {
    if (isNotificationSaving) return;
    setIsNotificationSaving(true);
    try {
      const enabled = await setNewContentNotificationEnabled(
        !isNewContentNotificationOn,
      );
      setIsNewContentNotificationOn(enabled);
      if (!enabled && !isNewContentNotificationOn) {
        Alert.alert(
          '通知を有効にできませんでした',
          '端末の通知権限を確認してください。',
        );
      }
    } finally {
      setIsNotificationSaving(false);
    }
  }

  function promptAppUpdate(info: AppUpdateInfo) {
    const canInstallDirectly = Platform.OS === 'android' && info.apkAsset !== null;
    Alert.alert(
      `v${info.latestVersion}を利用できます`,
      info.releaseNotes
        ? info.releaseNotes.slice(0, 500)
        : `現在 v${info.currentVersion}、最新 v${info.latestVersion}です。`,
      [
        { text: 'あとで', style: 'cancel' },
        canInstallDirectly
          ? {
              text: 'ダウンロードして更新',
              onPress: () => void installAppUpdate(info),
            }
          : {
              text: 'Releaseを開く',
              onPress: () => void Linking.openURL(info.releaseUrl),
            },
      ],
    );
  }

  async function installAppUpdate(info: AppUpdateInfo) {
    if (isInstallingUpdate) return;
    if (!info.apkAsset) {
      Alert.alert(
        '対応APKが見つかりません',
        'Releaseの添付ファイルを確認してください。',
        [
          { text: '閉じる', style: 'cancel' },
          {
            text: 'Releaseを開く',
            onPress: () => void Linking.openURL(info.releaseUrl),
          },
        ],
      );
      return;
    }

    setIsInstallingUpdate(true);
    setUpdateDownloadProgress(0);
    let downloaded =
      downloadedUpdateApk?.version === info.latestVersion
        ? downloadedUpdateApk
        : null;
    try {
      if (!downloaded) {
        downloaded = await downloadUpdateApk(
          info.latestVersion,
          info.apkAsset,
          setUpdateDownloadProgress,
        );
        setDownloadedUpdateApk(downloaded);
      }
      await launchUpdateInstaller(downloaded.localUri);
    } catch (error) {
      Alert.alert(
        downloaded
          ? 'インストーラーを起動できませんでした'
          : 'APKをダウンロードできませんでした',
        `${toErrorMessage(error)}\n\n提供元が未許可の場合は設定を開き、許可後に「インストールを再開」を押してください。`,
        [
          { text: '閉じる', style: 'cancel' },
          ...(downloaded
            ? [
                {
                  text: '提供元の許可設定',
                  onPress: () => void openUnknownAppInstallSettings(),
                },
              ]
            : []),
          {
            text: 'Releaseを開く',
            onPress: () => void Linking.openURL(info.releaseUrl),
          },
        ],
      );
    } finally {
      setIsInstallingUpdate(false);
    }
  }

  async function checkAppUpdate(force: boolean) {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const info = await checkForAppUpdate(force);
      if (!info) return;
      setAppUpdateInfo(info);
      if (info.shouldNotify) {
        await markUpdateNotified(info.latestVersion);
        promptAppUpdate(info);
      } else if (force) {
        if (info.hasUpdate) {
          promptAppUpdate(info);
        } else {
          Alert.alert('最新版です', `v${info.currentVersion}を利用中です。`);
        }
      }
    } catch (error) {
      if (force) {
        Alert.alert('更新を確認できませんでした', toErrorMessage(error));
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function handleLogout() {
    disconnectPixiv();
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
    setIsSettingsVisible(false);
    setIsAuthenticated(false);
    setUserId(null);
    setAuthError(null);
    const resetFeeds: Record<AppTab, FeedState> = {
      recommended: { ...EMPTY_FEED },
      following: { ...EMPTY_FEED },
      bookmarks: { ...EMPTY_FEED },
      ranking: { ...EMPTY_FEED },
      search: { ...EMPTY_FEED },
      library: { ...EMPTY_FEED, hasLoaded: true },
    };
    feedsRef.current = resetFeeds;
    submittedSearchRef.current = null;
    inFlightPagesRef.current.clear();
    for (const tab of Object.keys(feedRequestVersionRef.current) as AppTab[]) {
      feedRequestVersionRef.current[tab] += 1;
    }
    setReadingStatuses({});
    setFeeds(resetFeeds);
  }

  function selectTab(tab: AppTab) {
    setActiveTab(tab);

    if (tab !== 'search' && tab !== 'library' && !feeds[tab].hasLoaded) {
      void requestFeed(tab);
    }
  }

  function submitSearch(
    sort: NovelSearchSort = searchSort,
    target: NovelSearchTarget = searchTarget,
  ) {
    const word = searchWord.trim();

    if (word.length === 0) {
      updateFeed('search', (current) => ({
        ...current,
        error: '検索語を入力してください',
      }));
      return;
    }

    setSubmittedSearchWord(word);
    void requestFeed('search', {
      searchWord: word,
      searchSort: sort,
      searchTarget: target,
    });
  }

  function runSearchHistoryItem(item: SearchHistoryItem) {
    setActiveTab('search');
    setSearchWord(item.word);
    setSubmittedSearchWord(item.word);
    setSearchSort(item.sort);
    setSearchTarget(item.target);
    void requestFeed('search', {
      searchWord: item.word,
      searchSort: item.sort,
      searchTarget: item.target,
    });
  }

  async function toggleSearchHistoryPin(item: SearchHistoryItem) {
    await setSearchHistoryPinned(item, !item.isPinned);
    await reloadSearchHistory();
  }

  async function removeSearchHistoryItem(item: SearchHistoryItem) {
    await deleteSearchHistoryItem(item);
    await reloadSearchHistory();
  }

  async function clearSearchHistory() {
    await clearRecentSearchHistory();
    await reloadSearchHistory();
  }

  function confirmMuteAuthor(novel: PixivNovelItem) {
    Alert.alert(
      `「${novel.user.name}」をミュートしますか？`,
      'おすすめ・新着・ランキング・検索・ブックマークの一覧から非表示にします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ミュート',
          style: 'destructive',
          onPress: () => {
            void muteAuthor(novel.user.id, novel.user.name).then(() => {
              removeNovelsFromFeeds((item) => item.user.id === novel.user.id);
            });
          },
        },
      ],
    );
  }

  function confirmMuteTag(tagName: string) {
    Alert.alert(
      `#${tagName} をミュートしますか？`,
      'このタグを含む作品をすべての一覧から非表示にします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ミュート',
          style: 'destructive',
          onPress: () => {
            void muteTag(tagName).then(() => {
              const normalized = tagName.trim().replace(/^#+/, '').toLocaleLowerCase('ja-JP');
              removeNovelsFromFeeds((item) =>
                item.tags.some(
                  (tag) =>
                    tag.name.trim().replace(/^#+/, '').toLocaleLowerCase('ja-JP') ===
                    normalized,
                ),
              );
            });
          },
        },
      ],
    );
  }

  function removeNovelsFromFeeds(
    shouldRemove: (novel: PixivNovelItem) => boolean,
  ) {
    setFeeds((current) => {
      const next = { ...current };
      for (const tab of Object.keys(next) as AppTab[]) {
        next[tab] = {
          ...next[tab],
          novels: next[tab].novels.filter((novel) => !shouldRemove(novel)),
        };
      }
      feedsRef.current = next;
      return next;
    });
  }

  const handleNovelChanged = useCallback((changedNovel: PixivNovelItem) => {
    setFeeds((current) => {
      const next = { ...current };

      for (const tab of Object.keys(next) as AppTab[]) {
        next[tab] = {
          ...next[tab],
          novels: next[tab].novels.map((item) =>
            item.id === changedNovel.id ? changedNovel : item,
          ),
        };
      }

      feedsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => subscribeNovelChanged(handleNovelChanged), [handleNovelChanged]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      void checkAppUpdate(false);
      void isNewContentNotificationEnabled()
        .then(setIsNewContentNotificationOn)
        .catch(() => {});
    });
    return () => cancelAnimationFrame(frameId);
    // 初回起動時だけ実行し、日次制限はapp-update側で管理する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void syncOfflineSeriesSubscriptions()
      .then(async (result) => {
        if (result.discoveredNovels > 0) {
          await notifyNewContent({
            title: '購読シリーズに新話があります',
            body: `${result.discoveredNovels}話を検出し、オフライン保存キューへ追加しました。`,
            data: { type: 'series-update' },
          });
        }
        return processOfflineDownloadQueue();
      })
      .catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncOfflineSeriesSubscriptions()
          .then(async (result) => {
            if (result.discoveredNovels > 0) {
              await notifyNewContent({
                title: '購読シリーズに新話があります',
                body: `${result.discoveredNovels}話を検出し、保存キューへ追加しました。`,
                data: { type: 'series-update' },
              });
            }
            return processOfflineDownloadQueue();
          })
          .catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  const activeFeed = feeds[activeTab];

  useEffect(() => {
    void getAdvancedSearchFilters()
      .then((filters) => {
        searchFiltersRef.current = filters;
        setSearchFilters(filters);
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadSearchHistory();
      void reloadReadingStatuses(feedsRef.current[activeTab].novels);
      void listReadingHistory({ filter: 'reading', sort: 'recent' })
        .then((items) => setContinueReading(items[0] ?? null))
        .catch(() => setContinueReading(null));
    }, [activeTab, reloadReadingStatuses, reloadSearchHistory]),
  );

  const headerTitle = useMemo(() => {
    switch (activeTab) {
      case 'recommended':
        return 'おすすめ小説';
      case 'following':
        return 'フォロー新着';
      case 'bookmarks':
        return 'マイブックマーク';
      case 'ranking':
        return '小説ランキング';
      case 'search':
        return submittedSearchWord
          ? `「${submittedSearchWord}」の検索結果`
          : '小説を検索';
      case 'library':
        return '読書ライブラリ';
    }
  }, [activeTab, submittedSearchWord]);

  if (isBooting) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.bootTitle}>Pixiv Novel Reader</Text>
        <Text style={styles.bootText}>保存済みログインを確認中…</Text>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.loginSafeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.loginContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.loginHero}>
              <Text style={styles.eyebrow}>PIXIV NOVEL READER</Text>
              <Text style={styles.loginTitle}>Pixiv小説を、読むためのアプリ。</Text>
              <Text style={styles.loginDescription}>
                おすすめ、マイブックマーク、ランキング、検索、本文閲覧をひとつに。
              </Text>
            </View>

            <View style={styles.loginCard}>
              <Text style={styles.loginCardTitle}>Pixivへログイン</Text>
              <Text style={styles.loginCardDescription}>
                IDとパスワードはPixivのページへ直接入力される。アプリが保存するのはrefresh tokenだけ。
              </Text>

              <Pressable
                accessibilityRole="button"
                disabled={isConnecting}
                onPress={() => {
                  setIsLoginVisible(true);
                }}
                style={({ pressed }) => [
                  styles.loginButton,
                  pressed && styles.pressed,
                  isConnecting && styles.disabled,
                ]}
              >
                {isConnecting ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.loginButtonText}>Pixivでログイン</Text>
                )}
              </Pressable>

              {authError && (
                <View style={styles.authErrorCard}>
                  <Text style={styles.authErrorText}>{authError}</Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setShowManualToken((current) => !current);
                }}
                style={styles.manualToggle}
              >
                <Text style={styles.manualToggleText}>
                  {showManualToken ? '手動入力を閉じる' : 'WebViewが使えない場合'}
                </Text>
              </Pressable>

              {showManualToken && (
                <View style={styles.manualArea}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isConnecting}
                    onChangeText={setManualToken}
                    placeholder="refresh tokenを貼り付け"
                    placeholderTextColor={colors.placeholder}
                    secureTextEntry
                    selectionColor={colors.accent}
                    style={styles.input}
                    value={manualToken}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={isConnecting || manualToken.trim().length === 0}
                    onPress={() => {
                      void connectWithToken(manualToken);
                    }}
                    style={({ pressed }) => [
                      styles.manualButton,
                      pressed && styles.pressed,
                      (isConnecting || manualToken.trim().length === 0) &&
                        styles.disabled,
                    ]}
                  >
                    <Text style={styles.manualButtonText}>tokenで接続</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {isLoginVisible && (
          <PixivLoginModal
            onClose={() => {
              setIsLoginVisible(false);
            }}
            onSuccess={(token) => connectWithToken(token)}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appSafeArea} edges={['top', 'left', 'right']}>
      <View style={styles.appHeader}>
        <View style={styles.appHeaderText}>
          <Text style={styles.appEyebrow}>PIXIV NOVELS</Text>
          <Text style={styles.appTitle}>{headerTitle}</Text>
        </View>
        <Pressable
          accessibilityLabel="設定"
          accessibilityRole="button"
          onPress={() => {
            setIsSettingsVisible(true);
          }}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.settingsButtonText}>⚙</Text>
        </Pressable>
      </View>

      {userId === null && authError ? (
        <View style={styles.offlineModeBanner}>
          <Text style={styles.offlineModeTitle}>オフラインモード</Text>
          <Text numberOfLines={2} style={styles.offlineModeText}>
            保存済み本文と読書履歴を利用できます。通信の復旧後にアプリを再起動してください。
          </Text>
        </View>
      ) : null}

      <View style={styles.tabBar}>
        {TAB_ITEMS.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab.key}
              onPress={() => {
                selectTab(tab.key);
              }}
              style={({ pressed }) => [
                styles.tabButton,
                isActive && styles.tabButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, isActive && styles.tabLabelActive]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === 'library' ? (
        <LibraryView
          onOpenAuthor={(novelId) => {
            void openAuthorFromNovel(novelId);
          }}
          onTagPress={openTagSearch}
          onOpenNovel={(novelId, resume, scrollOffset, blockIndex) => {
            router.push({
              pathname: '/novel/[id]',
              params: {
                id: String(novelId),
                ...(resume ? { resume: '1' } : {}),
                ...(scrollOffset !== undefined
                  ? { scrollOffset: String(scrollOffset) }
                  : {}),
                ...(blockIndex !== undefined
                  ? { block: String(blockIndex) }
                  : {}),
              },
            });
          }}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={activeFeed.novels}
        ItemSeparatorComponent={ListSeparator}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          <EmptyFeed
            error={activeFeed.error}
            hasLoaded={activeFeed.hasLoaded}
            hasSearchQuery={Boolean(submittedSearchWord)}
            isLoading={activeFeed.isLoading}
            onRetry={() => {
              if (activeTab === 'search' && !submittedSearchWord) {
                return;
              }
              void requestFeed(activeTab);
            }}
            tab={activeTab}
          />
        }
        ListFooterComponent={
          <FeedFooter
            error={activeFeed.loadMoreError}
            hasMore={Boolean(activeFeed.nextUrl)}
            isLoadingMore={activeFeed.isLoadingMore}
            loadedCount={activeFeed.novels.length}
            onLoadMore={() => {
              void requestFeed(activeTab, { append: true });
            }}
          />
        }
        ListHeaderComponent={
          <>
            {activeTab === 'recommended' && continueReading ? (
              <Pressable
                accessibilityLabel={`「${continueReading.title}」を続きから読む`}
                accessibilityRole="button"
                onPress={() => {
                  router.push({
                    pathname: '/novel/[id]',
                    params: {
                      id: String(continueReading.novelId),
                      resume: '1',
                      scrollOffset: String(continueReading.scrollOffset),
                    },
                  });
                }}
                style={({ pressed }) => [
                  styles.continueCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.continueHeader}>
                  <Text style={styles.continueEyebrow}>続きから読む</Text>
                  <Text style={styles.continuePercent}>
                    {Math.round(continueReading.progress * 100)}%
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.continueTitle}>
                  {continueReading.title}
                </Text>
                <Text numberOfLines={1} style={styles.continueAuthor}>
                  {continueReading.authorName}
                </Text>
                <View style={styles.continueTrack}>
                  <View
                    style={[
                      styles.continueValue,
                      { width: `${Math.round(continueReading.progress * 100)}%` },
                    ]}
                  />
                </View>
              </Pressable>
            ) : null}
            <FeedControls
              activeTab={activeTab}
              bookmarkVisibility={bookmarkVisibility}
              onBookmarkVisibilityChange={(visibility) => {
                setBookmarkVisibility(visibility);
                void requestFeed('bookmarks', {
                  bookmarkVisibility: visibility,
                });
              }}
              onRankingModeChange={(mode) => {
                setRankingMode(mode);
                void requestFeed('ranking', { rankingMode: mode });
              }}
              onOpenAdvancedSearch={() => {
                setIsAdvancedSearchVisible(true);
              }}
              onClearSearchHistory={() => {
                void clearSearchHistory();
              }}
              onDeleteSearchHistoryItem={(item) => {
                void removeSearchHistoryItem(item);
              }}
              onRunSearchHistoryItem={runSearchHistoryItem}
              onSearch={() => {
                submitSearch();
              }}
              onSearchSortChange={(sort) => {
                setSearchSort(sort);

                if (searchWord.trim().length > 0) {
                  submitSearch(sort, searchTarget);
                }
              }}
              onSearchTargetChange={(target) => {
                setSearchTarget(target);

                if (searchWord.trim().length > 0) {
                  submitSearch(searchSort, target);
                }
              }}
              onToggleSearchHistoryPin={(item) => {
                void toggleSearchHistoryPin(item);
              }}
              activeSearchFilterCount={countActiveSearchFilters(searchFilters)}
              rankingMode={rankingMode}
              searchHistory={searchHistory}
              searchSort={searchSort}
              searchTarget={searchTarget}
              searchWord={searchWord}
              setSearchWord={setSearchWord}
            />
          </>
        }
        onEndReached={() => {
          if (activeFeed.nextUrl && !activeFeed.isLoadingMore) {
            void requestFeed(activeTab, { append: true });
          }
        }}
        onEndReachedThreshold={0.7}
        refreshControl={
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={() => {
              if (activeTab === 'search' && !submittedSearchWord) {
                return;
              }

              void requestFeed(activeTab);
            }}
            refreshing={activeFeed.isLoading && activeFeed.hasLoaded}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item, index }) => (
          <NovelCard
            novel={item}
            noticeLabel={
              activeTab === 'following' && followingNewIds.has(item.id)
                ? 'NEW'
                : undefined
            }
            onAuthorLongPress={() => confirmMuteAuthor(item)}
            onAuthorPress={() => {
              router.push({
                pathname: '/user/[id]',
                params: { id: String(item.user.id) },
              });
            }}
            readingStatus={readingStatuses[item.id]}
            onTagLongPress={confirmMuteTag}
            onTagPress={openTagSearch}
            onPress={() => {
              cacheNovelForRoute(item);
              router.push({
                pathname: '/novel/detail/[id]',
                params: {
                  bookmarked: item.isBookmarked ? '1' : '0',
                  id: String(item.id),
                },
              });
            }}
            rank={activeTab === 'ranking' ? index + 1 : undefined}
          />
        )}
        />
      )}


      <AdvancedSearchModal
        filters={searchFilters}
        onApply={(filters) => {
          searchFiltersRef.current = filters;
          setSearchFilters(filters);
          setIsAdvancedSearchVisible(false);
          void saveAdvancedSearchFilters(filters);
          if (searchWord.trim().length > 0) {
            void requestFeed('search', {
              searchWord: searchWord.trim(),
              searchSort,
              searchTarget,
            });
          }
        }}
        onClose={() => setIsAdvancedSearchVisible(false)}
        visible={isAdvancedSearchVisible}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setIsSettingsVisible(false);
        }}
        transparent
        visible={isSettingsVisible}
      >
        <Pressable
          onPress={() => {
            setIsSettingsVisible(false);
          }}
          style={styles.modalBackdrop}
        >
          <Pressable onPress={() => {}} style={styles.settingsCard}>
            <ScrollView
              contentContainerStyle={styles.settingsContent}
              showsVerticalScrollIndicator={false}
            >
            <Text style={styles.settingsTitle}>アカウント</Text>
            <Text style={styles.settingsDescription}>
              {userId === null
                ? 'オフラインモードで利用中'
                : `Pixivへ接続済み · userId ${userId}`}
            </Text>
            <Text style={styles.settingsNote}>
              ログアウトすると、端末に保存した認証情報を削除します。
            </Text>
            <View style={styles.settingsDivider} />
            <Text style={styles.settingsSectionTitle}>表示テーマ</Text>
            <View style={styles.chipRow}>
              {THEME_OPTIONS.map((option) => (
                <FilterChip
                  active={themeMode === option.value}
                  key={option.value}
                  label={option.label}
                  onPress={() => {
                    setThemeMode(option.value);
                  }}
                />
              ))}
            </View>
            <Text style={styles.themeStatus}>
              現在は{isDark ? 'ダーク' : 'ライト'}表示
            </Text>
            <View style={styles.settingsDivider} />
            <Text style={styles.settingsSectionTitle}>新着通知</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: isNewContentNotificationOn }}
              disabled={isNotificationSaving}
              onPress={() => void toggleNewContentNotifications()}
              style={({ pressed }) => [
                styles.notificationRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.notificationTextArea}>
                <Text style={styles.notificationTitle}>
                  フォロー新着・シリーズ新話
                </Text>
                <Text style={styles.notificationDescription}>
                  アプリ起動時と復帰時に新着を検出した場合だけ通知します。
                </Text>
              </View>
              <View
                style={[
                  styles.settingsSwitchTrack,
                  isNewContentNotificationOn && styles.settingsSwitchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.settingsSwitchThumb,
                    isNewContentNotificationOn && styles.settingsSwitchThumbActive,
                  ]}
                />
              </View>
            </Pressable>

            <View style={styles.settingsDivider} />
            <View style={styles.updateHeader}>
              <View>
                <Text style={styles.settingsSectionTitle}>アプリ情報</Text>
                <Text style={styles.updateVersion}>現在 v{getCurrentAppVersion()}</Text>
              </View>
              {appUpdateInfo?.hasUpdate ? (
                <View style={styles.updateBadge}>
                  <Text style={styles.updateBadgeText}>v{appUpdateInfo.latestVersion}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.changelogCard}>
              {CURRENT_RELEASE_HIGHLIGHTS.map((highlight) => (
                <View key={highlight} style={styles.changelogRow}>
                  <Text style={styles.changelogBullet}>•</Text>
                  <Text style={styles.changelogText}>{highlight}</Text>
                </View>
              ))}
            </View>
            <View style={styles.updateActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isCheckingUpdate || isInstallingUpdate}
                onPress={() => {
                  if (appUpdateInfo?.hasUpdate) {
                    void installAppUpdate(appUpdateInfo);
                  } else {
                    void checkAppUpdate(true);
                  }
                }}
                style={({ pressed }) => [
                  styles.updateCheckButton,
                  (isCheckingUpdate || isInstallingUpdate) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.updateCheckText}>
                  {isCheckingUpdate
                    ? '確認中…'
                    : isInstallingUpdate
                      ? `ダウンロード中 ${Math.round(updateDownloadProgress * 100)}%`
                      : appUpdateInfo?.hasUpdate
                        ? downloadedUpdateApk?.version === appUpdateInfo.latestVersion
                          ? 'インストールを再開'
                          : `v${appUpdateInfo.latestVersion}へ更新`
                        : '更新を確認'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(
                    appUpdateInfo?.releaseUrl ?? getReleasesUrl(),
                  )
                }
                style={({ pressed }) => [
                  styles.releaseButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.releaseButtonText}>Release一覧</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void handleLogout();
              }}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.logoutButtonText}>ログアウト</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

interface FeedControlsProps {
  activeSearchFilterCount: number;
  activeTab: AppTab;
  bookmarkVisibility: BookmarkVisibility;
  rankingMode: NovelRanking;
  searchHistory: SearchHistoryItem[];
  searchWord: string;
  searchSort: NovelSearchSort;
  searchTarget: NovelSearchTarget;
  setSearchWord: (value: string) => void;
  onBookmarkVisibilityChange: (value: BookmarkVisibility) => void;
  onClearSearchHistory: () => void;
  onDeleteSearchHistoryItem: (item: SearchHistoryItem) => void;
  onOpenAdvancedSearch: () => void;
  onRankingModeChange: (value: NovelRanking) => void;
  onRunSearchHistoryItem: (item: SearchHistoryItem) => void;
  onSearchSortChange: (value: NovelSearchSort) => void;
  onSearchTargetChange: (value: NovelSearchTarget) => void;
  onToggleSearchHistoryPin: (item: SearchHistoryItem) => void;
  onSearch: () => void;
}

function FeedControls({
  activeSearchFilterCount,
  activeTab,
  bookmarkVisibility,
  rankingMode,
  searchHistory,
  searchWord,
  searchSort,
  searchTarget,
  setSearchWord,
  onBookmarkVisibilityChange,
  onClearSearchHistory,
  onDeleteSearchHistoryItem,
  onOpenAdvancedSearch,
  onRankingModeChange,
  onRunSearchHistoryItem,
  onSearchSortChange,
  onSearchTargetChange,
  onToggleSearchHistoryPin,
  onSearch,
}: FeedControlsProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pinnedSearches = searchHistory.filter((item) => item.isPinned);
  const recentSearches = searchHistory.filter((item) => !item.isPinned).slice(0, 8);

  if (activeTab === 'recommended') {
    return (
      <View style={styles.feedIntro}>
        <Text style={styles.feedIntroTitle}>おすすめの小説</Text>
        <Text style={styles.feedIntroText}>
          Pixivのおすすめから小説のみを表示します。
        </Text>
      </View>
    );
  }

  if (activeTab === 'following') {
    return (
      <View style={styles.feedIntro}>
        <Text style={styles.feedIntroTitle}>フォロー中の作者の新着</Text>
        <Text style={styles.feedIntroText}>
          フォロー中ユーザーの最近の小説を投稿日順でまとめます。
        </Text>
      </View>
    );
  }

  if (activeTab === 'bookmarks') {
    return (
      <View style={styles.controlsBlock}>
        <Text style={styles.controlLabel}>ブックマークの公開範囲</Text>
        <View style={styles.chipRow}>
          <FilterChip
            active={bookmarkVisibility === 'public'}
            label="公開"
            onPress={() => {
              onBookmarkVisibilityChange('public');
            }}
          />
          <FilterChip
            active={bookmarkVisibility === 'private'}
            label="非公開"
            onPress={() => {
              onBookmarkVisibilityChange('private');
            }}
          />
        </View>
      </View>
    );
  }

  if (activeTab === 'ranking') {
    return (
      <View style={styles.controlsBlock}>
        <Text style={styles.controlLabel}>ランキング種別</Text>
        <ScrollView
          contentContainerStyle={styles.horizontalChips}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {RANKING_OPTIONS.map((option) => (
            <FilterChip
              active={rankingMode === option.value}
              key={option.value}
              label={option.label}
              onPress={() => {
                onRankingModeChange(option.value);
              }}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.searchControls}>
      <View style={styles.searchRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchWord}
          onSubmitEditing={onSearch}
          placeholder="タイトル・タグ・キーワード"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          selectionColor={colors.accent}
          style={styles.searchInput}
          value={searchWord}
        />
        <Pressable
          accessibilityRole="button"
          onPress={onSearch}
          style={({ pressed }) => [
            styles.searchButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.searchButtonText}>検索</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenAdvancedSearch}
        style={({ pressed }) => [
          styles.advancedSearchButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.advancedSearchButtonText}>詳細条件</Text>
        <Text style={styles.advancedSearchButtonMeta}>
          {activeSearchFilterCount > 0
            ? `${activeSearchFilterCount}件の条件を適用中`
            : '文字数・人気度・R-18・AI・シリーズ・読了状態'}
        </Text>
        <Text style={styles.advancedSearchArrow}>›</Text>
      </Pressable>

      {pinnedSearches.length > 0 ? (
        <View style={styles.searchHistorySection}>
          <Text style={styles.controlLabel}>保存した検索</Text>
          <ScrollView
            contentContainerStyle={styles.searchHistoryRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {pinnedSearches.map((item) => (
              <SearchHistoryCard
                item={item}
                key={getSearchHistoryKey(item)}
                onDelete={() => onDeleteSearchHistoryItem(item)}
                onPress={() => onRunSearchHistoryItem(item)}
                onTogglePin={() => onToggleSearchHistoryPin(item)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {recentSearches.length > 0 ? (
        <View style={styles.searchHistorySection}>
          <View style={styles.searchHistoryHeader}>
            <Text style={styles.controlLabel}>最近の検索</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClearSearchHistory}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <Text style={styles.searchHistoryClearText}>履歴を消す</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.searchHistoryRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {recentSearches.map((item) => (
              <SearchHistoryCard
                item={item}
                key={getSearchHistoryKey(item)}
                onDelete={() => onDeleteSearchHistoryItem(item)}
                onPress={() => onRunSearchHistoryItem(item)}
                onTogglePin={() => onToggleSearchHistoryPin(item)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Text style={styles.controlLabel}>検索対象</Text>
      <ScrollView
        contentContainerStyle={styles.horizontalChips}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {SEARCH_TARGET_OPTIONS.map((option) => (
          <FilterChip
            active={searchTarget === option.value}
            key={option.value}
            label={option.label}
            onPress={() => {
              onSearchTargetChange(option.value);
            }}
          />
        ))}
      </ScrollView>
      <Text style={styles.controlLabel}>並び順</Text>
      <ScrollView
        contentContainerStyle={styles.horizontalChips}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {SEARCH_SORT_OPTIONS.map((option) => (
          <FilterChip
            active={searchSort === option.value}
            key={option.value}
            label={option.label}
            onPress={() => {
              onSearchSortChange(option.value);
            }}
          />
        ))}
      </ScrollView>
      {searchSort === 'popular_desc' && (
        <Text style={styles.premiumNote}>人気順はPixiv Premium限定の場合があります。</Text>
      )}
    </View>
  );
}

function SearchHistoryCard({
  item,
  onDelete,
  onPress,
  onTogglePin,
}: {
  item: SearchHistoryItem;
  onDelete: () => void;
  onPress: () => void;
  onTogglePin: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const targetLabel =
    SEARCH_TARGET_OPTIONS.find((option) => option.value === item.target)?.label ??
    '検索';
  const sortLabel =
    SEARCH_SORT_OPTIONS.find((option) => option.value === item.sort)?.label ??
    '新しい順';

  return (
    <View style={styles.searchHistoryCard}>
      <Pressable
        accessibilityLabel={`「${item.word}」を再検索`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.searchHistoryMain,
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={styles.searchHistoryWord}>
          {item.word}
        </Text>
        <Text numberOfLines={1} style={styles.searchHistoryMeta}>
          {targetLabel} ・ {sortLabel}
          {item.useCount > 1 ? ` ・ ${item.useCount}回` : ''}
        </Text>
      </Pressable>
      <View style={styles.searchHistoryActions}>
        <Pressable
          accessibilityLabel={
            item.isPinned ? '保存した検索から外す' : 'この検索を保存'
          }
          accessibilityRole="button"
          onPress={onTogglePin}
          style={({ pressed }) => [
            styles.searchHistoryActionButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.searchHistoryPinText,
              item.isPinned && styles.searchHistoryPinTextActive,
            ]}
          >
            {item.isPinned ? '★' : '☆'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="この検索履歴を削除"
          accessibilityRole="button"
          onPress={onDelete}
          style={({ pressed }) => [
            styles.searchHistoryActionButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.searchHistoryDeleteText}>×</Text>
        </Pressable>
      </View>
    </View>
  );
}

function getSearchHistoryKey(item: SearchHistoryItem): string {
  return `${item.word}\u0000${item.sort}\u0000${item.target}`;
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.filterChipText, active && styles.filterChipTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyFeed({
  error,
  hasLoaded,
  hasSearchQuery,
  isLoading,
  onRetry,
  tab,
}: {
  error: string | null;
  hasLoaded: boolean;
  hasSearchQuery: boolean;
  isLoading: boolean;
  onRetry: () => void;
  tab: AppTab;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (isLoading || (tab === 'search' && hasSearchQuery && !hasLoaded)) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.emptyTitle}>小説を読み込み中…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>⚠️</Text>
        <Text style={styles.emptyTitle}>取得できなかった</Text>
        <Text style={styles.emptyText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.retryButtonText}>もう一度読み込む</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>{tab === 'search' ? '🔎' : '📚'}</Text>
      <Text style={styles.emptyTitle}>
        {tab === 'search' ? '小説を検索' : '小説が見つかりませんでした'}
      </Text>
      <Text style={styles.emptyText}>
        {tab === 'bookmarks'
          ? '公開／非公開を切り替えて確認してください。'
          : tab === 'search'
            ? 'キーワードを入力して検索してください。'
            : '条件を変更するか、時間を置いて更新してください。'}
      </Text>
    </View>
  );
}

function FeedFooter({
  error,
  hasMore,
  isLoadingMore,
  loadedCount,
  onLoadMore,
}: {
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadedCount: number;
  onLoadMore: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (isLoadingMore) {
    return (
      <View style={styles.footerLoading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.footerText}>
          続きを読み込み中…（{loadedCount}件表示中）
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loadMoreErrorBox}>
        <Text style={styles.loadMoreErrorText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onLoadMore}
          style={({ pressed }) => [
            styles.loadMoreButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.loadMoreText}>続きの取得をやり直す</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasMore) {
    return loadedCount > 0 ? (
      <View style={styles.footerComplete}>
        <Text style={styles.footerText}>{loadedCount}件を読み込みました</Text>
      </View>
    ) : (
      <View style={styles.footerSpace} />
    );
  }

  return (
    <View style={styles.loadMoreArea}>
      <Text style={styles.footerText}>{loadedCount}件表示中</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onLoadMore}
        style={({ pressed }) => [
          styles.loadMoreButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.loadMoreText}>もっと見る</Text>
      </Pressable>
    </View>
  );
}

function ListSeparator() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.separator} />;
}

function countActiveSearchFilters(filters: AdvancedSearchFilters): number {
  return [
    filters.minCharacters !== null,
    filters.maxCharacters !== null,
    filters.minBookmarks !== null,
    !filters.includeR18,
    !filters.includeAi,
    filters.dateRange !== 'all',
    filters.seriesMode !== 'all',
    filters.hideFinished,
  ].filter(Boolean).length;
}

function mergeNovels(
  current: PixivNovelItem[],
  incoming: PixivNovelItem[],
): PixivNovelItem[] {
  const items = new Map<number, PixivNovelItem>();

  for (const novel of [...current, ...incoming]) {
    items.set(novel.id, novel);
  }

  return [...items.values()];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  flex: {
    flex: 1,
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  bootTitle: {
    marginTop: 6,
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  bootText: {
    alignSelf: 'stretch',
    color: colors.textMuted,
    fontSize: 13,
    includeFontPadding: true,
    lineHeight: 21,
    textAlign: 'center',
  },
  loginSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loginContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 44,
    paddingBottom: 90,
    gap: 30,
  },
  loginHero: {
    gap: 10,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  loginTitle: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 41,
  },
  loginDescription: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
  },
  loginCard: {
    gap: 14,
    borderRadius: 22,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  loginCardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  loginCardDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 21,
  },
  loginButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.accent,
  },
  loginButtonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: '900',
  },
  authErrorCard: {
    padding: 13,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  authErrorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 19,
  },
  manualToggle: {
    alignSelf: 'center',
    padding: 6,
  },
  manualToggleText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  manualArea: {
    gap: 10,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 14,
  },
  manualButton: {
    minHeight: 47,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.neutralButton,
  },
  manualButtonText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: '800',
  },
  appSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  appHeaderText: {
    flex: 1,
    gap: 2,
  },
  appEyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  appTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  settingsButton: {
    width: 43,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  settingsButtonText: {
    color: colors.textSecondary,
    fontSize: 21,
  },
  offlineModeBanner: {
    gap: 3,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
  },
  offlineModeTitle: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: '900',
  },
  offlineModeText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 5,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 5,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
  },
  tabButton: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 3,
    paddingVertical: 8,
    borderRadius: 13,
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 1,
  },
  tabIcon: {
    fontSize: 15,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: colors.accentStrong,
  },
  listContent: {
    width: '100%',
    maxWidth: 760,
    flexGrow: 1,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 70,
  },
  continueCard: {
    gap: 6,
    marginBottom: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  continueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  continueEyebrow: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: '900',
  },
  continuePercent: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  continueTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
  },
  continueAuthor: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  continueTrack: {
    height: 5,
    marginTop: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  continueValue: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  separator: {
    height: 11,
  },
  feedIntro: {
    gap: 4,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 17,
  },
  feedIntroTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  feedIntroText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  controlsBlock: {
    gap: 9,
    paddingHorizontal: 3,
    paddingTop: 8,
    paddingBottom: 17,
  },
  controlLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  horizontalChips: {
    gap: 8,
    paddingRight: 14,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  filterChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  filterChipTextActive: {
    color: colors.onAccent,
  },
  advancedSearchButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  advancedSearchButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  advancedSearchButtonMeta: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
  },
  advancedSearchArrow: {
    color: colors.accentStrong,
    fontSize: 20,
    fontWeight: '900',
  },
  searchControls: {
    gap: 10,
    paddingTop: 8,
    paddingBottom: 17,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
  },
  searchButton: {
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  searchButtonText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: '900',
  },
  searchHistorySection: {
    gap: 7,
    paddingTop: 2,
  },
  searchHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  searchHistoryClearText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
  },
  searchHistoryRow: {
    gap: 9,
    paddingRight: 14,
  },
  searchHistoryCard: {
    width: 214,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  searchHistoryMain: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchHistoryWord: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  searchHistoryMeta: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
  },
  searchHistoryActions: {
    width: 42,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  searchHistoryActionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHistoryPinText: {
    color: colors.textMuted,
    fontSize: 17,
  },
  searchHistoryPinTextActive: {
    color: colors.bookmark,
  },
  searchHistoryDeleteText: {
    color: colors.danger,
    fontSize: 19,
    lineHeight: 22,
  },
  premiumNote: {
    color: colors.warning,
    fontSize: 11,
  },
  emptyState: {
    flex: 1,
    minHeight: 330,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 30,
  },
  emptyEmoji: {
    fontSize: 34,
  },
  emptyTitle: {
    alignSelf: 'stretch',
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    includeFontPadding: true,
    lineHeight: 27,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
    borderRadius: 13,
    backgroundColor: colors.accent,
  },
  retryButtonText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: '900',
  },
  footerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  footerText: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 12,
    includeFontPadding: true,
    lineHeight: 19,
  },
  footerSpace: {
    height: 24,
  },
  footerComplete: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  loadMoreArea: {
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  loadMoreErrorBox: {
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  loadMoreErrorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  loadMoreText: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.overlay,
  },
  settingsCard: {
    width: '100%',
    maxHeight: '88%',
    maxWidth: 380,
    gap: 12,
    padding: 22,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  settingsContent: {
    padding: 20,
  },
  notificationRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 9,
    paddingHorizontal: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
  },
  notificationTextArea: { flex: 1, gap: 3 },
  notificationTitle: { color: colors.text, fontSize: 11, fontWeight: '900' },
  notificationDescription: { color: colors.textMuted, fontSize: 9, lineHeight: 15 },
  settingsSwitchTrack: {
    width: 44,
    height: 26,
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderRadius: 13,
    backgroundColor: colors.border,
  },
  settingsSwitchTrackActive: { backgroundColor: colors.accent },
  settingsSwitchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  settingsSwitchThumbActive: { alignSelf: 'flex-end' },
  updateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  updateVersion: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  updateBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  updateBadgeText: { color: colors.accentStrong, fontSize: 10, fontWeight: '900' },
  changelogCard: {
    gap: 7,
    marginTop: 10,
    padding: 12,
    borderRadius: 13,
    backgroundColor: colors.surfaceAlt,
  },
  changelogRow: { flexDirection: 'row', gap: 7 },
  changelogBullet: { color: colors.accentStrong, fontSize: 12, fontWeight: '900' },
  changelogText: { flex: 1, color: colors.textMuted, fontSize: 10, lineHeight: 16 },
  updateActions: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 8 },
  updateCheckButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  updateCheckText: { color: colors.onAccent, fontSize: 11, fontWeight: '900' },
  releaseButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
  },
  releaseButtonText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  settingsTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  settingsDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  settingsNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 19,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
    backgroundColor: colors.border,
  },
  settingsSectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  themeStatus: {
    color: colors.textMuted,
    fontSize: 11,
  },
  logoutButton: {
    minHeight: 49,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: 14,
    backgroundColor: colors.dangerSoft,
  },
  logoutButtonText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.52,
  },
  });
}
