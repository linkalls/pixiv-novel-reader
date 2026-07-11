import type { PixivNovelItem } from '@book000/pixivts';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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

import {
  fetchNovelDetail,
  setNovelBookmark,
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
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [detail, setDetail] = useState(novel);
  const [isDetailLoading, setIsDetailLoading] = useState(true);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
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

  function openReaderFromBeginning() {
    const novelId = String(detail.id);
    onClose();

    requestAnimationFrame(() => {
      router.push({
        pathname: '/novel/[id]',
        params: { id: novelId },
      });
    });
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

          <Pressable
            accessibilityRole="button"
            onPress={openReaderFromBeginning}
            style={({ pressed }) => [
              styles.readButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.readButtonText}>最初から読む</Text>
          </Pressable>

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

          {errorMessage && (
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
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
    headerSpacer: {
      width: 62,
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
    pressed: {
      opacity: 0.72,
    },
    disabled: {
      opacity: 0.52,
    },
  });
}
