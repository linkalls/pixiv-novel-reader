import type { PixivNovelItem } from '@book000/pixivts';
import { Image } from 'expo-image';
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
import { WebView } from 'react-native-webview';

import {
  fetchNovelDetail,
  fetchNovelText,
  setNovelBookmark,
} from '@/lib/pixiv';

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
  const [detail, setDetail] = useState(novel);
  const [isDetailLoading, setIsDetailLoading] = useState(true);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  const [readerHtml, setReaderHtml] = useState<string | null>(null);
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

  async function openReader() {
    setIsReaderOpen(true);

    if (readerHtml || isTextLoading) {
      return;
    }

    setIsTextLoading(true);
    setErrorMessage(null);

    try {
      const html = await fetchNovelText(detail.id);
      setReaderHtml(prepareReaderHtml(html));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsTextLoading(false);
    }
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
            <Text numberOfLines={1} style={styles.readerTitle}>
              {detail.title}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          {isTextLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color="#0096FA" size="large" />
              <Text style={styles.loadingText}>本文を読み込んでる…</Text>
            </View>
          ) : readerHtml ? (
            <WebView
              javaScriptEnabled={false}
              originWhitelist={['https://*', 'http://*', 'about:*', 'data:*']}
              setSupportMultipleWindows={false}
              source={{
                html: readerHtml,
                baseUrl: 'https://www.pixiv.net/',
              }}
              style={styles.webView}
              textZoom={100}
            />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.errorText}>
                {errorMessage ?? '本文を読み込めなかったよ'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void openReader();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
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
              <Text style={styles.meta}>{detail.textLength.toLocaleString()}字</Text>
              <Text style={styles.meta}>♡ {detail.totalBookmarks.toLocaleString()}</Text>
              <Text style={styles.meta}>👁 {detail.totalView.toLocaleString()}</Text>
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
                  color={detail.isBookmarked ? '#FFFFFF' : '#008EEB'}
                />
              ) : (
                <Text
                  style={[
                    styles.bookmarkButtonText,
                    detail.isBookmarked && styles.bookmarkButtonTextActive,
                  ]}
                >
                  {detail.isBookmarked ? '★ ブックマーク済み' : '☆ ブックマーク'}
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void openReader();
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
              <ActivityIndicator color="#0096FA" />
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

function prepareReaderHtml(html: string): string {
  const readerStyle = `
    <style>
      :root { color-scheme: light; }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fffdf8 !important;
        color: #24282d !important;
      }
      body {
        box-sizing: border-box !important;
        max-width: 780px !important;
        margin: 0 auto !important;
        padding: 28px 22px 120px !important;
        font-family: "Noto Serif JP", "Yu Mincho", serif !important;
        font-size: 18px !important;
        line-height: 2.05 !important;
        overflow-wrap: anywhere !important;
      }
      img { max-width: 100% !important; height: auto !important; }
      a { color: #007fc9 !important; }
      header, nav, footer, .header, .footer { display: none !important; }
    </style>
  `;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${readerStyle}</head>`);
  }

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${readerStyle}</head><body>${html}</body></html>`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7FA',
  },
  readerSafeArea: {
    flex: 1,
    backgroundColor: '#FFFDF8',
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D8E0E7',
    backgroundColor: '#FFFFFF',
  },
  readerHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6E0D5',
    backgroundColor: '#FFFDF8',
  },
  headerButton: {
    minWidth: 62,
    paddingVertical: 9,
  },
  headerButtonText: {
    color: '#008EEB',
    fontSize: 15,
    fontWeight: '800',
  },
  headerTitle: {
    flex: 1,
    color: '#20262E',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  readerTitle: {
    flex: 1,
    color: '#33302B',
    fontSize: 14,
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
    backgroundColor: '#E6EDF3',
  },
  titleBlock: {
    gap: 7,
  },
  title: {
    color: '#20262E',
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 34,
  },
  author: {
    color: '#56626E',
    fontSize: 15,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  meta: {
    color: '#7B8792',
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
    borderColor: '#8CCFF8',
    borderRadius: 14,
    backgroundColor: '#F1FAFF',
  },
  bookmarkButtonActive: {
    borderColor: '#FFB000',
    backgroundColor: '#FFB000',
  },
  bookmarkButtonText: {
    color: '#008EEB',
    fontSize: 13,
    fontWeight: '900',
  },
  bookmarkButtonTextActive: {
    color: '#FFFFFF',
  },
  primaryButton: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#0096FA',
  },
  primaryButtonText: {
    color: '#FFFFFF',
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
    backgroundColor: '#E8F6FF',
  },
  tagText: {
    color: '#007FC9',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 9,
    padding: 17,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  sectionTitle: {
    color: '#303842',
    fontSize: 16,
    fontWeight: '900',
  },
  caption: {
    color: '#4D5964',
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
  },
  loadingText: {
    color: '#65717C',
    fontSize: 13,
  },
  errorCard: {
    padding: 15,
    borderRadius: 14,
    backgroundColor: '#FFF0F2',
  },
  errorText: {
    color: '#C73848',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  webView: {
    flex: 1,
    backgroundColor: '#FFFDF8',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.55,
  },
});
