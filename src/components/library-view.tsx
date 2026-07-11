import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  clearReadingHistory,
  deleteOfflineNovel,
  listOfflineNovels,
  listReadingHistory,
  type LibraryNovel,
} from '@/lib/library-db';
import { type AppColors, useAppTheme } from '@/theme';

type LibraryMode = 'history' | 'offline';

interface LibraryViewProps {
  onOpenNovel: (novelId: number, resume: boolean) => void;
}

export function LibraryView({ onOpenNovel }: LibraryViewProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<LibraryMode>('history');
  const [items, setItems] = useState<LibraryNovel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextItems =
        mode === 'history'
          ? await listReadingHistory()
          : await listOfflineNovels();
      setItems(nextItems);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems]),
  );

  async function removeOffline(novelId: number) {
    await deleteOfflineNovel(novelId);
    await loadItems();
  }

  function confirmClearHistory() {
    Alert.alert(
      '読書履歴を消す？',
      'オフライン保存した本文は消さないよ。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '履歴を消す',
          style: 'destructive',
          onPress: () => {
            void clearReadingHistory().then(loadItems);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.segmentedControl}>
          <LibraryModeButton
            active={mode === 'history'}
            label="履歴"
            onPress={() => {
              setMode('history');
            }}
          />
          <LibraryModeButton
            active={mode === 'offline'}
            label="オフライン"
            onPress={() => {
              setMode('offline');
            }}
          />
        </View>

        {mode === 'history' && items.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={confirmClearHistory}
            style={({ pressed }) => [
              styles.clearButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.clearButtonText}>履歴を消す</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => String(item.novelId)}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color={colors.accent} size="large" />
            ) : (
              <>
                <Text style={styles.emptyIcon}>
                  {mode === 'history' ? '🕘' : '⇩'}
                </Text>
                <Text style={styles.emptyTitle}>
                  {errorMessage
                    ? 'ライブラリを開けなかった'
                    : mode === 'history'
                      ? 'まだ読書履歴がないよ'
                      : 'オフライン作品はまだないよ'}
                </Text>
                <Text style={styles.emptyText}>
                  {errorMessage ??
                    (mode === 'history'
                      ? '小説を読むと、続きから開けるようになる。'
                      : '読書画面の「…」から本文を保存できる。')}
                </Text>
              </>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={() => {
              void loadItems();
            }}
            refreshing={isLoading && items.length > 0}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <LibraryNovelCard
            item={item}
            mode={mode}
            onOpen={() => {
              onOpenNovel(
                item.novelId,
                mode === 'history' && !item.isFinished,
              );
            }}
            onRemoveOffline={() => {
              void removeOffline(item.novelId);
            }}
          />
        )}
      />
    </View>
  );
}

function LibraryModeButton({
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.modeText, active && styles.modeTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LibraryNovelCard({
  item,
  mode,
  onOpen,
  onRemoveOffline,
}: {
  item: LibraryNovel;
  mode: LibraryMode;
  onOpen: () => void;
  onRemoveOffline: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progressPercent = Math.round(item.progress * 100);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.cardMain,
          pressed && styles.pressed,
        ]}
      >
        {item.coverUrl ? (
          <Image
            contentFit="cover"
            source={{
              uri: item.coverUrl,
              headers: { Referer: 'https://app-api.pixiv.net/' },
            }}
            style={styles.cover}
            transition={140}
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverPlaceholderText}>📖</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text numberOfLines={2} style={styles.cardTitle}>
              {item.title}
            </Text>
            {item.isOffline ? (
              <View style={styles.offlineBadge}>
                <Text style={styles.offlineBadgeText}>OFFLINE</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.author}>
            {item.authorName}
          </Text>
          <Text style={styles.meta}>
            {item.textLength.toLocaleString()}字 ・{' '}
            {formatRelativeTime(item.lastReadAt)}
          </Text>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressValue,
                  { width: `${item.isFinished ? 100 : progressPercent}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {item.isFinished ? '読了' : `${progressPercent}%`}
            </Text>
          </View>

          <Text style={styles.openLabel}>
            {mode === 'history' && !item.isFinished
              ? '続きから読む  ›'
              : '最初から読む  ›'}
          </Text>
        </View>
      </Pressable>

      {mode === 'offline' ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRemoveOffline}
          style={({ pressed }) => [
            styles.removeButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.removeButtonText}>保存を削除</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatRelativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) {
    return 'たった今';
  }

  if (minutes < 60) {
    return `${minutes}分前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}時間前`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}日前`;
  }

  return new Date(timestamp).toLocaleDateString('ja-JP');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    segmentedControl: {
      flex: 1,
      flexDirection: 'row',
      padding: 4,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
    },
    modeButton: {
      flex: 1,
      minHeight: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
    },
    modeButtonActive: {
      backgroundColor: colors.surface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.16,
      shadowRadius: 6,
      elevation: 2,
    },
    modeText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    modeTextActive: {
      color: colors.text,
    },
    clearButton: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 5,
    },
    clearButtonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
    },
    listContent: {
      padding: 16,
      paddingBottom: 110,
      gap: 12,
      flexGrow: 1,
    },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.surface,
    },
    cardMain: {
      flexDirection: 'row',
      gap: 13,
      padding: 12,
    },
    cover: {
      width: 82,
      height: 110,
      borderRadius: 11,
      backgroundColor: colors.surfaceAlt,
    },
    coverPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverPlaceholderText: {
      fontSize: 28,
    },
    cardBody: {
      flex: 1,
      gap: 5,
    },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 7,
    },
    cardTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
      lineHeight: 21,
    },
    offlineBadge: {
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: colors.accentSoft,
    },
    offlineBadgeText: {
      color: colors.accentStrong,
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    author: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    meta: {
      color: colors.textMuted,
      fontSize: 10,
    },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      marginTop: 3,
    },
    progressTrack: {
      flex: 1,
      height: 5,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    progressValue: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    progressText: {
      minWidth: 34,
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      textAlign: 'right',
    },
    openLabel: {
      marginTop: 3,
      color: colors.accent,
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'right',
    },
    removeButton: {
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    removeButtonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
    },
    emptyState: {
      flex: 1,
      minHeight: 360,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      paddingHorizontal: 28,
    },
    emptyIcon: {
      fontSize: 38,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 19,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
