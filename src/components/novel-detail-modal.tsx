import type { PixivNovelItem } from '@book000/pixivts';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixivNovelAjaxLoader } from '@/components/pixiv-novel-ajax-loader';

import {
  fetchNovelDetail,
  fetchNovelText,
  setNovelBookmark,
  type NovelReaderContent,
} from '@/lib/pixiv';
import { type AppColors, useAppTheme } from '@/theme';

interface NovelDetailModalProps {
  novel: PixivNovelItem;
  onClose: () => void;
  onNovelChanged: (novel: PixivNovelItem) => void;
  onRefreshToken: (refreshToken: string) => void | Promise<void>;
}

export function NovelDetailModal({
  novel,
  onClose,
  onNovelChanged,
  onRefreshToken,
}: NovelDetailModalProps) {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [detail, setDetail] = useState(novel);
  const [isDetailLoading, setIsDetailLoading] = useState(true);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  const [isAjaxLoading, setIsAjaxLoading] = useState(false);
  const [ajaxAttempt, setAjaxAttempt] = useState(0);
  const fallbackStartedRef = useRef(false);
  const [readerContent, setReaderContent] =
    useState<NovelReaderContent | null>(null);
  const [readerFontSize, setReaderFontSize] = useState(18);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDetail() {
      try {
        const nextDetail = await fetchNovelDetail(novel.id);

        if (isMounted) {
          setDetail(nextDetail);
          onNovelChanged(nextDetail);
        }
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
  }, [novel.id, onNovelChanged]);

  const caption = useMemo(() => stripHtml(detail.caption), [detail.caption]);
  const formattedReaderText = useMemo(
    () => (readerContent ? formatNovelText(readerContent.text) : ''),
    [readerContent],
  );

  async function toggleBookmark() {
    if (isBookmarkLoading) {
      return;
    }

    setIsBookmarkLoading(true);
    setErrorMessage(null);

    try {
      const shouldBookmark = !detail.isBookmarked;
      const refreshToken = await setNovelBookmark(detail.id, shouldBookmark);
      const changedNovel: PixivNovelItem = {
        ...detail,
        isBookmarked: shouldBookmark,
        totalBookmarks: Math.max(
          0,
          detail.totalBookmarks + (shouldBookmark ? 1 : -1),
        ),
      };

      setDetail(changedNovel);
      onNovelChanged(changedNovel);
      await onRefreshToken(refreshToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBookmarkLoading(false);
    }
  }

  function openReader() {
    setIsReaderOpen(true);

    if (readerContent || isTextLoading) {
      return;
    }

    fallbackStartedRef.current = false;
    setIsTextLoading(true);
    setIsAjaxLoading(true);
    setErrorMessage(null);
    setAjaxAttempt((current) => current + 1);
  }

  function handleAjaxSuccess(content: NovelReaderContent) {
    setReaderContent(content);
    setIsAjaxLoading(false);
    setIsTextLoading(false);
    setErrorMessage(null);
  }

  async function handleAjaxFailure(ajaxError: Error) {
    if (fallbackStartedRef.current) {
      return;
    }

    fallbackStartedRef.current = true;
    setIsAjaxLoading(false);

    try {
      // Web cookieが消えている端末ではApp APIのWebViewレスポンスへ退避する。
      const content = await fetchNovelText(detail.id);
      setReaderContent(content);
      setErrorMessage(null);
    } catch (fallbackError) {
      setErrorMessage(
        `${ajaxError.message}
${toErrorMessage(fallbackError)}`,
      );
    } finally {
      setIsTextLoading(false);
    }
  }

  function retryReader() {
    fallbackStartedRef.current = false;
    setReaderContent(null);
    setErrorMessage(null);
    setIsTextLoading(true);
    setIsAjaxLoading(true);
    setAjaxAttempt((current) => current + 1);
  }

  if (isReaderOpen) {
    return (
      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsReaderOpen(false);
        }}
        presentationStyle="fullScreen"
        visible
      >
        <SafeAreaView style={styles.readerSafeArea}>
          {isAjaxLoading && (
            <PixivNovelAjaxLoader
              key={`${detail.id}-${ajaxAttempt}`}
              novelId={detail.id}
              onFailure={(error) => {
                void handleAjaxFailure(error);
              }}
              onSuccess={handleAjaxSuccess}
            />
          )}
          <View style={styles.readerHeader}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setIsReaderOpen(false);
              }}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.headerButtonText}>‹ 詳細</Text>
            </Pressable>
            <View style={styles.readerTitleArea}>
              <Text numberOfLines={1} style={styles.readerTitle}>
                {readerContent?.title ?? detail.title}
              </Text>
              {readerContent?.seriesTitle ? (
                <Text numberOfLines={1} style={styles.readerSeriesTitle}>
                  {readerContent.seriesTitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.readerToolbar}>
            <Text style={styles.readerThemeLabel}>
              {isDark ? '🌙 ダーク' : '☀️ ライト'}
            </Text>
            <View style={styles.fontControls}>
              <Pressable
                accessibilityLabel="文字を小さくする"
                accessibilityRole="button"
                disabled={readerFontSize <= 14}
                onPress={() => {
                  setReaderFontSize((current) => Math.max(14, current - 1));
                }}
                style={({ pressed }) => [
                  styles.fontButton,
                  pressed && styles.pressed,
                  readerFontSize <= 14 && styles.disabled,
                ]}
              >
                <Text style={styles.fontButtonText}>A−</Text>
              </Pressable>
              <Text style={styles.fontSizeText}>{readerFontSize}</Text>
              <Pressable
                accessibilityLabel="文字を大きくする"
                accessibilityRole="button"
                disabled={readerFontSize >= 28}
                onPress={() => {
                  setReaderFontSize((current) => Math.min(28, current + 1));
                }}
                style={({ pressed }) => [
                  styles.fontButton,
                  pressed && styles.pressed,
                  readerFontSize >= 28 && styles.disabled,
                ]}
              >
                <Text style={styles.fontButtonText}>A＋</Text>
              </Pressable>
            </View>
          </View>

          {isTextLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>本文を読み込んでる…</Text>
            </View>
          ) : readerContent ? (
            <ScrollView
              contentContainerStyle={styles.readerContent}
              showsVerticalScrollIndicator={false}
            >
              <Text
                selectable
                style={[
                  styles.readerBody,
                  {
                    fontSize: readerFontSize,
                    lineHeight: Math.round(readerFontSize * 2.02),
                  },
                ]}
              >
                {formattedReaderText}
              </Text>
              <View style={styles.readerEnd}>
                <Text style={styles.readerEndMark}>◆</Text>
                <Text style={styles.readerEndText}>読了</Text>
              </View>
            </ScrollView>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>本文を表示できなかった</Text>
              <Text style={styles.errorText}>
                {errorMessage ?? '本文を読み込めなかったよ'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={retryReader}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.retryReaderButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>もう一度読み込む</Text>
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.headerButtonText}>閉じる</Text>
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

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={isBookmarkLoading}
              onPress={() => {
                void toggleBookmark();
              }}
              style={({ pressed }) => [
                styles.bookmarkButton,
                detail.isBookmarked && styles.bookmarkButtonActive,
                pressed && styles.pressed,
                isBookmarkLoading && styles.disabled,
              ]}
            >
              {isBookmarkLoading ? (
                <ActivityIndicator
                  color={detail.isBookmarked ? colors.onAccent : colors.accent}
                />
              ) : (
                <Text
                  style={[
                    styles.bookmarkButtonText,
                    detail.isBookmarked && styles.bookmarkButtonTextActive,
                  ]}
                >
                  {detail.isBookmarked
                    ? '★ ブックマーク済み'
                    : '☆ ブックマーク'}
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                openReader();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>本文を読む</Text>
            </Pressable>
          </View>

          {detail.tags.length > 0 && (
            <View style={styles.tagsRow}>
              {detail.tags.map((tag) => (
                <View key={tag.name} style={styles.tagChip}>
                  <Text style={styles.tagText}>#{tag.name}</Text>
                </View>
              ))}
            </View>
          )}

          {caption.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>あらすじ</Text>
              <Text style={styles.caption}>{caption}</Text>
            </View>
          )}

          {isDetailLoading && (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.loadingText}>最新情報を確認中…</Text>
            </View>
          )}

          {errorMessage && !isReaderOpen && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
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

/** Pixiv小説独自記法を、ネイティブTextでも読みやすい表記へ変換する。 */
export function formatNovelText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\[chapter:([^\]]+)]/g, '\n\n【$1】\n\n')
    .replace(/\[newpage]/g, '\n\n──────────\n\n')
    .replace(/\[pixivimage:([^\]]+)]/g, '\n\n［挿絵 $1］\n\n')
    .replace(/\[uploadedimage:([^\]]+)]/g, '\n\n［挿絵 $1］\n\n')
    .replace(/\[jump:([^\]]+)]/g, '\n\n［$1へ移動］\n\n')
    .replace(/\[\[rb:([^>\]]+?)\s*>\s*([^\]]+)]]/g, '$1（$2）')
    .replace(
      /\[\[jumpuri:([^>\]]+?)\s*>\s*([^\]]+)]]/g,
      '$1（$2）',
    )
    .replace(/\n{4,}/g, '\n\n\n')
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
    readerSafeArea: {
      flex: 1,
      backgroundColor: colors.readerBackground,
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
    readerHeader: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.readerBorder,
      backgroundColor: colors.readerBackground,
    },
    headerButton: {
      minWidth: 62,
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
    readerTitleArea: {
      flex: 1,
      alignItems: 'center',
      gap: 1,
    },
    readerTitle: {
      width: '100%',
      color: colors.readerText,
      fontSize: 14,
      fontWeight: '800',
      textAlign: 'center',
    },
    readerSeriesTitle: {
      width: '100%',
      color: colors.readerMuted,
      fontSize: 10,
      textAlign: 'center',
    },
    headerSpacer: {
      width: 62,
    },
    readerToolbar: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 17,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.readerBorder,
      backgroundColor: colors.surfaceRaised,
    },
    readerThemeLabel: {
      color: colors.readerMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    fontControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    fontButton: {
      minWidth: 42,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.readerBorder,
      borderRadius: 10,
      backgroundColor: colors.readerBackground,
    },
    fontButtonText: {
      color: colors.readerText,
      fontSize: 12,
      fontWeight: '800',
    },
    fontSizeText: {
      minWidth: 23,
      color: colors.readerMuted,
      fontSize: 11,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
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
    actionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    bookmarkButton: {
      flex: 1,
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
    primaryButton: {
      flex: 1,
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: colors.accent,
    },
    retryReaderButton: {
      flex: 0,
      minWidth: 190,
      marginTop: 5,
    },
    primaryButtonText: {
      color: colors.onAccent,
      fontSize: 14,
      fontWeight: '900',
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
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 15,
      paddingHorizontal: 28,
      backgroundColor: colors.readerBackground,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    errorCard: {
      padding: 15,
      borderRadius: 14,
      backgroundColor: colors.dangerSoft,
    },
    errorTitle: {
      color: colors.readerText,
      fontSize: 17,
      fontWeight: '900',
      textAlign: 'center',
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    readerContent: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 22,
      paddingTop: 28,
      paddingBottom: 120,
      backgroundColor: colors.readerBackground,
    },
    readerBody: {
      color: colors.readerText,
      fontFamily: undefined,
      letterSpacing: 0.25,
    },
    readerEnd: {
      alignItems: 'center',
      gap: 7,
      paddingTop: 54,
    },
    readerEndMark: {
      color: colors.readerMuted,
      fontSize: 12,
    },
    readerEndText: {
      color: colors.readerMuted,
      fontSize: 11,
      letterSpacing: 2,
    },
    pressed: {
      opacity: 0.72,
    },
    disabled: {
      opacity: 0.45,
    },
  });
}
