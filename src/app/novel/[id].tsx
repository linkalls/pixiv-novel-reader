import type { PixivNovelItem } from '@book000/pixivts';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import * as SystemUI from 'expo-system-ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path as SvgPath } from 'react-native-svg';

import { BookshelfPickerModal } from '@/components/bookshelf-picker-modal';
import { NovelSeriesModal } from '@/components/novel-series-modal';
import { ReaderMarksModal } from '@/components/reader-marks-modal';
import { ReaderSpeechModal } from '@/components/reader-speech-modal';
import { RecommendationExclusionsModal } from '@/components/recommendation-exclusions-modal';
import {
  VerticalReaderView,
  type VerticalReaderHandle,
} from '@/components/vertical-reader-view';
import { PixivNovelAjaxLoader } from '@/components/pixiv-novel-ajax-loader';
import {
  ReaderNavigationModal,
  type ReaderNavigationMode,
} from '@/components/reader-navigation-modal';
import {
  parseBookmarkRouteParam,
  resolveBookmarkState,
  type BookmarkState,
  type BookmarkStateSource,
} from '@/lib/bookmark-state';
import {
  deleteOfflineNovel,
  getOfflineNovel,
  getReadingHistory,
  recordNovelOpened,
  saveOfflineNovel,
  updateOfflineNovelDetail,
  updateReadingProgress,
} from '@/lib/library-db';
import { emitNovelChanged } from '@/lib/novel-events';
import {
  excludeRecommendation,
  listExcludedRecommendationIds,
  type ReaderMark,
} from '@/lib/organizer-db';
import {
  buildDetailRouteParams,
  buildReaderRouteParams,
} from '@/lib/reader-flow';
import { cacheNovelForRoute } from '@/lib/novel-route-cache';
import {
  getAdjacentSeriesNovels,
  getNovelSeries,
} from '@/lib/novel-series';
import { localizeNovelImages } from '@/lib/offline-assets';
import { parseNovelBlocks, type NovelBlock } from '@/lib/novel-format';
import { createReaderSpeechChunks } from '@/lib/reader-speech';
import {
  buildReaderToc,
  searchReaderBlocks,
  type ReaderTocEntry,
} from '@/lib/reader-navigation';
import {
  createReaderMarkExcerpt,
  findReaderBlockAtOffset,
} from '@/lib/reader-marks';
import { ReadingActivityClock } from '@/lib/reading-activity';
import {
  finishReadingSession,
  startReadingSession,
  updateReadingSession,
} from '@/lib/reading-stats-db';
import {
  getRecommendationReason,
  type RecommendationSource,
} from '@/lib/recommendation-reason';
import {
  fetchNovelDetail,
  fetchNovelSeries,
  fetchNovelText,
  fetchRecommendedNovels,
  fetchRelatedNovels,
  setNovelBookmark,
  type NovelReaderContent,
} from '@/lib/pixiv';
import { useAppTheme } from '@/theme';

const READER_SETTINGS_KEY = 'pixiv-reader-settings-v1';
const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';
const READING_SESSION_SAVE_INTERVAL_MS = 15_000;

type ReaderThemeName = 'white' | 'gray' | 'black' | 'blue' | 'yellow';
type ReaderFontSize = 'small' | 'normal' | 'large';
type ReaderLineSpacing = 'narrow' | 'wide';
type ReaderLayout = 'horizontal' | 'vertical';

interface ReaderSettings {
  theme: ReaderThemeName;
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
  layout: ReaderLayout;
}

interface ReaderPalette {
  background: string;
  toolbar: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  overlay: string;
  isDark: boolean;
}

