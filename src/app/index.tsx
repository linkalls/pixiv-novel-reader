import type { PixivNovelItem } from '@book000/pixivts';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
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

import { LibraryView } from '@/components/library-view';
import { NovelCard } from '@/components/novel-card';
import { PixivLoginModal } from '@/components/pixiv-login-modal';
import {
  getNovelReadingStatuses,
  type NovelReadingStatus,
} from '@/lib/library-db';
import { subscribeNovelChanged } from '@/lib/novel-events';
import { cacheNovelForRoute } from '@/lib/novel-route-cache';
import {
  connectPixiv,
  disconnectPixiv,
  fetchBookmarkedNovels,
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
import { buildPixivUserUrl } from '@/lib/pixiv-links';
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

type AppTab =
  | 'recommended'
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
  const [readingStatuses, setReadingStatuses] = useState<
    Record<number, NovelReadingStatus>
  >({});
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

        const nextNovels = append
          ? mergeNovels(feedsRef.current[tab].novels, result.novels)
          : result.novels;

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

  const openAuthorFromNovel = useCallback(async (novelId: number) => {
    try {
      const novel = await fetchNovelDetail(novelId);
      await Linking.openURL(buildPixivUserUrl(novel.user.id));
    } catch (error) {
      Alert.alert(
        'プロフィールを開けませんでした',
        toErrorMessage(error),
      );
    }
  }, []);

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

  async function handleLogout() {
    disconnectPixiv();
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
    setIsSettingsVisible(false);
    setIsAuthenticated(false);
    setUserId(null);
    setAuthError(null);
    const resetFeeds: Record<AppTab, FeedState> = {
      recommended: { ...EMPTY_FEED },
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

  const activeFeed = feeds[activeTab];

  useFocusEffect(
    useCallback(() => {
      void reloadSearchHistory();
      void reloadReadingStatuses(feedsRef.current[activeTab].novels);
    }, [activeTab, reloadReadingStatuses, reloadSearchHistory]),
  );

  const headerTitle = useMemo(() => {
    switch (activeTab) {
      case 'recommended':
        return 'おすすめ小説';
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
          onOpenNovel={(novelId, resume, scrollOffset) => {
            router.push({
              pathname: '/novel/[id]',
              params: {
                id: String(novelId),
                ...(resume ? { resume: '1' } : {}),
                ...(scrollOffset !== undefined
                  ? { scrollOffset: String(scrollOffset) }
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
            rankingMode={rankingMode}
            searchHistory={searchHistory}
            searchSort={searchSort}
            searchTarget={searchTarget}
            searchWord={searchWord}
            setSearchWord={setSearchWord}
          />
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
            readingStatus={readingStatuses[item.id]}
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
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

interface FeedControlsProps {
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
  onRankingModeChange: (value: NovelRanking) => void;
  onRunSearchHistoryItem: (item: SearchHistoryItem) => void;
  onSearchSortChange: (value: NovelSearchSort) => void;
  onSearchTargetChange: (value: NovelSearchTarget) => void;
  onToggleSearchHistoryPin: (item: SearchHistoryItem) => void;
  onSearch: () => void;
}

function FeedControls({
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
  isLoading,
  onRetry,
  tab,
}: {
  error: string | null;
  isLoading: boolean;
  onRetry: () => void;
  tab: AppTab;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (isLoading) {
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
    padding: 20,
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
    maxWidth: 380,
    gap: 12,
    padding: 22,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
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
