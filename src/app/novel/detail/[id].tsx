import type { PixivNovelItem } from '@book000/pixivts';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  parseBookmarkRouteParam,
  resolveBookmarkState,
  type BookmarkState,
  type BookmarkStateSource,
} from '@/lib/bookmark-state';
import {
  buildReaderRouteParams,
} from '@/lib/reader-flow';
import { getReadingHistory, type LibraryNovel } from '@/lib/library-db';
import {
  emitNovelChanged,
  subscribeNovelChanged,
} from '@/lib/novel-events';
import {
  cacheNovelForRoute,
  getCachedNovelForRoute,
} from '@/lib/novel-route-cache';
import { fetchNovelDetail, setNovelBookmark } from '@/lib/pixiv';
import { type AppColors, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

export default function NovelDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    bookmarked?: string | string[];
    id?: string | string[];
  }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const novelId = Number(rawId);
  const isValidNovelId = Number.isInteger(novelId) && novelId > 0;
  const routeBookmarkState = parseBookmarkRouteParam(params.bookmarked);
  const initialNovel = isValidNovelId
    ? getCachedNovelForRoute(novelId)
    : null;
  const initialBookmarkState =
    routeBookmarkState ?? initialNovel?.isBookmarked ?? null;

  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [detail, setDetail] = useState<PixivNovelItem | null>(initialNovel);
  const [isDetailLoading, setIsDetailLoading] = useState(isValidNovelId);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [isOpeningReader, setIsOpeningReader] = useState(false);
  const [readingHistory, setReadingHistory] = useState<LibraryNovel | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isValidNovelId ? null : '作品IDを読み取れなかったよ',
  );
  const [bookmarkState, setBookmarkState] = useState<BookmarkState>({
    value: initialBookmarkState,
    source:
      routeBookmarkState !== null
        ? 'route'
        : initialNovel
          ? 'offline'
          : null,
  });
  const readerTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const bookmarkStateRef = useRef<BookmarkState>({
    value: initialBookmarkState,
    source:
      routeBookmarkState !== null
        ? 'route'
        : initialNovel
          ? 'offline'
          : null,
  });

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

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId) {
      return () => {
        isMounted = false;
      };
    }

    async function loadDetail() {
      setIsDetailLoading(true);
      setErrorMessage(null);

      try {
        const nextDetail = await fetchNovelDetail(novelId);

        if (!isMounted) {
          return;
        }

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
        cacheNovelForRoute(resolvedDetail);
        emitNovelChanged(resolvedDetail);
      } catch (error) {
        if (isMounted) {
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
  }, [applyBookmarkState, isValidNovelId, novelId, reloadKey]);

  const caption = useMemo(
    () => (detail ? stripHtml(detail.caption) : ''),
    [detail],
  );
  const canResume = Boolean(
    readingHistory &&
      !readingHistory.isFinished &&
      (readingHistory.progress >= 0.01 || readingHistory.scrollOffset > 0),
  );
  const progressPercent = readingHistory
    ? Math.min(100, Math.max(0, Math.round(readingHistory.progress * 100)))
    : 0;

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      if (!isValidNovelId) {
        return () => {
          isActive = false;
        };
      }

      void getReadingHistory(novelId)
        .then((history) => {
          if (isActive) {
            setReadingHistory(history);
          }
        })
        .catch(() => {
          // 履歴が壊れていても、作品詳細と読書自体は利用できるようにする。
        });

      return () => {
        isActive = false;
      };
    }, [isValidNovelId, novelId]),
  );

  useEffect(() => {
    return subscribeNovelChanged((changedNovel) => {
      if (changedNovel.id !== novelId) {
        return;
      }

      applyBookmarkState(changedNovel.isBookmarked, 'user');
      setDetail(changedNovel);
    });
  }, [applyBookmarkState, novelId]);

  useEffect(() => {
    return () => {
      if (readerTransitionTimerRef.current) {
        clearTimeout(readerTransitionTimerRef.current);
      }
    };
  }, []);

  async function toggleBookmark() {
    if (!detail || bookmarkState.value === null || isBookmarkLoading) {
      return;
    }

    const previousDetail = detail;
    const previousBookmarkState = bookmarkState.value;
    const shouldBookmark = !bookmarkState.value;
    const changedNovel: PixivNovelItem = {
      ...detail,
      isBookmarked: shouldBookmark,
      totalBookmarks: Math.max(
        0,
        detail.totalBookmarks + (shouldBookmark ? 1 : -1),
      ),
    };

    setIsBookmarkLoading(true);
    setErrorMessage(null);
    applyBookmarkState(shouldBookmark, 'user');
    setDetail(changedNovel);
    cacheNovelForRoute(changedNovel);
    emitNovelChanged(changedNovel);

    try {
      const refreshToken = await setNovelBookmark(detail.id, shouldBookmark);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    } catch (error) {
      applyBookmarkState(previousBookmarkState, 'user');
      setDetail(previousDetail);
      cacheNovelForRoute(previousDetail);
      emitNovelChanged(previousDetail);
      setErrorMessage(`ブックマークを変更できなかった: ${toErrorMessage(error)}`);
    } finally {
      setIsBookmarkLoading(false);
    }
  }

  function openReader(resume: boolean) {
    if (!detail || isOpeningReader) {
      return;
    }

    cacheNovelForRoute({
      ...detail,
      isBookmarked: bookmarkState.value ?? detail.isBookmarked,
    });
    setIsOpeningReader(true);

    // 詳細Routeはスタックへ残す。
    // 最初の1フレームだけ不透明カバーを先に描画し、詳細のチラ見えを防ぐ。
    requestAnimationFrame(() => {
      router.push({
        pathname: '/novel/[id]',
        params: buildReaderRouteParams(detail.id, {
          bookmarked: bookmarkState.value,
          resume,
        }),
      });

      if (readerTransitionTimerRef.current) {
        clearTimeout(readerTransitionTimerRef.current);
      }

      // 読書画面の裏で解除するので、戻った時にカバーは残らない。
      readerTransitionTimerRef.current = setTimeout(() => {
        setIsOpeningReader(false);
        readerTransitionTimerRef.current = null;
      }, 700);
    });
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.back();
            }}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.headerButtonText}>‹ 戻る</Text>
          </Pressable>
          <Text style={styles.headerTitle}>作品詳細</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.centered}>
          {isDetailLoading ? (
            <>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>作品情報を読み込んでる…</Text>
            </>
          ) : (
            <>
              <Text style={styles.errorTitle}>作品を開けなかった</Text>
              <Text style={styles.errorText}>
                {errorMessage ?? '作品情報を取得できなかったよ'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setReloadKey((current) => current + 1);
                }}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryButtonText}>もう一度読み込む</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.back();
          }}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headerButtonText}>‹ 戻る</Text>
        </Pressable>
        <Text style={styles.headerTitle}>作品詳細</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Image
          contentFit="cover"
          source={{
            uri: detail.imageUrls.large || detail.imageUrls.medium,
            headers: {
              Referer: 'https://app-api.pixiv.net/',
            },
          }}
          style={styles.heroImage}
          transition={200}
        />

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{detail.title}</Text>
          <Text style={styles.author}>{detail.user.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {detail.textLength.toLocaleString()}字
            </Text>
            <Text style={styles.meta}>
              ♡ {detail.totalBookmarks.toLocaleString()}
            </Text>
            <Text style={styles.meta}>
              👁 {detail.totalView.toLocaleString()}
            </Text>
            <Text style={styles.meta}>
              {new Date(detail.createDate).toLocaleDateString('ja-JP')}
            </Text>
          </View>
        </View>

        <View style={styles.readActions}>
          <Pressable
            accessibilityLabel={
              canResume
                ? `続きから読む、現在${progressPercent}パーセント`
                : readingHistory?.isFinished
                  ? 'もう一度最初から読む'
                  : '最初から読む'
            }
            accessibilityRole="button"
            disabled={isOpeningReader}
            onPress={() => {
              openReader(canResume);
            }}
            style={({ pressed }) => [
              styles.readButton,
              pressed && styles.pressed,
              isOpeningReader && styles.disabled,
            ]}
          >
            <Text style={styles.readButtonText}>
              {canResume
                ? `続きから読む  ${progressPercent}%`
                : readingHistory?.isFinished
                  ? 'もう一度読む'
                  : '最初から読む'}
            </Text>
          </Pressable>

          {canResume ? (
            <>
              <View style={styles.readProgressTrack}>
                <View
                  style={[
                    styles.readProgressValue,
                    { width: `${progressPercent}%` },
                  ]}
                />
              </View>
              <Text style={styles.readProgressText}>前回はここまで読んだよ</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isOpeningReader}
                onPress={() => {
                  openReader(false);
                }}
                style={({ pressed }) => [
                  styles.restartButton,
                  pressed && styles.pressed,
                  isOpeningReader && styles.disabled,
                ]}
              >
                <Text style={styles.restartButtonText}>最初から読む</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isBookmarkLoading || bookmarkState.value === null}
          onPress={() => {
            void toggleBookmark();
          }}
          style={({ pressed }) => [
            styles.bookmarkButton,
            bookmarkState.value && styles.bookmarkButtonActive,
            pressed && styles.pressed,
            isBookmarkLoading && styles.disabled,
          ]}
        >
          {isBookmarkLoading ? (
            <ActivityIndicator
              color={bookmarkState.value ? colors.onAccent : colors.accent}
            />
          ) : (
            <Text
              style={[
                styles.bookmarkButtonText,
                bookmarkState.value && styles.bookmarkButtonTextActive,
              ]}
            >
              {bookmarkState.value
                ? '★ ブックマーク済み'
                : '☆ ブックマーク'}
            </Text>
          )}
        </Pressable>

        {detail.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {detail.tags.map((tag) => (
              <View key={tag.name} style={styles.tagChip}>
                <Text style={styles.tagText}>#{tag.name}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {caption.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>あらすじ</Text>
            <Text style={styles.caption}>{caption}</Text>
          </View>
        ) : null}

        {isDetailLoading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>最新情報を確認中…</Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>

      {isOpeningReader ? (
        <View
          accessibilityLabel="読書画面を開いています"
          accessibilityViewIsModal
          style={styles.readerTransition}
        >
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.readerTransitionText}>本文を開いてる…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    readerTransition: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 100,
      elevation: 24,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: colors.background,
    },
    readerTransitionText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    header: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    headerButton: {
      minWidth: 72,
      paddingVertical: 9,
    },
    headerButtonText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '800',
    },
    headerTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
      textAlign: 'center',
    },
    headerSpacer: {
      width: 72,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      paddingHorizontal: 28,
    },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      padding: 20,
      paddingBottom: 80,
      gap: 18,
    },
    heroImage: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 22,
      backgroundColor: colors.surfaceAlt,
    },
    titleBlock: {
      gap: 7,
    },
    title: {
      color: colors.text,
      fontSize: 25,
      fontWeight: '900',
      lineHeight: 34,
    },
    author: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: '700',
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    meta: {
      color: colors.textMuted,
      fontSize: 12,
    },
    readActions: {
      gap: 9,
    },
    readProgressTrack: {
      height: 4,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    readProgressValue: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    readProgressText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textAlign: 'center',
    },
    restartButton: {
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    restartButtonText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '900',
    },
    readButton: {
      minHeight: 54,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      borderRadius: 14,
      backgroundColor: colors.accent,
    },
    readButtonText: {
      color: colors.onAccent,
      fontSize: 15,
      fontWeight: '900',
    },
    bookmarkButton: {
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
    },
    bookmarkButtonActive: {
      borderColor: colors.bookmark,
      backgroundColor: colors.bookmark,
    },
    bookmarkButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
    bookmarkButtonTextActive: {
      color: colors.onAccent,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    tagChip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
    },
    tagText: {
      color: colors.accentStrong,
      fontSize: 12,
      fontWeight: '700',
    },
    section: {
      gap: 9,
      padding: 17,
      borderRadius: 18,
      backgroundColor: colors.surface,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '900',
    },
    caption: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 23,
    },
    inlineLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    errorTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      textAlign: 'center',
    },
    errorCard: {
      padding: 15,
      borderRadius: 14,
      backgroundColor: colors.dangerSoft,
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    retryButton: {
      minWidth: 190,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 24,
      backgroundColor: colors.accent,
    },
    retryButtonText: {
      color: colors.onAccent,
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