const READER_THEMES: Record<ReaderThemeName, ReaderPalette> = {
  white: {
    background: '#FFFFFF',
    toolbar: '#FFFFFF',
    text: '#252525',
    muted: '#747474',
    border: '#E5E5E5',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  gray: {
    background: '#EEEEEE',
    toolbar: '#F5F5F5',
    text: '#292929',
    muted: '#6E6E6E',
    border: '#D2D2D2',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  black: {
    background: '#101010',
    toolbar: '#181818',
    text: '#E9E9E9',
    muted: '#9D9D9D',
    border: '#303030',
    accent: '#29A8FF',
    overlay: 'rgba(0, 0, 0, 0.72)',
    isDark: true,
  },
  blue: {
    background: '#EAF7FC',
    toolbar: '#F2FBFE',
    text: '#26343A',
    muted: '#6A7D85',
    border: '#CDE3EC',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  yellow: {
    background: '#FFF7DC',
    toolbar: '#FFF9E8',
    text: '#3A3325',
    muted: '#81745A',
    border: '#E8DDBD',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
};

const THEME_OPTIONS: { value: ReaderThemeName; label: string }[] = [
  { value: 'white', label: '白' },
  { value: 'gray', label: '灰' },
  { value: 'black', label: '黒' },
  { value: 'blue', label: '青' },
  { value: 'yellow', label: '黄' },
];

const FONT_SIZE_VALUES: Record<ReaderFontSize, number> = {
  small: 15,
  normal: 18,
  large: 22,
};

const LINE_HEIGHT_RATIOS: Record<ReaderLineSpacing, number> = {
  narrow: 1.72,
  wide: 2.08,
};

export default function NovelReaderScreen() {
  const router = useRouter();
  const isScreenFocused = useIsFocused();
  const openUserProfile = useCallback(
    (userId: number) => {
      // この読書画面へ「戻る」だけでは、同じ作品をもう一度開いた扱いにしない。
      router.setParams({ history: 'restore' });
      router.push({
        pathname: '/user/[id]',
        params: { id: String(userId) },
      });
    },
    [router],
  );
  const params = useLocalSearchParams<{
    bookmarked?: string | string[];
    history?: string | string[];
    id?: string | string[];
    resume?: string | string[];
    scrollOffset?: string | string[];
  }>();
  const { colors, isDark: isAppDark } = useAppTheme();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawHistory = Array.isArray(params.history)
    ? params.history[0]
    : params.history;
  const rawResume = Array.isArray(params.resume)
    ? params.resume[0]
    : params.resume;
  const rawScrollOffset = Array.isArray(params.scrollOffset)
    ? params.scrollOffset[0]
    : params.scrollOffset;
  const parsedScrollOffset = Number(rawScrollOffset);
  const directScrollOffset =
    Number.isFinite(parsedScrollOffset) && parsedScrollOffset >= 0
      ? parsedScrollOffset
      : null;
  const novelId = Number(rawId);
  const isValidNovelId = Number.isInteger(novelId) && novelId > 0;
  const shouldResume = rawResume === '1';
  const shouldRecordHistory = rawHistory !== 'restore';
  const routeBookmarkState = parseBookmarkRouteParam(params.bookmarked);

  const [detail, setDetail] = useState<PixivNovelItem | null>(null);
  const [readerContent, setReaderContent] =
    useState<NovelReaderContent | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(isValidNovelId);
  const [isTextLoading, setIsTextLoading] = useState(isValidNovelId);
  const [isAjaxLoading, setIsAjaxLoading] = useState(false);
  const [isOfflineChecked, setIsOfflineChecked] = useState(!isValidNovelId);
  const [isOfflineSaved, setIsOfflineSaved] = useState(false);
  const [isOfflineLoading, setIsOfflineLoading] = useState(false);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [bookmarkState, setBookmarkState] = useState<BookmarkState>({
    value: routeBookmarkState,
    source: routeBookmarkState === null ? null : 'route',
  });
  const bookmarkStateRef = useRef<BookmarkState>({
    value: routeBookmarkState,
    source: routeBookmarkState === null ? null : 'route',
  });
  const [ajaxAttempt, setAjaxAttempt] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isValidNovelId ? null : '作品IDを読み取れませんでした',
  );
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isSpeechVisible, setIsSpeechVisible] = useState(false);
  const [isMoreVisible, setIsMoreVisible] = useState(false);
  const [isBookshelfVisible, setIsBookshelfVisible] = useState(false);
  const [isMarksVisible, setIsMarksVisible] = useState(false);
  const [isExclusionsVisible, setIsExclusionsVisible] = useState(false);
  const [excludedNovelIds, setExcludedNovelIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [isNavigatorVisible, setIsNavigatorVisible] = useState(false);
  const [navigationMode, setNavigationMode] =
    useState<ReaderNavigationMode>('toc');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1);
  const [isSeriesVisible, setIsSeriesVisible] = useState(false);
  const [seriesNovels, setSeriesNovels] = useState<PixivNovelItem[]>([]);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [isSeriesLoading, setIsSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesAttempt, setSeriesAttempt] = useState(0);
  const [isSeriesDownloading, setIsSeriesDownloading] = useState(false);
  const [seriesDownloadProgress, setSeriesDownloadProgress] = useState<string | null>(null);
  const [offlineImageProgress, setOfflineImageProgress] = useState<string | null>(
    null,
  );
  const [scrollProgress, setScrollProgress] = useState(0);
  const [verticalBlockIndex, setVerticalBlockIndex] = useState(0);
  const [relatedNovels, setRelatedNovels] = useState<PixivNovelItem[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(isValidNovelId);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [relatedAttempt, setRelatedAttempt] = useState(1);
  const [discoveryNovels, setDiscoveryNovels] = useState<PixivNovelItem[]>([]);
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(isValidNovelId);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>({
    theme: isAppDark ? 'black' : 'white',
    fontSize: 'normal',
    lineSpacing: 'wide',
    layout: 'horizontal',
  });
  const isReadingSurfaceVisible =
    isScreenFocused &&
    !isSettingsVisible &&
    !isSpeechVisible &&
    !isMoreVisible &&
    !isBookshelfVisible &&
    !isMarksVisible &&
    !isExclusionsVisible &&
    !isNavigatorVisible &&
    !isSeriesVisible;
  const fallbackStartedRef = useRef(false);
  const readerEndOffsetRef = useRef<number | null>(null);
  const novelBodyOffsetRef = useRef(0);
  const blockOffsetsRef = useRef<Record<number, number>>({});
  const scrollViewRef = useRef<ScrollView>(null);
  const verticalReaderRef = useRef<VerticalReaderHandle>(null);
  const currentProgressRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  const verticalInitialProgressRef = useRef(0);
  const pendingHorizontalProgressRef = useRef<number | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const resumeOffsetRef = useRef<number | null>(null);
  const hasRestoredPositionRef = useRef(false);
  const hasOfflineContentRef = useRef(false);
  const historyNovelIdRef = useRef<number | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const isReaderFocusedRef = useRef(isReadingSurfaceVisible);
  const readingActivityClockRef = useRef<ReadingActivityClock | null>(null);
  const readingSessionPromiseRef = useRef<Promise<number> | null>(null);
  const readingSessionNovelIdRef = useRef<number | null>(null);
  const readingSessionSaveIntervalRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const palette = READER_THEMES[settings.theme];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const blocks = useMemo(
    () => (readerContent ? parseNovelBlocks(readerContent.text) : []),
    [readerContent],
  );
  const tocEntries = useMemo(() => buildReaderToc(blocks), [blocks]);
  const speechChunks = useMemo(
    () => createReaderSpeechChunks(blocks),
    [blocks],
  );
  const currentMarkBlockIndex =
    settings.layout === 'vertical'
      ? verticalBlockIndex
      : findReaderBlockAtOffset(
          blockOffsetsRef.current,
          novelBodyOffsetRef.current,
          currentScrollOffsetRef.current,
        );
  const currentMarkExcerpt = createReaderMarkExcerpt(
    blocks,
    currentMarkBlockIndex,
  );
  const searchMatches = useMemo(
    () => searchReaderBlocks(blocks, searchQuery),
    [blocks, searchQuery],
  );
  const activeSearchBlockIndex =
    activeSearchMatchIndex >= 0
      ? (searchMatches[activeSearchMatchIndex]?.blockIndex ?? -1)
      : -1;
  const series = getNovelSeries(detail);
  const seriesId = series?.id ?? null;
  const adjacentSeries = useMemo(
    () => getAdjacentSeriesNovels(seriesNovels, novelId),
    [novelId, seriesNovels],
  );
  const relatedItems = useMemo(
    () =>
      relatedNovels.filter(
        (novel) =>
          novel.id !== novelId && !excludedNovelIds.has(novel.id),
      ),
    [excludedNovelIds, novelId, relatedNovels],
  );
  const discoveryItems = useMemo(() => {
    const relatedIds = new Set(relatedItems.map((novel) => novel.id));
    return discoveryNovels
      .filter(
        (novel) =>
          novel.id !== novelId &&
          !relatedIds.has(novel.id) &&
          !excludedNovelIds.has(novel.id),
      )
      .slice(0, 12);
  }, [discoveryNovels, excludedNovelIds, novelId, relatedItems]);
  const fontSize = FONT_SIZE_VALUES[settings.fontSize];
  const lineHeight = Math.round(
    fontSize * LINE_HEIGHT_RATIOS[settings.lineSpacing],
  );

  const applyBookmarkState = useCallback(
    (value: boolean, source: BookmarkStateSource): BookmarkState => {
      const resolvedState = resolveBookmarkState(bookmarkStateRef.current, {
        value,
        source,
      });
      bookmarkStateRef.current = resolvedState;
      setBookmarkState(resolvedState);
      return resolvedState;
    },
    [],
  );

  const markReadingActivity = useCallback(() => {
    readingActivityClockRef.current?.markInteraction();
  }, []);

  const persistCurrentReadingSession = useCallback((finalize = false) => {
    const readingSession = readingSessionPromiseRef.current;
    const activityClock = readingActivityClockRef.current;
    if (!readingSession || !activityClock) {
      return;
    }

    const activeDurationMs = activityClock.getDuration();
    const endProgress = currentProgressRef.current;
    void readingSession
      .then((sessionId) =>
        finalize
          ? finishReadingSession(sessionId, endProgress, activeDurationMs)
          : updateReadingSession(sessionId, endProgress, activeDurationMs),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    isReaderFocusedRef.current = isReadingSurfaceVisible;
    const activityClock = readingActivityClockRef.current;
    if (!activityClock) {
      return;
    }

    const now = Date.now();
    activityClock.setScreenFocused(isReadingSurfaceVisible, now);
    if (isReadingSurfaceVisible) {
      activityClock.markInteraction(now);
    } else {
      persistCurrentReadingSession();
    }
  }, [isReadingSurfaceVisible, persistCurrentReadingSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      const activityClock = readingActivityClockRef.current;
      if (!activityClock) {
        return;
      }

      const now = Date.now();
      const isActive = nextState === 'active';
      activityClock.setAppActive(isActive, now);
      if (isActive) {
        activityClock.markInteraction(now);
      } else {
        persistCurrentReadingSession();
      }
    });

    return () => subscription.remove();
  }, [persistCurrentReadingSession]);

  useEffect(() => {
    let isMounted = true;

    async function restoreSettings() {
      const rawSettings = await SecureStore.getItemAsync(
        READER_SETTINGS_KEY,
      ).catch(() => null);

      if (!isMounted || !rawSettings) {
        return;
      }

      try {
        const parsed = JSON.parse(rawSettings) as Partial<ReaderSettings>;
        const theme = isReaderTheme(parsed.theme) ? parsed.theme : settings.theme;
        const nextFontSize = isReaderFontSize(parsed.fontSize)
          ? parsed.fontSize
          : 'normal';
        const lineSpacing = isReaderLineSpacing(parsed.lineSpacing)
          ? parsed.lineSpacing
          : 'wide';
        const layout = isReaderLayout(parsed.layout)
          ? parsed.layout
          : 'horizontal';

        setSettings({
          theme,
          fontSize: nextFontSize,
          lineSpacing,
          layout,
        });
      } catch {
        // 壊れた設定値は無視し、既定値で読める状態を優先する。
      }
    }

    void restoreSettings();

    return () => {
      isMounted = false;
    };
    // 初回だけ復元する。端末テーマ変更はアプリ全体の設定画面に任せる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRecommendationExclusions() {
      try {
        const ids = await listExcludedRecommendationIds();
        if (isMounted) {
          setExcludedNovelIds(ids);
        }
      } catch {
        // 除外設定が読めなくても、おすすめ本体は表示できるようにする。
      }
    }

    void loadRecommendationExclusions();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background).catch(() => {});

    return () => {
      void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    };
  }, [colors.background, palette.background]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId) {
      return () => {
        isMounted = false;
      };
    }

    async function loadLocalReaderState() {
      try {
        const [offlineRecord, history] = await Promise.all([
          getOfflineNovel(novelId),
          shouldResume && directScrollOffset === null
            ? getReadingHistory(novelId)
            : Promise.resolve(null),
        ]);

        if (!isMounted) {
          return;
        }

        if (directScrollOffset !== null) {
          resumeOffsetRef.current = directScrollOffset;
          currentScrollOffsetRef.current = directScrollOffset;
        } else if (history && shouldResume && !history.isFinished) {
          resumeOffsetRef.current = history.scrollOffset;
          currentProgressRef.current = history.progress;
          currentScrollOffsetRef.current = history.scrollOffset;
          verticalInitialProgressRef.current = history.progress;
          setScrollProgress(history.progress);
        }

        if (offlineRecord) {
          hasOfflineContentRef.current = true;
          const resolvedBookmark = applyBookmarkState(
            offlineRecord.detail.isBookmarked,
            'offline',
          );
          setDetail({
            ...offlineRecord.detail,
            isBookmarked:
              resolvedBookmark.value ?? offlineRecord.detail.isBookmarked,
          });
          setReaderContent(offlineRecord.content);
          setIsOfflineSaved(true);
          setIsDetailLoading(false);
          setIsTextLoading(false);
          setIsAjaxLoading(false);
        } else {
          setIsAjaxLoading(true);
        }
      } catch {
        if (isMounted) {
          setIsAjaxLoading(true);
        }
      } finally {
        if (isMounted) {
          setIsOfflineChecked(true);
        }
      }
    }

    void loadLocalReaderState();

    return () => {
      isMounted = false;
    };
  }, [
    applyBookmarkState,
    directScrollOffset,
    isValidNovelId,
    novelId,
    shouldResume,
  ]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId || !isOfflineChecked) {
      return () => {
        isMounted = false;
      };
    }

    async function loadDetail() {
      try {
        const nextDetail = await fetchNovelDetail(novelId);

        if (isMounted) {
          const resolvedBookmark = applyBookmarkState(
            nextDetail.isBookmarked,
            'remote',
          );
          const resolvedDetail: PixivNovelItem = {
            ...nextDetail,
            isBookmarked:
              resolvedBookmark.value ?? nextDetail.isBookmarked,
          };
          setDetail(resolvedDetail);
          emitNovelChanged(resolvedDetail);
        }
      } catch (error) {
        if (isMounted && !hasOfflineContentRef.current) {
          setErrorMessage(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [applyBookmarkState, isOfflineChecked, isValidNovelId, novelId]);

  useEffect(() => {
    let isMounted = true;

    if (!seriesId) {
      return () => {
        isMounted = false;
      };
    }

    const currentSeriesId = seriesId;

    async function loadSeries() {
      setIsSeriesLoading(true);
      setSeriesError(null);

      try {
        const result = await fetchNovelSeries(currentSeriesId);

        if (!isMounted) {
          return;
        }

        setSeriesTitle(result.detail.title);
        setSeriesNovels(result.novels);
        await SecureStore.setItemAsync(
          REFRESH_TOKEN_KEY,
          result.refreshToken,
        ).catch(() => {});
      } catch (error) {
        if (isMounted) {
          setSeriesError(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsSeriesLoading(false);
        }
      }
    }

    void loadSeries();

    return () => {
      isMounted = false;
    };
  }, [seriesAttempt, seriesId]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId || !isOfflineChecked) {
      return () => {
        isMounted = false;
      };
    }

    async function loadRelatedNovels() {
      try {
        const result = await fetchRelatedNovels(novelId);

        if (!isMounted) {
          return;
        }

        await SecureStore.setItemAsync(
          REFRESH_TOKEN_KEY,
          result.refreshToken,
        ).catch(() => {});

        if (!isMounted) {
          return;
        }

        setRelatedNovels(
          result.novels
            .filter((novel) => novel.id !== novelId)
            .slice(0, 12),
        );
        setRelatedError(null);
      } catch (error) {
        if (isMounted) {
          setRelatedError(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsRelatedLoading(false);
        }
      }
    }

    void loadRelatedNovels();

    return () => {
      isMounted = false;
    };
  }, [isOfflineChecked, isValidNovelId, novelId, relatedAttempt]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId || !isOfflineChecked) {
      return () => {
        isMounted = false;
      };
    }

    async function loadDiscovery() {
      try {
        const result = await fetchRecommendedNovels();

        if (!isMounted) {
          return;
        }

        await SecureStore.setItemAsync(
          REFRESH_TOKEN_KEY,
          result.refreshToken,
        ).catch(() => {});

        if (isMounted) {
          setDiscoveryNovels(result.novels);
          setDiscoveryError(null);
        }
      } catch (error) {
        if (isMounted) {
          setDiscoveryError(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsDiscoveryLoading(false);
        }
      }
    }

    void loadDiscovery();

    return () => {
      isMounted = false;
    };
  }, [discoveryAttempt, isOfflineChecked, isValidNovelId, novelId]);

  const handleAjaxSuccess = useCallback((content: NovelReaderContent) => {
    setReaderContent(content);
    setIsAjaxLoading(false);
    setIsTextLoading(false);
    setErrorMessage(null);
  }, []);

  const handleAjaxFailure = useCallback(
    async (ajaxError: Error) => {
      if (fallbackStartedRef.current || !isValidNovelId) {
        return;
      }

      fallbackStartedRef.current = true;
      setIsAjaxLoading(false);

      try {
        const content = await fetchNovelText(novelId);
        setReaderContent(content);
        setErrorMessage(null);
      } catch (fallbackError) {
        const offlineRecord = await getOfflineNovel(novelId).catch(() => null);

        if (offlineRecord) {
          hasOfflineContentRef.current = true;
          const resolvedBookmark = applyBookmarkState(
            offlineRecord.detail.isBookmarked,
            'offline',
          );
          setDetail({
            ...offlineRecord.detail,
            isBookmarked:
              resolvedBookmark.value ?? offlineRecord.detail.isBookmarked,
          });
          setReaderContent(offlineRecord.content);
          setIsOfflineSaved(true);
          setErrorMessage(null);
          showStatus('通信できないため、保存済み本文を表示しました');
        } else {
          setErrorMessage(
            `${ajaxError.message}\n${toErrorMessage(fallbackError)}`,
          );
        }
      } finally {
        setIsTextLoading(false);
      }
    },
    [applyBookmarkState, isValidNovelId, novelId],
  );

  useEffect(() => {
    if (!isOfflineSaved || !detail) {
      return;
    }

    void updateOfflineNovelDetail({
      ...detail,
      isBookmarked: bookmarkState.value ?? detail.isBookmarked,
    });
  }, [bookmarkState.value, detail, isOfflineSaved]);

  useEffect(() => {
    if (!detail || !readerContent || historyNovelIdRef.current === detail.id) {
      return;
    }

    historyNovelIdRef.current = detail.id;
    if (!shouldRecordHistory) {
      return;
    }

    void recordNovelOpened(
      detail,
      currentProgressRef.current,
      currentScrollOffsetRef.current,
    );
  }, [detail, readerContent, shouldRecordHistory]);

  useEffect(() => {
    if (
      !detail ||
      !readerContent ||
      readingSessionNovelIdRef.current === detail.id
    ) {
      return;
    }

    readingSessionNovelIdRef.current = detail.id;
    readingActivityClockRef.current = new ReadingActivityClock({
      appActive: appStateRef.current === 'active',
      screenFocused: isReaderFocusedRef.current,
    });
    readingSessionPromiseRef.current = startReadingSession(
      detail,
      currentProgressRef.current,
    );

    if (readingSessionSaveIntervalRef.current) {
      clearInterval(readingSessionSaveIntervalRef.current);
    }
    readingSessionSaveIntervalRef.current = setInterval(() => {
      if (
        appStateRef.current === 'active' &&
        isReaderFocusedRef.current
      ) {
        persistCurrentReadingSession();
      }
    }, READING_SESSION_SAVE_INTERVAL_MS);
  }, [detail, persistCurrentReadingSession, readerContent]);

  useEffect(() => {
    return () => {
      if (progressSaveTimerRef.current) {
        clearTimeout(progressSaveTimerRef.current);
      }
      if (readingSessionSaveIntervalRef.current) {
        clearInterval(readingSessionSaveIntervalRef.current);
        readingSessionSaveIntervalRef.current = null;
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
      if (isValidNovelId && historyNovelIdRef.current === novelId) {
        void updateReadingProgress(
          novelId,
          currentProgressRef.current,
          currentScrollOffsetRef.current,
        );
      }

      readingActivityClockRef.current?.setScreenFocused(false);
      persistCurrentReadingSession(true);
      readingActivityClockRef.current = null;
      readingSessionPromiseRef.current = null;
    };
  }, [isValidNovelId, novelId, persistCurrentReadingSession]);

  function showStatus(message: string) {
    setStatusMessage(message);

    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
    }

    statusTimerRef.current = setTimeout(() => {
      setStatusMessage(null);
      statusTimerRef.current = null;
    }, 2_600);
  }

  function updateSettings(nextSettings: ReaderSettings) {
    if (nextSettings.layout === 'vertical' && settings.layout !== 'vertical') {
      verticalInitialProgressRef.current = currentProgressRef.current;
    }
    if (nextSettings.layout === 'horizontal' && settings.layout === 'vertical') {
      pendingHorizontalProgressRef.current = currentProgressRef.current;
      hasRestoredPositionRef.current = true;
    }
    setSettings(nextSettings);
    void SecureStore.setItemAsync(
      READER_SETTINGS_KEY,
      JSON.stringify(nextSettings),
    ).catch(() => {});
  }

  function retryReader() {
    if (!isValidNovelId) {
      return;
    }

    fallbackStartedRef.current = false;
    setReaderContent(null);
    setErrorMessage(null);
    setIsTextLoading(true);
    setIsAjaxLoading(true);
    setAjaxAttempt((current) => current + 1);
  }

  async function toggleBookmark() {
    if (bookmarkState.value === null || isBookmarkLoading) {
      return;
    }

    const previousBookmarkState = bookmarkState.value;
    const previousDetail = detail;
    const shouldBookmark = !bookmarkState.value;
    const optimisticDetail = detail
      ? {
          ...detail,
          isBookmarked: shouldBookmark,
          totalBookmarks: Math.max(
            0,
            detail.totalBookmarks + (shouldBookmark ? 1 : -1),
          ),
        }
      : null;

    setIsBookmarkLoading(true);
    setErrorMessage(null);
    applyBookmarkState(shouldBookmark, 'user');

    if (optimisticDetail) {
      setDetail(optimisticDetail);
      emitNovelChanged(optimisticDetail);
    }

    try {
      const refreshToken = await setNovelBookmark(novelId, shouldBookmark);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      showStatus(
        shouldBookmark
          ? 'ブックマークに追加しました'
          : 'ブックマークを解除しました',
      );
    } catch (error) {
      applyBookmarkState(previousBookmarkState, 'user');
      setDetail(previousDetail);

      if (previousDetail) {
        emitNovelChanged(previousDetail);
      }

      showStatus(`ブックマークを変更できなかった: ${toErrorMessage(error)}`);
    } finally {
      setIsBookmarkLoading(false);
    }
  }

  async function toggleOfflineSave() {
    if (!detail || !readerContent || isOfflineLoading) {
      return;
    }

    setIsOfflineLoading(true);

    try {
      if (isOfflineSaved) {
        await deleteOfflineNovel(detail.id);
        setIsOfflineSaved(false);
        hasOfflineContentRef.current = false;
        showStatus('オフライン保存を削除しました');
      } else {
        const localizedContent = await localizeNovelImages(
          detail.id,
          readerContent,
          ({ completed, total }) => {
            setOfflineImageProgress(
              total > 0 ? `挿絵を保存中 ${completed}/${total}` : null,
            );
          },
        );
        await saveOfflineNovel(
          {
            ...detail,
            isBookmarked: bookmarkState.value ?? detail.isBookmarked,
          },
          localizedContent,
        );
        setIsOfflineSaved(true);
        hasOfflineContentRef.current = true;
        showStatus(
          Object.keys(localizedContent.embeddedImages).length > 0
            ? '本文と挿絵をオフライン保存しました'
            : '本文をオフライン保存しました',
        );
      }
    } catch (error) {
      showStatus(`オフライン保存を変更できなかった: ${toErrorMessage(error)}`);
    } finally {
      setOfflineImageProgress(null);
      setIsOfflineLoading(false);
    }
  }


  async function downloadEntireSeries() {
    if (
      isSeriesDownloading ||
      seriesNovels.length === 0 ||
      !seriesId
    ) {
      return;
    }

    setIsSeriesDownloading(true);
    setSeriesDownloadProgress(`0/${seriesNovels.length}`);
    let savedCount = 0;
    const failedTitles: string[] = [];

    for (const [index, novel] of seriesNovels.entries()) {
      setSeriesDownloadProgress(`${index + 1}/${seriesNovels.length}`);
      try {
        const targetDetail =
          detail?.id === novel.id ? detail : await fetchNovelDetail(novel.id);
        const targetContent =
          detail?.id === novel.id && readerContent
            ? readerContent
            : await fetchNovelText(novel.id);
        const localizedContent = await localizeNovelImages(
          novel.id,
          targetContent,
        );
        await saveOfflineNovel(targetDetail, localizedContent);
        savedCount += 1;

        if (novel.id === novelId) {
          setIsOfflineSaved(true);
          hasOfflineContentRef.current = true;
        }
      } catch {
        failedTitles.push(novel.title);
      }
    }

    setIsSeriesDownloading(false);
    setSeriesDownloadProgress(null);

    if (failedTitles.length === 0) {
      showStatus(`シリーズ全${savedCount}話を保存しました`);
    } else {
      showStatus(
        `${savedCount}話を保存し、${failedTitles.length}話の保存に失敗しました`,
      );
    }
  }

  function scheduleProgressSave(progress: number, scrollOffset: number) {
    markReadingActivity();
    currentProgressRef.current = progress;
    currentScrollOffsetRef.current = scrollOffset;

    if (progressSaveTimerRef.current || !isValidNovelId) {
      return;
    }

    progressSaveTimerRef.current = setTimeout(() => {
      progressSaveTimerRef.current = null;
      void updateReadingProgress(
        novelId,
        currentProgressRef.current,
        currentScrollOffsetRef.current,
      );
      persistCurrentReadingSession();
    }, 800);
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const fallbackMaximumOffset = contentSize.height - layoutMeasurement.height;
    const readerEndOffset = readerEndOffsetRef.current;
    const readingMaximumOffset =
      readerEndOffset === null
        ? fallbackMaximumOffset
        : readerEndOffset - layoutMeasurement.height + 76;

    const nextProgress =
      readingMaximumOffset <= 0
        ? 1
        : Math.max(
            0,
            Math.min(1, contentOffset.y / readingMaximumOffset),
          );

    setScrollProgress(nextProgress);
    scheduleProgressSave(nextProgress, contentOffset.y);
  }

  function jumpToBlock(blockIndex: number) {
    if (settings.layout === 'vertical') {
      verticalReaderRef.current?.jumpToBlock(blockIndex, true);
      return;
    }

    const blockOffset = blockOffsetsRef.current[blockIndex] ?? 0;
    const y = Math.max(0, novelBodyOffsetRef.current + blockOffset - 18);
    scrollViewRef.current?.scrollTo({ animated: true, y });
  }

  function selectTocEntry(entry: ReaderTocEntry) {
    setIsNavigatorVisible(false);
    setActiveSearchMatchIndex(-1);
    requestAnimationFrame(() => jumpToBlock(entry.blockIndex));
  }

  function selectSearchMatch(index: number) {
    const match = searchMatches[index];

    if (!match) {
      return;
    }

    setActiveSearchMatchIndex(index);
    setIsNavigatorVisible(false);
    requestAnimationFrame(() => jumpToBlock(match.blockIndex));
  }

  function pushReaderNovel(novel: PixivNovelItem) {
    // 新しい作品は履歴スタックへ積み、戻ると前の作品へ戻れるようにする。
    // ただし戻って表示された前の作品は、もう一度開いた履歴としては記録しない。
    cacheNovelForRoute(novel);
    router.setParams({ history: 'restore' });
    router.push({
      pathname: '/novel/[id]',
      params: buildReaderRouteParams(novel.id, {
        bookmarked: novel.isBookmarked,
      }),
    });
  }

  function openSeriesNovel(novel: PixivNovelItem) {
    setIsSeriesVisible(false);
    pushReaderNovel(novel);
  }

  async function openAuthorFromNovel(novelId: number) {
    try {
      const novel = await fetchNovelDetail(novelId);
      openUserProfile(novel.user.id);
    } catch (error) {
      showStatus(`プロフィールを開けなかった: ${toErrorMessage(error)}`);
    }
  }

  async function hideRecommendation(novel: PixivNovelItem) {
    try {
      await excludeRecommendation(novel);
      setExcludedNovelIds((current) => {
        const next = new Set(current);
        next.add(novel.id);
        return next;
      });
      showStatus('この作品をおすすめから非表示にしました');
    } catch (error) {
      showStatus(`おすすめ設定を変更できなかった: ${toErrorMessage(error)}`);
    }
  }

  function jumpToReaderMark(mark: ReaderMark) {
    setIsMarksVisible(false);
    currentScrollOffsetRef.current = mark.scrollOffset;
    currentProgressRef.current = mark.progress;
    setScrollProgress(mark.progress);
    requestAnimationFrame(() => {
      if (settings.layout === 'vertical') {
        verticalReaderRef.current?.jumpToBlock(mark.blockIndex, true);
      } else {
        scrollViewRef.current?.scrollTo({ animated: true, y: mark.scrollOffset });
      }
    });
  }

  function restoreReadingPosition() {
    if (
      hasRestoredPositionRef.current ||
      resumeOffsetRef.current === null ||
      resumeOffsetRef.current <= 0
    ) {
      return;
    }

    hasRestoredPositionRef.current = true;
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({
        animated: false,
        y: resumeOffsetRef.current ?? 0,
      });
    });
  }

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      onTouchStart={markReadingActivity}
      style={styles.safeArea}
    >
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      {isOfflineChecked && isAjaxLoading && !readerContent && isValidNovelId && (
        <PixivNovelAjaxLoader
          key={`${novelId}-${ajaxAttempt}`}
          novelId={novelId}
          onFailure={(error) => {
            void handleAjaxFailure(error);
          }}
          onSuccess={handleAjaxSuccess}
        />
      )}

      <View style={styles.toolbar}>
        <View style={styles.toolbarSide}>
          <ToolbarSymbolButton
            accessibilityLabel="前の画面へ戻る"
            androidName="arrow_back"
            iosName="chevron.left"
            onPress={() => {
              router.back();
            }}
            palette={palette}
            size={27}
          />
        </View>
        <View style={styles.toolbarTitleArea}>
          <Text numberOfLines={1} style={styles.toolbarTitle}>
            {readerContent?.title ?? detail?.title ?? '小説'}
          </Text>
        </View>
        <View style={[styles.toolbarSide, styles.toolbarSideRight]}>
          <ToolbarBookmarkButton
            accessibilityLabel={
              bookmarkState.value
                ? 'ブックマークを解除する'
                : 'ブックマークする'
            }
            bookmarked={bookmarkState.value === true}
            disabled={bookmarkState.value === null || isBookmarkLoading}
            onPress={(event) => {
              event.stopPropagation();
              void toggleBookmark();
            }}
            palette={palette}
            size={27}
          />
          <ToolbarSymbolButton
            accessibilityLabel="その他の操作"
            androidName="more_horiz"
            iosName="ellipsis"
            onPress={() => {
              setIsMoreVisible(true);
            }}
            palette={palette}
            size={27}
          />
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressValue,
            { width: `${Math.round(scrollProgress * 100)}%` },
          ]}
        />
      </View>

      {isTextLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} size="large" />
          <Text style={styles.loadingText}>本文を読み込み中…</Text>
        </View>
      ) : readerContent ? (
        settings.layout === 'vertical' ? (
          <VerticalReaderView
            authorName={detail?.user.name ?? null}
            background={palette.background}
            blocks={blocks}
            embeddedImages={readerContent.embeddedImages}
            fontSize={fontSize}
            initialProgress={verticalInitialProgressRef.current}
            lineHeight={lineHeight}
            meta={
              detail
                ? `${detail.textLength.toLocaleString()}字 ・ ${new Date(
                    detail.createDate,
                  ).toLocaleDateString('ja-JP')}`
                : null
            }
            muted={palette.muted}
            onActivity={markReadingActivity}
            onAuthorPress={() => {
              if (detail) {
                openUserProfile(detail.user.id);
              }
            }}
            onBlockChange={setVerticalBlockIndex}
            onProgress={(progress) => {
              setScrollProgress(progress);
              scheduleProgressSave(progress, 0);
            }}
            ref={verticalReaderRef}
            seriesTitle={readerContent.seriesTitle ?? null}
            text={palette.text}
            title={readerContent.title ?? detail?.title ?? '無題'}
            toolbar={palette.border}
          />
        ) : (
          <ScrollView
          contentContainerStyle={styles.readerContent}
          onContentSizeChange={restoreReadingPosition}
          onScroll={handleScroll}
          ref={scrollViewRef}
          scrollEventThrottle={80}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.workHeader}>
            {readerContent.seriesTitle ? (
              <Text style={styles.seriesTitle}>
                {readerContent.seriesTitle}
              </Text>
            ) : null}
            <Text selectable style={styles.workTitle}>
              {readerContent.title ?? detail?.title ?? '無題'}
            </Text>
            {detail ? (
              <>
                <Pressable
                  accessibilityLabel={`作者「${detail.user.name}」のプロフィールを開く`}
                  accessibilityRole="link"
                  onPress={() => {
                    openUserProfile(detail.user.id);
                  }}
                  style={({ pressed }) => [
                    styles.authorLink,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.authorName}>{detail.user.name}</Text>
                  <Text style={styles.authorLinkArrow}>›</Text>
                </Pressable>
                <Text style={styles.workMeta}>
                  {detail.textLength.toLocaleString()}字　・　
                  {new Date(detail.createDate).toLocaleDateString('ja-JP')}
                </Text>
              </>
            ) : isDetailLoading ? (
              <ActivityIndicator color={palette.accent} size="small" />
            ) : null}
          </View>

          <View style={styles.titleDivider} />

          <View
            onLayout={(event) => {
              novelBodyOffsetRef.current = event.nativeEvent.layout.y;
            }}
            style={styles.novelBody}
          >
            {blocks.map((block, index) => (
              <View
                key={`${block.type}-${index}`}
                onLayout={(event) => {
                  blockOffsetsRef.current[index] = event.nativeEvent.layout.y;
                }}
                style={
                  activeSearchBlockIndex === index
                    ? styles.searchHitBlock
                    : undefined
                }
              >
                <NovelBlockView
                  block={block}
                  embeddedImages={readerContent.embeddedImages}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  palette={palette}
                  styles={styles}
                />
              </View>
            ))}
          </View>

          <View
            onLayout={(event) => {
              const { height, y } = event.nativeEvent.layout;
              const readerEndOffset = y + height;
              readerEndOffsetRef.current = readerEndOffset;
              const pendingProgress = pendingHorizontalProgressRef.current;
              if (pendingProgress !== null) {
                pendingHorizontalProgressRef.current = null;
                requestAnimationFrame(() => {
                  scrollViewRef.current?.scrollTo({
                    animated: false,
                    y: Math.max(0, readerEndOffset * pendingProgress),
                  });
                });
              }
            }}
            style={styles.readerEnd}
          >
            <Text style={styles.readerEndMark}>◆</Text>
            <Text style={styles.readerEndText}>読了</Text>
          </View>

          {seriesId ? (
            <SeriesNavigationSection
              currentIndex={adjacentSeries.currentIndex}
              error={seriesError}
              isLoading={isSeriesLoading}
              nextNovel={adjacentSeries.next}
              onNext={() => {
                if (adjacentSeries.next) {
                  openSeriesNovel(adjacentSeries.next);
                }
              }}
              onOpenList={() => {
                setIsSeriesVisible(true);
              }}
              onPrevious={() => {
                if (adjacentSeries.previous) {
                  openSeriesNovel(adjacentSeries.previous);
                }
              }}
              onRetry={() => {
                setSeriesAttempt((current) => current + 1);
              }}
              palette={palette}
              previousNovel={adjacentSeries.previous}
              seriesTitle={seriesTitle || series?.title || 'シリーズ'}
              styles={styles}
              total={seriesNovels.length}
            />
          ) : null}

          <RecommendationSection
            emptyText="類似する作品は見つかりませんでした"
            error={relatedError}
            eyebrow="FOR YOU"
            isLoading={isRelatedLoading}
            loadingText="関連作品を検索中…"
            currentNovel={detail}
            novels={relatedItems}
            onAuthorPress={(authorUserId) => {
              openUserProfile(authorUserId);
            }}
            onExclude={(relatedNovel) => {
              void hideRecommendation(relatedNovel);
            }}
            onNovelPress={(relatedNovel) => {
              pushReaderNovel(relatedNovel);
            }}
            onRetry={() => {
              setIsRelatedLoading(true);
              setRelatedError(null);
              setRelatedAttempt((current) => current + 1);
            }}
            palette={palette}
            source="related"
            styles={styles}
            title="こちらもおすすめ"
          />

          <RecommendationSection
            emptyText="該当する作品はありません"
            error={discoveryError}
            eyebrow="DISCOVERY"
            isLoading={isDiscoveryLoading}
            loadingText="ディスカバリーを読み込み中…"
            currentNovel={detail}
            novels={discoveryItems}
            onAuthorPress={(authorUserId) => {
              openUserProfile(authorUserId);
            }}
            onExclude={(discoveryNovel) => {
              void hideRecommendation(discoveryNovel);
            }}
            onNovelPress={(discoveryNovel) => {
              pushReaderNovel(discoveryNovel);
            }}
            onRetry={() => {
              setIsDiscoveryLoading(true);
              setDiscoveryError(null);
              setDiscoveryAttempt((current) => current + 1);
            }}
            palette={palette}
            source="discovery"
            styles={styles}
            title="ディスカバリー"
          />
          </ScrollView>
        )
      ) : (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>本文を表示できませんでした</Text>
          <Text style={styles.errorText}>
            {errorMessage ?? '本文を読み込めませんでした'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retryReader}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryButtonText}>もう一度読み込む</Text>
          </Pressable>
        </View>
      )}

      <ReaderNavigationModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        matches={searchMatches}
        mode={navigationMode}
        muted={palette.muted}
        onClose={() => {
          setIsNavigatorVisible(false);
        }}
        onModeChange={setNavigationMode}
        onQueryChange={(query) => {
          setSearchQuery(query);
          setActiveSearchMatchIndex(-1);
        }}
        onSelectMatch={selectSearchMatch}
        onSelectToc={selectTocEntry}
        overlay={palette.overlay}
        query={searchQuery}
        text={palette.text}
        toc={tocEntries}
        visible={isNavigatorVisible}
      />

      <NovelSeriesModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        currentNovelId={novelId}
        downloadProgress={seriesDownloadProgress}
        error={seriesError}
        isDownloading={isSeriesDownloading}
        isLoading={isSeriesLoading}
        muted={palette.muted}
        novels={seriesNovels}
        onClose={() => {
          setIsSeriesVisible(false);
        }}
        onDownloadAll={() => {
          void downloadEntireSeries();
        }}
        onNovelPress={openSeriesNovel}
        onRetry={() => {
          setSeriesAttempt((current) => current + 1);
        }}
        overlay={palette.overlay}
        seriesTitle={seriesTitle || series?.title || 'シリーズ'}
        text={palette.text}
        visible={isSeriesVisible}
      />

      <BookshelfPickerModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        detail={detail}
        muted={palette.muted}
        onClose={() => setIsBookshelfVisible(false)}
        onStatus={showStatus}
        overlay={palette.overlay}
        text={palette.text}
        visible={isBookshelfVisible}
      />

      <ReaderMarksModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        currentBlockIndex={currentMarkBlockIndex}
        currentExcerpt={currentMarkExcerpt}
        currentProgress={currentProgressRef.current}
        currentScrollOffset={currentScrollOffsetRef.current}
        detail={detail}
        muted={palette.muted}
        onClose={() => setIsMarksVisible(false)}
        onJump={jumpToReaderMark}
        onStatus={showStatus}
        overlay={palette.overlay}
        text={palette.text}
        visible={isMarksVisible}
      />

      <ReaderSpeechModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        chunks={speechChunks}
        muted={palette.muted}
        onClose={() => setIsSpeechVisible(false)}
        onJump={jumpToBlock}
        overlay={palette.overlay}
        startBlockIndex={currentMarkBlockIndex}
        text={palette.text}
        visible={isSpeechVisible}
      />

      <RecommendationExclusionsModal
        accent={palette.accent}
        background={palette.toolbar}
        border={palette.border}
        muted={palette.muted}
        onClose={() => setIsExclusionsVisible(false)}
        onOpenAuthor={(excludedNovelId) => {
          void openAuthorFromNovel(excludedNovelId);
        }}
        onRestored={(restoredNovelId) => {
          setExcludedNovelIds((current) => {
            const next = new Set(current);
            next.delete(restoredNovelId);
            return next;
          });
          showStatus('おすすめへ戻しました');
        }}
        overlay={palette.overlay}
        text={palette.text}
        visible={isExclusionsVisible}
      />

      <ReaderSettingsModal
        onChange={updateSettings}
        onClose={() => {
          setIsSettingsVisible(false);
        }}
        palette={palette}
        settings={settings}
        visible={isSettingsVisible}
      />

      {statusMessage ? (
        <View pointerEvents="none" style={styles.statusToast}>
          <Text numberOfLines={3} style={styles.statusToastText}>
            {statusMessage}
          </Text>
        </View>
      ) : null}

      <MoreActionsModal
        canOrganize={detail !== null}
        isOfflineLoading={isOfflineLoading}
        isOfflineSaved={isOfflineSaved}
        onClose={() => {
          setIsMoreVisible(false);
        }}
        hasSeries={seriesId !== null}
        offlineImageProgress={offlineImageProgress}
        onOpenNavigator={() => {
          setIsMoreVisible(false);
          setNavigationMode('toc');
          requestAnimationFrame(() => setIsNavigatorVisible(true));
        }}
        onOpenSeries={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => setIsSeriesVisible(true));
        }}
        onOpenBookshelf={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => setIsBookshelfVisible(true));
        }}
        onOpenMarks={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => setIsMarksVisible(true));
        }}
        onOpenExclusions={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => setIsExclusionsVisible(true));
        }}
        onOpenDetail={() => {
          setIsMoreVisible(false);

          if (detail) {
            cacheNovelForRoute({
              ...detail,
              isBookmarked: bookmarkState.value ?? detail.isBookmarked,
            });
          }

          router.setParams({ history: 'restore' });
          requestAnimationFrame(() => {
            // 読書メニューから開いた詳細は、必ず読書画面の上へ積む。
            // 詳細の戻る操作で一覧ではなく、元の読書位置へ戻れるようにする。
            router.push({
              pathname: '/novel/detail/[id]',
              params: buildDetailRouteParams(novelId, bookmarkState.value),
            });
          });
        }}
        onOpenPixiv={() => {
          setIsMoreVisible(false);
          void Linking.openURL(
            `https://www.pixiv.net/novel/show.php?id=${novelId}`,
          );
        }}
        onOpenSettings={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => {
            setIsSettingsVisible(true);
          });
        }}
        onOpenSpeech={() => {
          setIsMoreVisible(false);
          requestAnimationFrame(() => {
            setIsSpeechVisible(true);
          });
        }}
        onReload={() => {
          setIsMoreVisible(false);
          retryReader();
        }}
        onReturn={() => {
          setIsMoreVisible(false);
          router.back();
        }}
        onToggleOffline={() => {
          setIsMoreVisible(false);
          void toggleOfflineSave();
        }}
        palette={palette}
        progress={scrollProgress}
        visible={isMoreVisible}
      />
    </SafeAreaView>
  );
}

