import type { PixivNovelItem } from '@book000/pixivts';
import type { NovelReadingStatus } from '@/lib/library-db';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface NovelSeriesModalProps {
  accent: string;
  background: string;
  border: string;
  currentNovelId: number;
  error: string | null;
  isLoading: boolean;
  isDownloading: boolean;
  downloadProgress: string | null;
  muted: string;
  novels: PixivNovelItem[];
  readingStatuses: Record<number, NovelReadingStatus>;
  onClose: () => void;
  onDownloadAll: () => void;
  onNovelPress: (novel: PixivNovelItem) => void;
  onOpenNextUnread: () => void;
  onRetry: () => void;
  overlay: string;
  seriesTitle: string;
  text: string;
  visible: boolean;
}

export function NovelSeriesModal({
  accent,
  background,
  border,
  currentNovelId,
  error,
  isLoading,
  isDownloading,
  downloadProgress,
  muted,
  novels,
  readingStatuses,
  onClose,
  onDownloadAll,
  onNovelPress,
  onOpenNextUnread,
  onRetry,
  overlay,
  seriesTitle,
  text,
  visible,
}: NovelSeriesModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const finishedCount = novels.filter(
    (novel) => readingStatuses[novel.id]?.isFinished,
  ).length;
  const nextUnread = novels.find(
    (novel) => !readingStatuses[novel.id]?.isFinished,
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>SERIES</Text>
              <Text numberOfLines={2} style={styles.title}>
                {seriesTitle}
              </Text>
              <Text style={styles.count}>
                {novels.length}話 ・ {finishedCount}話読了
              </Text>
            </View>
            <Pressable
              accessibilityLabel="シリーズ一覧を閉じる"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {nextUnread ? (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenNextUnread}
              style={({ pressed }) => [
                styles.nextUnreadButton,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.nextUnreadTextArea}>
                <Text style={styles.nextUnreadLabel}>次の未読話</Text>
                <Text numberOfLines={1} style={styles.nextUnreadTitle}>
                  {nextUnread.title}
                </Text>
              </View>
              <Text style={styles.nextUnreadArrow}>›</Text>
            </Pressable>
          ) : novels.length > 0 ? (
            <View style={styles.seriesComplete}>
              <Text style={styles.seriesCompleteText}>シリーズを全話読了済み</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isLoading || isDownloading || novels.length === 0}
            onPress={onDownloadAll}
            style={({ pressed }) => [
              styles.downloadButton,
              (isLoading || isDownloading || novels.length === 0) &&
                styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {isDownloading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : null}
            <View style={styles.downloadTextArea}>
              <Text style={styles.downloadTitle}>
                {isDownloading
                  ? `シリーズを保存中 ${downloadProgress ?? ''}`.trim()
                  : 'シリーズを一括オフライン保存'}
              </Text>
              <Text style={styles.downloadSubtitle}>
                本文と挿絵を全話分保存します
              </Text>
            </View>
          </Pressable>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={accent} size="large" />
              <Text style={styles.muted}>シリーズを読み込み中…</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={styles.error}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryText}>もう一度読み込む</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            >
              {novels.map((novel, index) => {
                const isCurrent = novel.id === currentNovelId;
                const readingStatus = readingStatuses[novel.id];
                const statusLabel = readingStatus?.isFinished
                  ? '読了'
                  : readingStatus && readingStatus.progress > 0
                    ? `${Math.max(1, Math.round(readingStatus.progress * 100))}%`
                    : '未読';

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent }}
                    disabled={isCurrent}
                    key={novel.id}
                    onPress={() => onNovelPress(novel)}
                    style={({ pressed }) => [
                      styles.row,
                      isCurrent && styles.rowCurrent,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.orderBadge}>
                      <Text style={styles.orderText}>{index + 1}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text numberOfLines={2} style={styles.rowTitle}>
                        {novel.title}
                      </Text>
                      <View style={styles.rowMetaLine}>
                        <Text style={styles.meta}>
                          {novel.textLength.toLocaleString()}字
                          {isCurrent ? '　現在読んでいる話' : ''}
                        </Text>
                        <View style={styles.statusRow}>
                          <View
                            style={[
                              styles.statusBadge,
                              readingStatus?.isFinished && styles.statusBadgeFinished,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusText,
                                readingStatus?.isFinished && styles.statusTextFinished,
                              ]}
                            >
                              {statusLabel}
                            </Text>
                          </View>
                          {readingStatus?.isOffline ? (
                            <View style={styles.offlineStatusBadge}>
                              <Text style={styles.offlineStatusText}>保存済み</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {readingStatus && !readingStatus.isFinished && readingStatus.progress > 0 ? (
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressValue,
                              { width: `${Math.round(readingStatus.progress * 100)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.arrow}>{isCurrent ? '●' : '›'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: {
  accent: string;
  background: string;
  border: string;
  muted: string;
  overlay: string;
  text: string;
}) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      width: '100%',
      maxWidth: 680,
      maxHeight: '86%',
      alignSelf: 'center',
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 26,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      backgroundColor: colors.background,
    },
    handle: {
      width: 40,
      height: 4,
      alignSelf: 'center',
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    header: {
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerText: {
      flex: 1,
      gap: 3,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.5,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 25,
    },
    count: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: '700',
    },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: colors.border,
    },
    closeText: {
      color: colors.text,
      fontSize: 22,
      lineHeight: 25,
    },
    nextUnreadButton: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      paddingHorizontal: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      borderRadius: 14,
      backgroundColor: `${colors.accent}12`,
    },
    nextUnreadTextArea: { flex: 1, gap: 2 },
    nextUnreadLabel: { color: colors.accent, fontSize: 10, fontWeight: '900' },
    nextUnreadTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
    nextUnreadArrow: { color: colors.accent, fontSize: 24, fontWeight: '900' },
    seriesComplete: {
      alignItems: 'center',
      marginTop: 12,
      paddingVertical: 13,
      borderRadius: 13,
      backgroundColor: `${colors.accent}12`,
    },
    seriesCompleteText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
    downloadButton: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginVertical: 12,
      paddingHorizontal: 15,
      borderRadius: 14,
      backgroundColor: colors.accent,
    },
    downloadTextArea: { flex: 1, gap: 2 },
    downloadTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
    downloadSubtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 10 },
    disabled: { opacity: 0.45 },
    centered: {
      minHeight: 240,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      paddingHorizontal: 24,
    },
    muted: {
      flexShrink: 1,
      color: colors.muted,
      fontSize: 12,
      includeFontPadding: true,
      lineHeight: 19,
    },
    error: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    retryButton: {
      minHeight: 42,
      justifyContent: 'center',
      paddingHorizontal: 18,
      borderRadius: 21,
      backgroundColor: colors.accent,
    },
    retryText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '900',
    },
    list: {
      paddingBottom: 20,
    },
    row: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowCurrent: {
      backgroundColor: `${colors.accent}16`,
    },
    orderBadge: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    orderText: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: '900',
    },
    rowBody: {
      flex: 1,
      gap: 5,
    },
    rowMetaLine: { gap: 5 },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    statusBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    statusBadgeFinished: { backgroundColor: `${colors.accent}18` },
    statusText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
    statusTextFinished: { color: colors.accent },
    offlineStatusBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    offlineStatusText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
    progressTrack: {
      height: 3,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    progressValue: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
    rowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '800',
      lineHeight: 20,
    },
    meta: {
      color: colors.muted,
      fontSize: 10,
    },
    arrow: {
      color: colors.accent,
      fontSize: 20,
    },
    pressed: {
      opacity: 0.65,
    },
  });
}
