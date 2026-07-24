import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchNovelComments,
  type NovelComment,
} from '@/lib/pixiv';

interface PixivNovelInteractionModalProps {
  accent: string;
  background: string;
  border: string;
  muted: string;
  novelId: number;
  onClose: () => void;
  onUserPress: (userId: number) => void;
  text: string;
  visible: boolean;
}

export function PixivNovelInteractionModal({
  accent,
  background,
  border,
  muted,
  novelId,
  onClose,
  onUserPress,
  text,
  visible,
}: PixivNovelInteractionModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, text }),
    [accent, background, border, muted, text],
  );
  const [comments, setComments] = useState<NovelComment[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalComments, setTotalComments] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchNovelComments(novelId);
      setComments(mergeComments([], page.comments));
      setNextUrl(page.nextUrl);
      setTotalComments(page.totalComments);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  const loadNextPage = useCallback(async () => {
    if (!nextUrl || isLoading || isLoadingMore) return;
    setIsLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchNovelComments(novelId, nextUrl);
      setComments((current) => mergeComments(current, page.comments));
      setNextUrl(page.nextUrl);
      setTotalComments((current) => page.totalComments ?? current);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoading, isLoadingMore, nextUrl, novelId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = setTimeout(() => {
      void loadFirstPage();
    }, 0);

    return () => clearTimeout(timer);
  }, [loadFirstPage, visible]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Text style={styles.headerButtonText}>閉じる</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>コメント</Text>
            <Text style={styles.subtitle}>{totalComments === null ? 'Pixiv' : `${totalComments.toLocaleString()}件`}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={isLoading} onPress={() => void loadFirstPage()} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Text style={styles.reloadText}>再読込</Text>
          </Pressable>
        </View>

        {isLoading && comments.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={accent} size="large" />
            <Text style={styles.statusText}>コメントを読み込み中…</Text>
          </View>
        ) : errorMessage && comments.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.errorTitle}>コメントを取得できませんでした</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable onPress={() => void loadFirstPage()} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryButtonText}>もう一度試す</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={comments}
            keyExtractor={(item) => String(item.id)}
            ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyTitle}>まだコメントはありません</Text><Text style={styles.emptyText}>静かな作品だ。まだ誰もしゃべってない。</Text></View>}
            ListFooterComponent={isLoadingMore ? <View style={styles.footer}><ActivityIndicator color={accent} /><Text style={styles.statusText}>続きを読み込み中…</Text></View> : errorMessage ? <Pressable onPress={() => void loadNextPage()} style={styles.footerError}><Text style={styles.errorText}>{errorMessage}</Text><Text style={styles.retryInlineText}>タップして再試行</Text></Pressable> : null}
            onEndReached={() => void loadNextPage()}
            onEndReachedThreshold={0.35}
            renderItem={({ item }) => <CommentCard comment={item} onUserPress={onUserPress} styles={styles} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function CommentCard({
  comment,
  onUserPress,
  styles,
}: {
  comment: NovelComment;
  onUserPress: (userId: number) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const parent = isNovelComment(comment.parentComment)
    ? comment.parentComment
    : null;

  return (
    <View style={styles.commentCard}>
      <Pressable
        accessibilityLabel={`${comment.user.name}のプロフィールを開く`}
        accessibilityRole="link"
        onPress={() => onUserPress(comment.user.id)}
        style={({ pressed }) => [styles.userRow, pressed && styles.pressed]}
      >
        <Image
          contentFit="cover"
          source={{
            uri: comment.user.profileImageUrls.medium,
            headers: { Referer: 'https://app-api.pixiv.net/' },
          }}
          style={styles.avatar}
          transition={120}
        />
        <View style={styles.userText}>
          <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.userName}>
            {comment.user.name}
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.dateText}>
            {formatCommentDate(comment.date)}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.userArrow}>›</Text>
      </Pressable>

      {parent ? (
        <View style={styles.replyContext}>
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.replyLabel}>
            ↳ {parent.user.name}への返信
          </Text>
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.replyExcerpt}>
            {normalizeCommentExcerpt(parent.comment)}
          </Text>
        </View>
      ) : null}

      <Text maxFontSizeMultiplier={1.35} selectable style={styles.commentText}>
        {comment.comment}
      </Text>
    </View>
  );
}

function normalizeCommentExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isNovelComment(value: NovelComment['parentComment']): value is NovelComment {
  return Boolean(value && 'id' in value && typeof value.id === 'number');
}

function mergeComments(current: NovelComment[], incoming: NovelComment[]): NovelComment[] {
  const seen = new Set(current.map((comment) => comment.id));
  return current.concat(incoming.filter((comment) => !seen.has(comment.id)));
}

function formatCommentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: { accent: string; background: string; border: string; muted: string; text: string }) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.background },
    headerButton: { minWidth: 64, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
    headerButtonText: { color: colors.text, fontSize: 12, fontWeight: '900' },
    reloadText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
    headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
    title: { color: colors.text, fontSize: 15, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 10, fontWeight: '700' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
    statusText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
    errorTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
    errorText: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
    retryButton: { minWidth: 170, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accent },
    retryButtonText: { color: colors.background, fontSize: 13, fontWeight: '900' },
    listContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 48, gap: 8 },
    commentCard: { gap: 11, paddingHorizontal: 13, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.background },
    userRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
    userText: { flex: 1, minWidth: 0, gap: 1 },
    userName: { color: colors.text, fontSize: 13, fontWeight: '800' },
    dateText: { color: colors.muted, fontSize: 10, fontWeight: '600' },
    userArrow: { color: colors.muted, fontSize: 20, fontWeight: '700', paddingHorizontal: 2 },
    replyContext: { gap: 2, marginLeft: 46, paddingLeft: 9, borderLeftWidth: 2, borderLeftColor: colors.border },
    replyLabel: { color: colors.accent, fontSize: 10, fontWeight: '800' },
    replyExcerpt: { color: colors.muted, fontSize: 10, lineHeight: 15 },
    commentText: { color: colors.text, fontSize: 14, lineHeight: 21, paddingLeft: 46 },
    emptyState: { alignItems: 'center', gap: 7, paddingVertical: 70 },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
    emptyText: { color: colors.muted, fontSize: 12 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 18 },
    footerError: { gap: 5, padding: 14 },
    retryInlineText: { color: colors.accent, fontSize: 11, fontWeight: '900', textAlign: 'center' },
    pressed: { opacity: 0.65 },
  });
}