interface SeriesNavigationSectionProps {
  currentIndex: number;
  error: string | null;
  isLoading: boolean;
  nextNovel: PixivNovelItem | null;
  onNext: () => void;
  onOpenList: () => void;
  onPrevious: () => void;
  onRetry: () => void;
  palette: ReaderPalette;
  previousNovel: PixivNovelItem | null;
  seriesTitle: string;
  styles: ReturnType<typeof createStyles>;
  total: number;
}

function SeriesNavigationSection({
  currentIndex,
  error,
  isLoading,
  nextNovel,
  onNext,
  onOpenList,
  onPrevious,
  onRetry,
  palette,
  previousNovel,
  seriesTitle,
  styles,
  total,
}: SeriesNavigationSectionProps) {
  return (
    <View style={styles.seriesSection}>
      <View style={styles.seriesHeadingRow}>
        <View style={styles.seriesHeadingText}>
          <Text style={styles.relatedEyebrow}>SERIES</Text>
          <Text numberOfLines={2} style={styles.seriesSectionTitle}>
            {seriesTitle}
          </Text>
        </View>
        {currentIndex >= 0 && total > 0 ? (
          <Text style={styles.relatedCount}>
            {currentIndex + 1}/{total}話
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.seriesLoading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.relatedMuted}>シリーズを読み込み中…</Text>
        </View>
      ) : error ? (
        <View style={styles.seriesCompleteCard}>
          <Text style={styles.seriesCompleteTitle}>
            シリーズを読み込めませんでした
          </Text>
          <Text numberOfLines={3} style={styles.relatedMuted}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.seriesRetryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.seriesRetryText}>もう一度読み込む</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {nextNovel ? (
            <Pressable
              accessibilityRole="button"
              onPress={onNext}
              style={({ pressed }) => [
                styles.nextEpisodeButton,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.nextEpisodeText}>
                <Text style={styles.nextEpisodeLabel}>次の話を読む</Text>
                <Text numberOfLines={2} style={styles.nextEpisodeTitle}>
                  {nextNovel.title}
                </Text>
              </View>
              <Text style={styles.nextEpisodeArrow}>›</Text>
            </Pressable>
          ) : (
            <View style={styles.seriesCompleteCard}>
              <Text style={styles.seriesCompleteTitle}>シリーズ最新話まで読了</Text>
              <Text style={styles.relatedMuted}>
                新しい話は、追加後にシリーズ一覧から確認できます。
              </Text>
            </View>
          )}

          <View style={styles.seriesActionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={!previousNovel}
              onPress={onPrevious}
              style={({ pressed }) => [
                styles.seriesSubButton,
                !previousNovel && styles.seriesSubButtonDisabled,
                pressed && previousNovel && styles.pressed,
              ]}
            >
              <Text style={styles.seriesSubButtonText}>‹ 前の話</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenList}
              style={({ pressed }) => [
                styles.seriesSubButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.seriesSubButtonText}>全話一覧</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

interface RecommendationSectionProps {
  currentNovel: PixivNovelItem | null;
  emptyText: string;
  error: string | null;
  eyebrow: string;
  isLoading: boolean;
  loadingText: string;
  novels: PixivNovelItem[];
  onAuthorPress: (userId: number) => void;
  onExclude: (novel: PixivNovelItem) => void;
  onNovelPress: (novel: PixivNovelItem) => void;
  onRetry: () => void;
  palette: ReaderPalette;
  source: RecommendationSource;
  styles: ReturnType<typeof createStyles>;
  title: string;
}

function RecommendationSection({
  currentNovel,
  emptyText,
  error,
  eyebrow,
  isLoading,
  loadingText,
  novels,
  onAuthorPress,
  onExclude,
  onNovelPress,
  onRetry,
  palette,
  source,
  styles,
  title,
}: RecommendationSectionProps) {
  return (
    <View style={styles.relatedSection}>
      <View style={styles.relatedHeadingRow}>
        <View style={styles.relatedHeadingText}>
          <Text style={styles.relatedEyebrow}>{eyebrow}</Text>
          <Text style={styles.relatedTitle}>{title}</Text>
        </View>
        {!isLoading && novels.length > 0 ? (
          <Text style={styles.relatedCount}>{novels.length}作品</Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.relatedLoading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.relatedMuted}>{loadingText}</Text>
        </View>
      ) : error ? (
        <View style={styles.relatedErrorCard}>
          <Text style={styles.relatedErrorText} numberOfLines={3}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.relatedRetryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.relatedRetryText}>再読み込み</Text>
          </Pressable>
        </View>
      ) : novels.length === 0 ? (
        <Text style={styles.relatedMuted}>{emptyText}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.relatedList}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
        >
          {novels.map((novel) => (
            <Pressable
              accessibilityLabel={`${novel.title}を読む`}
              accessibilityRole="button"
              key={novel.id}
              onPress={() => {
                onNovelPress(novel);
              }}
              style={({ pressed }) => [
                styles.relatedCard,
                pressed && styles.relatedCardPressed,
              ]}
            >
              <Image
                contentFit="cover"
                source={{
                  uri:
                    novel.imageUrls.medium ||
                    novel.imageUrls.squareMedium,
                  headers: {
                    Referer: 'https://app-api.pixiv.net/',
                  },
                }}
                style={styles.relatedCover}
                transition={160}
              />
              <View style={styles.relatedCardBody}>
                <Text numberOfLines={2} style={styles.relatedCardTitle}>
                  {novel.title}
                </Text>
                <Pressable
                  accessibilityLabel={`作者「${novel.user.name}」のプロフィールを開く`}
                  accessibilityRole="link"
                  onPress={(event) => {
                    event.stopPropagation();
                    onAuthorPress(novel.user.id);
                  }}
                  style={({ pressed }) => [
                    styles.relatedAuthorButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.relatedAuthor}>
                    {novel.user.name}
                  </Text>
                  <Text style={styles.relatedAuthorArrow}>›</Text>
                </Pressable>
                <View style={styles.relatedMetaRow}>
                  <Text style={styles.relatedMeta}>
                    {novel.textLength.toLocaleString()}字
                  </Text>
                  <Text style={styles.relatedMeta}>
                    ♡ {novel.totalBookmarks.toLocaleString()}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.recommendationReason}>
                  {getRecommendationReason(currentNovel, novel, source)}
                </Text>
                <Pressable
                  accessibilityLabel={`${novel.title}をおすすめから外す`}
                  accessibilityRole="button"
                  onPress={(event) => {
                    event.stopPropagation();
                    onExclude(novel);
                  }}
                  style={({ pressed }) => [
                    styles.notInterestedButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.notInterestedText}>興味なし</Text>
                </Pressable>
                <View style={styles.relatedReadRow}>
                  <Text style={styles.relatedReadText}>読む</Text>
                  <Text style={styles.relatedArrow}>›</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface ToolbarBookmarkButtonProps {
  accessibilityLabel: string;
  bookmarked: boolean;
  disabled?: boolean;
  onPress: (event: GestureResponderEvent) => void;
  palette: ReaderPalette;
  size: number;
}

function ToolbarBookmarkButton({
  accessibilityLabel,
  bookmarked,
  disabled = false,
  onPress,
  palette,
  size,
}: ToolbarBookmarkButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled, selected: bookmarked }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      onPressIn={(event) => {
        event.stopPropagation();
      }}
      onStartShouldSetResponder={() => true}
      style={({ pressed }) => [
        toolbarStyles.button,
        pressed && toolbarStyles.pressed,
        disabled && toolbarStyles.disabled,
      ]}
    >
      <Svg
        accessibilityElementsHidden
        height={size}
        pointerEvents="none"
        viewBox="0 0 24 24"
        width={size}
      >
        <SvgPath
          d="M6 2.75h12A2.25 2.25 0 0 1 20.25 5v16.15a.85.85 0 0 1-1.2.78L12 18.82l-7.05 3.11a.85.85 0 0 1-1.2-.78V5A2.25 2.25 0 0 1 6 2.75Z"
          fill={bookmarked ? palette.accent : 'none'}
          stroke={bookmarked ? palette.accent : palette.text}
          strokeLinejoin="round"
          strokeWidth={bookmarked ? 0 : 1.9}
        />
      </Svg>
    </Pressable>
  );
}

interface ToolbarSymbolButtonProps {
  accessibilityLabel: string;
  androidName: 'arrow_back' | 'bookmark' | 'bookmark_border' | 'more_horiz';
  disabled?: boolean;
  iosName: 'chevron.left' | 'bookmark' | 'bookmark.fill' | 'ellipsis';
  onPress: () => void;
  palette: ReaderPalette;
  size: number;
}

function ToolbarSymbolButton({
  accessibilityLabel,
  androidName,
  disabled = false,
  iosName,
  onPress,
  palette,
  size,
}: ToolbarSymbolButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        toolbarStyles.button,
        pressed && toolbarStyles.pressed,
        disabled && toolbarStyles.disabled,
      ]}
    >
      <SymbolView
        fallback={<Text style={{ color: palette.text, fontSize: size }}>●</Text>}
        name={{ ios: iosName, android: androidName }}
        size={size}
        tintColor={palette.text}
      />
    </Pressable>
  );
}

interface NovelBlockViewProps {
  block: NovelBlock;
  embeddedImages: Record<string, string>;
  fontSize: number;
  lineHeight: number;
  palette: ReaderPalette;
  styles: ReturnType<typeof createStyles>;
}

function NovelBlockView({
  block,
  embeddedImages,
  fontSize,
  lineHeight,
  palette,
  styles,
}: NovelBlockViewProps) {
  switch (block.type) {
    case 'text':
      return (
        <Text
          selectable
          style={[
            styles.bodyText,
            {
              fontSize,
              lineHeight,
            },
          ]}
        >
          {block.text}
        </Text>
      );
    case 'chapter':
      return (
        <Text selectable style={styles.chapterTitle}>
          {block.title}
        </Text>
      );
    case 'pagebreak':
      return (
        <View accessibilityLabel="改ページ" style={styles.pageBreak}>
          <View style={styles.pageBreakLine} />
          <Text style={styles.pageBreakMark}>◆</Text>
          <View style={styles.pageBreakLine} />
        </View>
      );
    case 'image': {
      const uri = embeddedImages[block.id];

      if (!uri) {
        return (
          <View style={styles.imageFallback}>
            <Text style={styles.imageFallbackText}>挿絵 {block.id}</Text>
          </View>
        );
      }

      return (
        <Image
          contentFit="contain"
          source={
            uri.startsWith('file:')
              ? { uri }
              : {
                  uri,
                  headers: {
                    Referer: 'https://www.pixiv.net/',
                  },
                }
          }
          style={[styles.embeddedImage, { backgroundColor: palette.toolbar }]}
          transition={180}
        />
      );
    }
    case 'jump':
      return <Text style={styles.jumpText}>─ {block.label} ─</Text>;
  }
}

interface ReaderSettingsModalProps {
  onChange: (settings: ReaderSettings) => void;
  onClose: () => void;
  palette: ReaderPalette;
  settings: ReaderSettings;
  visible: boolean;
}

function ReaderSettingsModal({
  onChange,
  onClose,
  palette,
  settings,
  visible,
}: ReaderSettingsModalProps) {
  const styles = useMemo(() => createSheetStyles(palette), [palette]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>表示設定</Text>
            <Pressable
              accessibilityLabel="表示設定を閉じる"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.settingsContent}
            showsVerticalScrollIndicator={false}
            style={styles.settingsScroll}
          >
          <Text style={styles.sectionLabel}>テーマ</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((option) => {
              const optionPalette = READER_THEMES[option.value];
              const isActive = settings.theme === option.value;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  key={option.value}
                  onPress={() => {
                    onChange({ ...settings, theme: option.value });
                  }}
                  style={({ pressed }) => [
                    styles.themeOption,
                    {
                      backgroundColor: optionPalette.background,
                      borderColor: isActive
                        ? palette.accent
                        : optionPalette.border,
                    },
                    isActive && styles.themeOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.themeOptionText,
                      { color: optionPalette.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>組版</Text>
          <View style={styles.layoutOptions}>
            <RadioOption
              active={settings.layout === 'horizontal'}
              label="横書き"
              onPress={() => {
                onChange({ ...settings, layout: 'horizontal' });
              }}
              palette={palette}
            />
            <RadioOption
              active={settings.layout === 'vertical'}
              label="縦書き"
              onPress={() => {
                onChange({ ...settings, layout: 'vertical' });
              }}
              palette={palette}
            />
          </View>

          <View style={styles.optionColumns}>
            <View style={styles.optionColumn}>
              <Text style={styles.sectionLabel}>文字サイズ</Text>
              <RadioOption
                active={settings.fontSize === 'small'}
                label="小"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'small' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.fontSize === 'normal'}
                label="普通"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'normal' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.fontSize === 'large'}
                label="大"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'large' });
                }}
                palette={palette}
              />
            </View>

            <View style={styles.optionColumn}>
              <Text style={styles.sectionLabel}>行間</Text>
              <RadioOption
                active={settings.lineSpacing === 'narrow'}
                label="せまい"
                onPress={() => {
                  onChange({ ...settings, lineSpacing: 'narrow' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.lineSpacing === 'wide'}
                label="広い"
                onPress={() => {
                  onChange({ ...settings, lineSpacing: 'wide' });
                }}
                palette={palette}
              />
            </View>
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface RadioOptionProps {
  active: boolean;
  label: string;
  onPress: () => void;
  palette: ReaderPalette;
}

function RadioOption({ active, label, onPress, palette }: RadioOptionProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        radioStyles.row,
        pressed && radioStyles.pressed,
      ]}
    >
      <View
        style={[
          radioStyles.circle,
          { borderColor: active ? palette.accent : palette.muted },
        ]}
      >
        {active ? (
          <View
            style={[radioStyles.circleFill, { backgroundColor: palette.accent }]}
          />
        ) : null}
      </View>
      <Text style={[radioStyles.label, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

interface MoreActionsModalProps {
  canOrganize: boolean;
  hasSeries: boolean;
  isOfflineLoading: boolean;
  isOfflineSaved: boolean;
  offlineImageProgress: string | null;
  onClose: () => void;
  onOpenBookshelf: () => void;
  onOpenDetail: () => void;
  onOpenExclusions: () => void;
  onOpenMarks: () => void;
  onOpenNavigator: () => void;
  onOpenPixiv: () => void;
  onOpenSeries: () => void;
  onOpenSettings: () => void;
  onOpenSpeech: () => void;
  onReload: () => void;
  onReturn: () => void;
  onToggleOffline: () => void;
  palette: ReaderPalette;
  progress: number;
  visible: boolean;
}

function MoreActionsModal({
  canOrganize,
  hasSeries,
  isOfflineLoading,
  isOfflineSaved,
  offlineImageProgress,
  onClose,
  onOpenBookshelf,
  onOpenDetail,
  onOpenExclusions,
  onOpenMarks,
  onOpenNavigator,
  onOpenPixiv,
  onOpenSeries,
  onOpenSettings,
  onOpenSpeech,
  onReload,
  onReturn,
  onToggleOffline,
  palette,
  progress,
  visible,
}: MoreActionsModalProps) {
  const styles = useMemo(() => createSheetStyles(palette), [palette]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.actionSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.actionSheetHeader}>
            <Text style={styles.sheetTitle}>読書メニュー</Text>
            <Text style={styles.actionSheetProgress}>
              読書位置 {Math.round(progress * 100)}%
            </Text>
          </View>
          <ScrollView
            contentContainerStyle={styles.actionListContent}
            showsVerticalScrollIndicator={false}
            style={styles.actionList}
          >
            <SheetAction
            label="Aa  表示設定"
            onPress={onOpenSettings}
            palette={palette}
          />
          <SheetAction
            label="読み上げ"
            onPress={onOpenSpeech}
            palette={palette}
          />
          <SheetAction
            label="目次・本文内検索"
            onPress={onOpenNavigator}
            palette={palette}
          />
          {hasSeries ? (
            <SheetAction
              label="シリーズ一覧"
              onPress={onOpenSeries}
              palette={palette}
            />
          ) : null}
          <SheetAction
            label="作品詳細を開く"
            onPress={onOpenDetail}
            palette={palette}
          />
          <SheetAction
            disabled={!canOrganize}
            label="本棚に追加"
            onPress={onOpenBookshelf}
            palette={palette}
          />
          <SheetAction
            disabled={!canOrganize}
            label="しおり・メモ"
            onPress={onOpenMarks}
            palette={palette}
          />
          <SheetAction
            label="おすすめ除外を管理"
            onPress={onOpenExclusions}
            palette={palette}
          />
          <SheetAction
            disabled={isOfflineLoading}
            label={
              offlineImageProgress ??
              (isOfflineSaved
                ? 'オフライン保存を削除'
                : '本文と挿絵をオフライン保存')
            }
            onPress={onToggleOffline}
            palette={palette}
          />
          <SheetAction
            label="Pixivで作品を開く"
            onPress={onOpenPixiv}
            palette={palette}
          />
          <SheetAction
            label="本文を再読み込み"
            onPress={onReload}
            palette={palette}
          />
            <SheetAction
              label="読書画面を閉じる"
              onPress={onReturn}
              palette={palette}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({
  disabled = false,
  label,
  onPress,
  palette,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  palette: ReaderPalette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        actionStyles.button,
        { borderBottomColor: palette.border },
        pressed && actionStyles.pressed,
        disabled && actionStyles.disabled,
      ]}
    >
      <Text style={[actionStyles.text, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function isReaderTheme(value: unknown): value is ReaderThemeName {
  return (
    value === 'white' ||
    value === 'gray' ||
    value === 'black' ||
    value === 'blue' ||
    value === 'yellow'
  );
}

function isReaderFontSize(value: unknown): value is ReaderFontSize {
  return value === 'small' || value === 'normal' || value === 'large';
}

function isReaderLineSpacing(value: unknown): value is ReaderLineSpacing {
  return value === 'narrow' || value === 'wide';
}

function isReaderLayout(value: unknown): value is ReaderLayout {
  return value === 'horizontal' || value === 'vertical';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(palette: ReaderPalette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: palette.background,
    },
    toolbar: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      backgroundColor: palette.toolbar,
    },
    toolbarSide: {
      width: 104,
      flexDirection: 'row',
      alignItems: 'center',
    },
    toolbarSideRight: {
      justifyContent: 'flex-end',
    },
    toolbarTitleArea: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 6,
    },
    toolbarTitle: {
      width: '100%',
      flexShrink: 1,
      color: palette.text,
      fontSize: 14,
      fontWeight: '700',
      includeFontPadding: true,
      lineHeight: 21,
      textAlign: 'center',
    },
    progressTrack: {
      height: 2,
      backgroundColor: palette.border,
    },
    progressValue: {
      height: 2,
      backgroundColor: palette.accent,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 15,
      paddingHorizontal: 28,
      backgroundColor: palette.background,
    },
    loadingText: {
      alignSelf: 'stretch',
      color: palette.muted,
      fontSize: 13,
      includeFontPadding: true,
      lineHeight: 21,
      paddingHorizontal: 8,
      textAlign: 'center',
    },
    errorTitle: {
      color: palette.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    errorText: {
      color: palette.muted,
      fontSize: 13,
      lineHeight: 21,
      textAlign: 'center',
    },
    retryButton: {
      minWidth: 190,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      borderRadius: 24,
      backgroundColor: palette.accent,
    },
    retryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },
    readerContent: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 25,
      paddingTop: 34,
      paddingBottom: 178,
      backgroundColor: palette.background,
    },
    workHeader: {
      gap: 9,
      paddingBottom: 28,
    },
    seriesTitle: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: '700',
    },
    workTitle: {
      color: palette.text,
      fontSize: 25,
      fontWeight: '700',
      lineHeight: 35,
    },
    authorLink: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 2,
    },
    authorName: {
      color: palette.accent,
      fontSize: 14,
      fontWeight: '700',
    },
    authorLinkArrow: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: '900',
    },
    workMeta: {
      color: palette.muted,
      fontSize: 11,
    },
    titleDivider: {
      height: StyleSheet.hairlineWidth,
      marginBottom: 34,
      backgroundColor: palette.border,
    },
    novelBody: {
      gap: 28,
    },
    searchHitBlock: {
      marginHorizontal: -10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: `${palette.accent}18`,
    },
    bodyText: {
      color: palette.text,
      fontFamily: Platform.select({
        android: 'serif',
        ios: 'Hiragino Mincho ProN',
        default: undefined,
      }),
      letterSpacing: 0.25,
    },
    chapterTitle: {
      color: palette.text,
      fontSize: 21,
      fontWeight: '700',
      lineHeight: 31,
      paddingTop: 20,
      paddingBottom: 4,
    },
    pageBreak: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
    },
    pageBreakLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.border,
    },
    pageBreakMark: {
      color: palette.muted,
      fontSize: 8,
    },
    embeddedImage: {
      width: '100%',
      minHeight: 240,
      maxHeight: 560,
      borderRadius: 4,
    },
    imageFallback: {
      minHeight: 130,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 5,
      backgroundColor: palette.toolbar,
    },
    imageFallbackText: {
      color: palette.muted,
      fontSize: 12,
    },
    jumpText: {
      color: palette.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    readerEnd: {
      alignItems: 'center',
      gap: 7,
      paddingTop: 64,
    },
    readerEndMark: {
      color: palette.muted,
      fontSize: 10,
    },
    readerEndText: {
      color: palette.muted,
      fontSize: 12,
      letterSpacing: 3,
    },
    seriesSection: {
      gap: 16,
      marginTop: 52,
      paddingTop: 28,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    seriesHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 14,
    },
    seriesHeadingText: {
      flex: 1,
      gap: 3,
    },
    seriesSectionTitle: {
      color: palette.text,
      fontSize: 19,
      fontWeight: '800',
      lineHeight: 26,
    },
    seriesLoading: {
      minHeight: 80,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    nextEpisodeButton: {
      minHeight: 86,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 16,
      borderRadius: 16,
      backgroundColor: palette.accent,
    },
    nextEpisodeText: {
      flex: 1,
      gap: 5,
    },
    nextEpisodeLabel: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
    },
    nextEpisodeTitle: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '900',
      lineHeight: 23,
    },
    nextEpisodeArrow: {
      color: '#FFFFFF',
      fontSize: 32,
    },
    seriesCompleteCard: {
      gap: 7,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 16,
      backgroundColor: palette.toolbar,
    },
    seriesCompleteTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: '900',
    },
    seriesRetryButton: {
      alignSelf: 'flex-start',
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 15,
      borderRadius: 19,
      backgroundColor: palette.accent,
    },
    seriesRetryText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '900',
    },
    seriesActionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    seriesSubButton: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 12,
      backgroundColor: palette.toolbar,
    },
    seriesSubButtonDisabled: {
      opacity: 0.38,
    },
    seriesSubButtonText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: '800',
    },
    relatedSection: {
      gap: 18,
      marginTop: 62,
      paddingTop: 28,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    relatedHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 14,
    },
    relatedHeadingText: {
      gap: 3,
    },
    relatedEyebrow: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    relatedTitle: {
      color: palette.text,
      fontSize: 22,
      fontWeight: '800',
    },
    relatedCount: {
      color: palette.muted,
      fontSize: 11,
    },
    relatedLoading: {
      minHeight: 90,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    relatedMuted: {
      flexShrink: 1,
      color: palette.muted,
      fontSize: 12,
      includeFontPadding: true,
      lineHeight: 19,
    },
    relatedErrorCard: {
      gap: 12,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 14,
      backgroundColor: palette.toolbar,
    },
    relatedErrorText: {
      color: palette.muted,
      fontSize: 12,
      lineHeight: 19,
    },
    relatedRetryButton: {
      alignSelf: 'flex-start',
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 15,
      borderRadius: 18,
      backgroundColor: palette.accent,
    },
    relatedRetryText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    relatedList: {
      gap: 13,
      paddingRight: 4,
    },
    relatedCard: {
      width: 190,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 16,
      backgroundColor: palette.toolbar,
    },
    relatedCardPressed: {
      opacity: 0.72,
      transform: [{ scale: 0.985 }],
    },
    relatedCover: {
      width: '100%',
      height: 124,
      backgroundColor: palette.border,
    },
    relatedCardBody: {
      minHeight: 145,
      gap: 6,
      padding: 13,
    },
    relatedCardTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: '800',
      lineHeight: 20,
    },
    relatedAuthorButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: '100%',
      paddingVertical: 1,
    },
    relatedAuthor: {
      flexShrink: 1,
      color: palette.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    relatedAuthorArrow: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: '900',
    },
    relatedMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    relatedMeta: {
      color: palette.muted,
      fontSize: 10,
    },
    recommendationReason: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: '800',
    },
    notInterestedButton: {
      alignSelf: 'flex-start',
      minHeight: 28,
      justifyContent: 'center',
      paddingHorizontal: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 14,
    },
    notInterestedText: {
      color: palette.muted,
      fontSize: 9,
      fontWeight: '700',
    },
    relatedReadRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      gap: 5,
      paddingTop: 4,
    },
    relatedReadText: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: '800',
    },
    relatedArrow: {
      color: palette.accent,
      fontSize: 21,
      lineHeight: 20,
    },
    statusToast: {
      position: 'absolute',
      left: 18,
      right: 18,
      bottom: 24,
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 16,
      backgroundColor: palette.toolbar,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: palette.isDark ? 0.4 : 0.18,
      shadowRadius: 14,
      elevation: 7,
    },
    statusToastText: {
      width: '100%',
      color: palette.text,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: true,
      lineHeight: 19,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.62,
    },
  });
}

function createSheetStyles(palette: ReaderPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: palette.overlay,
    },
    sheet: {
      width: '100%',
      maxWidth: 620,
      maxHeight: '92%',
      alignSelf: 'center',
      gap: 16,
      paddingHorizontal: 22,
      paddingTop: 10,
      paddingBottom: 32,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderTopWidth: 3,
      borderTopColor: palette.accent,
      backgroundColor: palette.toolbar,
    },
    actionSheet: {
      width: '100%',
      maxWidth: 620,
      maxHeight: '92%',
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 28,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      backgroundColor: palette.toolbar,
    },
    sheetHandle: {
      width: 38,
      height: 4,
      alignSelf: 'center',
      borderRadius: 999,
      backgroundColor: palette.border,
    },
    sheetHeader: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
    },
    sheetTitle: {
      flex: 1,
      color: palette.text,
      fontSize: 20,
      fontWeight: '700',
    },
    actionSheetHeader: {
      gap: 4,
      paddingVertical: 8,
    },
    actionSheetProgress: {
      color: palette.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    settingsScroll: {
      flexShrink: 1,
    },
    settingsContent: {
      gap: 16,
      paddingBottom: 4,
    },
    actionList: {
      flexShrink: 1,
    },
    actionListContent: {
      paddingBottom: 4,
    },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButtonText: {
      color: palette.text,
      fontSize: 26,
      fontWeight: '300',
    },
    sectionLabel: {
      color: palette.text,
      fontSize: 15,
      fontWeight: '700',
    },
    themeRow: {
      flexDirection: 'row',
      gap: 10,
    },
    themeOption: {
      flex: 1,
      minHeight: 49,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderRadius: 10,
    },
    themeOptionActive: {
      borderWidth: 3,
    },
    themeOptionText: {
      fontSize: 18,
      fontWeight: '600',
    },
    layoutOptions: {
      flexDirection: 'row',
      gap: 24,
      paddingVertical: 2,
    },
    optionColumns: {
      flexDirection: 'row',
      gap: 24,
      paddingTop: 4,
    },
    optionColumn: {
      flex: 1,
      gap: 11,
    },
    pressed: {
      opacity: 0.62,
    },
  });
}

const toolbarStyles = StyleSheet.create({
  button: {
    minWidth: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  disabled: {
    opacity: 0.35,
  },
});

const radioStyles = StyleSheet.create({
  row: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  circle: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 11,
  },
  circleFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.62,
  },
  disabled: {
    opacity: 0.45,
  },
});

const actionStyles = StyleSheet.create({
  button: {
    minHeight: 53,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.62,
  },
  disabled: {
    opacity: 0.45,
  },
});
