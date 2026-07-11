import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
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

import {
  clearReadingHistory,
  deleteOfflineNovel,
  listOfflineNovels,
  listReadingHistory,
  type LibraryNovel,
  type ReadingHistoryFilter,
  type ReadingHistorySort,
} from '@/lib/library-db';
import {
  createBookshelf,
  deleteBookshelf,
  deleteReaderMark,
  listBookshelfNovels,
  listBookshelves,
  listReaderMarks,
  removeNovelFromBookshelf,
  renameBookshelf,
  type Bookshelf,
  type ReaderMark,
} from '@/lib/organizer-db';
import { ReadingInsightsView } from '@/components/reading-insights-view';
import { type AppColors, useAppTheme } from '@/theme';

type LibraryMode = 'history' | 'shelves' | 'marks' | 'offline' | 'stats';
type ShelfEditorMode = 'create' | 'rename';

interface LibraryViewProps {
  onOpenNovel: (
    novelId: number,
    resume: boolean,
    scrollOffset?: number,
  ) => void;
}

const HISTORY_FILTERS: { value: ReadingHistoryFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'reading', label: '読みかけ' },
  { value: 'finished', label: '読了' },
  { value: 'offline', label: '保存済み' },
];

const HISTORY_SORTS: { value: ReadingHistorySort; label: string }[] = [
  { value: 'recent', label: '最近読んだ順' },
  { value: 'progress', label: '進捗順' },
  { value: 'title', label: '作品名順' },
];

export function LibraryView({ onOpenNovel }: LibraryViewProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<LibraryMode>('history');
  const [items, setItems] = useState<LibraryNovel[]>([]);
  const [marks, setMarks] = useState<ReaderMark[]>([]);
  const [shelves, setShelves] = useState<Bookshelf[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState<number | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] =
    useState<ReadingHistoryFilter>('all');
  const [historySort, setHistorySort] =
    useState<ReadingHistorySort>('recent');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isShelfEditorVisible, setIsShelfEditorVisible] = useState(false);
  const [shelfEditorMode, setShelfEditorMode] =
    useState<ShelfEditorMode>('create');
  const [shelfName, setShelfName] = useState('');
  const [isShelfSaving, setIsShelfSaving] = useState(false);

  const selectedShelf = shelves.find((shelf) => shelf.id === selectedShelfId);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (mode === 'history') {
        setItems(
          await listReadingHistory({
            filter: historyFilter,
            query: historyQuery,
            sort: historySort,
          }),
        );
        setMarks([]);
        return;
      }

      if (mode === 'offline') {
        setItems(await listOfflineNovels(300));
        setMarks([]);
        return;
      }

      if (mode === 'marks') {
        setMarks(await listReaderMarks());
        setItems([]);
        return;
      }

      if (mode === 'stats') {
        setItems([]);
        setMarks([]);
        return;
      }

      const nextShelves = await listBookshelves();
      const nextSelectedShelfId =
        selectedShelfId &&
        nextShelves.some((shelf) => shelf.id === selectedShelfId)
          ? selectedShelfId
          : (nextShelves[0]?.id ?? null);
      setShelves(nextShelves);
      setSelectedShelfId(nextSelectedShelfId);
      setMarks([]);
      setItems(
        nextSelectedShelfId
          ? await listBookshelfNovels(nextSelectedShelfId)
          : [],
      );
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [historyFilter, historyQuery, historySort, mode, selectedShelfId]);

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems]),
  );

  async function removeOffline(novelId: number) {
    await deleteOfflineNovel(novelId);
    await loadItems();
  }

  async function removeFromShelf(novelId: number) {
    if (!selectedShelfId) {
      return;
    }
    await removeNovelFromBookshelf(selectedShelfId, novelId);
    await loadItems();
  }

  async function removeMark(markId: number) {
    await deleteReaderMark(markId);
    await loadItems();
  }

  function confirmClearHistory() {
    Alert.alert(
      '読書履歴を削除しますか？',
      '本棚・しおり・オフライン保存は削除されません。',
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

  function closeShelfEditor() {
    Keyboard.dismiss();
    setIsShelfEditorVisible(false);
  }

  function openShelfEditor(editorMode: ShelfEditorMode) {
    setShelfEditorMode(editorMode);
    setShelfName(editorMode === 'rename' ? (selectedShelf?.name ?? '') : '');
    setIsShelfEditorVisible(true);
  }

  async function saveShelf() {
    if (shelfName.trim().length === 0 || isShelfSaving) {
      return;
    }
    setIsShelfSaving(true);
    setErrorMessage(null);
    try {
      if (shelfEditorMode === 'rename' && selectedShelfId) {
        await renameBookshelf(selectedShelfId, shelfName);
        Keyboard.dismiss();
        setIsShelfEditorVisible(false);
        setShelfName('');
        await loadItems();
        return;
      }

      const created = await createBookshelf(shelfName);
      const nextShelves = await listBookshelves();
      setShelves(nextShelves);
      setSelectedShelfId(created.id);
      setItems(await listBookshelfNovels(created.id));
      setMarks([]);
      Keyboard.dismiss();
      setIsShelfEditorVisible(false);
      setShelfName('');
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsShelfSaving(false);
    }
  }

  function confirmDeleteShelf() {
    if (!selectedShelf) {
      return;
    }
    Alert.alert(
      `「${selectedShelf.name}」を削除しますか？`,
      '作品の履歴やオフライン保存は削除されません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '本棚を削除',
          style: 'destructive',
          onPress: () => {
            void deleteBookshelf(selectedShelf.id).then(async () => {
              setSelectedShelfId(null);
              await loadItems();
            });
          },
        },
      ],
    );
  }

  const emptyMessage = getEmptyMessage(mode, errorMessage, selectedShelf?.name);

  return (
    <View style={styles.container}>
      <View style={styles.modeTabs}>
        <LibraryModeButton
          active={mode === 'history'}
          label="履歴"
          onPress={() => setMode('history')}
        />
        <LibraryModeButton
          active={mode === 'shelves'}
          label="本棚"
          onPress={() => setMode('shelves')}
        />
        <LibraryModeButton
          active={mode === 'marks'}
          label="しおり"
          onPress={() => setMode('marks')}
        />
        <LibraryModeButton
          active={mode === 'offline'}
          label="オフライン"
          onPress={() => setMode('offline')}
        />
        <LibraryModeButton
          active={mode === 'stats'}
          label="統計"
          onPress={() => setMode('stats')}
        />
      </View>

      {mode === 'history' ? (
        <HistoryControls
          filter={historyFilter}
          onClear={items.length > 0 ? confirmClearHistory : undefined}
          onFilterChange={setHistoryFilter}
          onQueryChange={setHistoryQuery}
          onSortChange={setHistorySort}
          query={historyQuery}
          sort={historySort}
        />
      ) : null}

      {mode === 'shelves' ? (
        <View style={styles.shelfControls}>
          <ScrollView
            contentContainerStyle={styles.shelfTabs}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {shelves.map((shelf) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedShelfId === shelf.id }}
                key={shelf.id}
                onPress={() => setSelectedShelfId(shelf.id)}
                style={({ pressed }) => [
                  styles.shelfChip,
                  selectedShelfId === shelf.id && styles.shelfChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.shelfChipText,
                    selectedShelfId === shelf.id && styles.shelfChipTextActive,
                  ]}
                >
                  {shelf.name} · {shelf.itemCount}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel="本棚を作成"
              accessibilityRole="button"
              onPress={() => openShelfEditor('create')}
              style={({ pressed }) => [
                styles.addShelfButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.addShelfText}>＋ 新規</Text>
            </Pressable>
          </ScrollView>
          {selectedShelf ? (
            <View style={styles.shelfActions}>
              <Text numberOfLines={1} style={styles.selectedShelfTitle}>
                {selectedShelf.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => openShelfEditor('rename')}
              >
                <Text style={styles.shelfActionText}>名前変更</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={confirmDeleteShelf}>
                <Text style={styles.shelfDeleteText}>削除</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {mode === 'stats' ? (
        <ReadingInsightsView
          onDataRestored={() => {
            void loadItems();
          }}
        />
      ) : mode === 'marks' ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={marks}
          keyExtractor={(mark) => `mark-${mark.id}`}
          ListEmptyComponent={
            <LibraryEmptyState
              colors={colors}
              isLoading={isLoading}
              message={emptyMessage}
              styles={styles}
            />
          }
          refreshControl={
            <RefreshControl
              colors={[colors.accent]}
              onRefresh={() => void loadItems()}
              refreshing={isLoading && marks.length > 0}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item: mark }) => (
            <ReaderMarkCard
              mark={mark}
              onDelete={() => void removeMark(mark.id)}
              onOpen={() =>
                onOpenNovel(mark.novelId, false, mark.scrollOffset)
              }
            />
          )}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={items}
          keyExtractor={(item) => `novel-${item.novelId}`}
          ListEmptyComponent={
            <LibraryEmptyState
              colors={colors}
              isLoading={isLoading}
              message={emptyMessage}
              styles={styles}
            />
          }
          refreshControl={
            <RefreshControl
              colors={[colors.accent]}
              onRefresh={() => void loadItems()}
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
              onRemove={
                mode === 'offline'
                  ? () => void removeOffline(item.novelId)
                  : mode === 'shelves'
                    ? () => void removeFromShelf(item.novelId)
                    : undefined
              }
            />
          )}
        />
      )}

      <Modal
        animationType="fade"
        onRequestClose={closeShelfEditor}
        transparent
        visible={isShelfEditorVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.keyboardAvoider}
        >
          <Pressable
            onPress={closeShelfEditor}
            style={styles.modalBackdrop}
          >
            <Pressable onPress={() => {}} style={styles.editorModal}>
            <Text style={styles.editorTitle}>
              {shelfEditorMode === 'create' ? '新しい本棚' : '本棚の名前変更'}
            </Text>
            <TextInput
              autoFocus
              maxLength={40}
              onChangeText={setShelfName}
              onSubmitEditing={() => void saveShelf()}
              placeholder="本棚の名前"
              placeholderTextColor={colors.placeholder}
              returnKeyType="done"
              style={styles.editorInput}
              value={shelfName}
            />
            <View style={styles.editorButtons}>
              <Pressable
                accessibilityRole="button"
                onPress={closeShelfEditor}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.cancelText}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={shelfName.trim().length === 0 || isShelfSaving}
                onPress={() => void saveShelf()}
                style={({ pressed }) => [
                  styles.saveButton,
                  (shelfName.trim().length === 0 || isShelfSaving) &&
                    styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.saveText}>保存</Text>
              </Pressable>
            </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function LibraryEmptyState({
  colors,
  isLoading,
  message,
  styles,
}: {
  colors: AppColors;
  isLoading: boolean;
  message: { icon: string; title: string; description: string };
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.emptyState}>
      {isLoading ? (
        <ActivityIndicator color={colors.accent} size="large" />
      ) : (
        <>
          <Text style={styles.emptyIcon}>{message.icon}</Text>
          <Text style={styles.emptyTitle}>{message.title}</Text>
          <Text style={styles.emptyText}>{message.description}</Text>
        </>
      )}
    </View>
  );
}

function HistoryControls({
  filter,
  onClear,
  onFilterChange,
  onQueryChange,
  onSortChange,
  query,
  sort,
}: {
  filter: ReadingHistoryFilter;
  onClear?: () => void;
  onFilterChange: (filter: ReadingHistoryFilter) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: ReadingHistorySort) => void;
  query: string;
  sort: ReadingHistorySort;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.historyControls}>
      <View style={styles.historySearchSection}>
        <View style={styles.historySectionHeader}>
          <View style={styles.historyHeadingText}>
            <Text style={styles.historySectionLabel}>履歴を検索</Text>
            <Text style={styles.historySectionHint}>作品名または作者名</Text>
          </View>
          {onClear ? (
            <Pressable
              accessibilityLabel="読書履歴をすべて削除"
              accessibilityRole="button"
              onPress={onClear}
              style={({ pressed }) => [
                styles.clearButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.clearButtonText}>履歴を削除</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQueryChange}
          placeholder="作品名・作者名を入力"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
      </View>

      <View style={styles.historyOptionSection}>
        <Text style={styles.historySectionLabel}>表示する履歴</Text>
        <View style={styles.filterRow}>
          {HISTORY_FILTERS.map((option) => (
            <FilterChip
              active={filter === option.value}
              key={option.value}
              label={option.label}
              onPress={() => onFilterChange(option.value)}
            />
          ))}
        </View>
      </View>

      <View style={styles.historyOptionSection}>
        <Text style={styles.historySectionLabel}>並び順</Text>
        <View style={styles.filterRow}>
          {HISTORY_SORTS.map((option) => (
            <FilterChip
              active={sort === option.value}
              key={option.value}
              label={option.label}
              onPress={() => onSortChange(option.value)}
            />
          ))}
        </View>
      </View>
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

function LibraryNovelCard({
  item,
  mode,
  onOpen,
  onRemove,
}: {
  item: LibraryNovel;
  mode: LibraryMode;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progressPercent = Math.round(item.progress * 100);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
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
          <Text numberOfLines={1} style={styles.author}>{item.authorName}</Text>
          <Text style={styles.meta}>
            {item.textLength.toLocaleString()}字 ・ {formatRelativeTime(item.lastReadAt)}
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
              : '読む  ›'}
          </Text>
        </View>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRemove}
          style={({ pressed }) => [
            styles.removeButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.removeButtonText}>
            {mode === 'offline' ? '保存を削除' : '本棚から外す'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReaderMarkCard({
  mark,
  onDelete,
  onOpen,
}: {
  mark: ReaderMark;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.markCard}>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.markMain, pressed && styles.pressed]}
      >
        <View style={styles.markHeading}>
          <Text style={styles.markProgress}>{Math.round(mark.progress * 100)}%</Text>
          <Text style={styles.meta}>{formatRelativeTime(mark.updatedAt)}</Text>
        </View>
        <Text numberOfLines={1} style={styles.cardTitle}>{mark.title}</Text>
        <Text numberOfLines={1} style={styles.author}>{mark.authorName}</Text>
        <Text numberOfLines={3} style={styles.markExcerpt}>{mark.excerpt}</Text>
        {mark.note ? (
          <Text numberOfLines={3} style={styles.markNote}>📝 {mark.note}</Text>
        ) : null}
        <Text style={styles.openLabel}>しおり位置から読む  ›</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
      >
        <Text style={styles.removeButtonText}>しおりを削除</Text>
      </Pressable>
    </View>
  );
}

function getEmptyMessage(
  mode: LibraryMode,
  error: string | null,
  shelfName?: string,
) {
  if (error) {
    return { icon: '⚠', title: 'ライブラリを開けませんでした', description: error };
  }
  if (mode === 'history') {
    return {
      icon: '🕘',
      title: '条件に合う履歴はありません',
      description: '小説を読むと、ここから続きへ戻れます。',
    };
  }
  if (mode === 'offline') {
    return {
      icon: '⇩',
      title: 'オフライン作品はありません',
      description: '読書画面の「…」から本文と挿絵を保存できます。',
    };
  }
  if (mode === 'marks') {
    return {
      icon: '🔖',
      title: 'しおり・メモはありません',
      description: '読書画面の「…」から現在位置を保存できます。',
    };
  }
  return {
    icon: '📚',
    title: `「${shelfName ?? '本棚'}」は空です`,
    description: '読書画面の「…」から本棚へ追加できます。',
  };
}

function formatRelativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '1分未満';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}日前`;
  return new Date(timestamp).toLocaleDateString('ja-JP');
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE') ? '同じ名前の本棚が存在します' : message;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    modeTabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 16,
    },
    modeButton: {
      flexGrow: 1,
      flexBasis: '30%',
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: 15,
      backgroundColor: colors.surfaceAlt,
    },
    modeButtonActive: { backgroundColor: colors.accent },
    modeText: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
    modeTextActive: { color: colors.onAccent },
    historyControls: {
      gap: 22,
      marginHorizontal: 16,
      marginBottom: 2,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    historySearchSection: { gap: 12 },
    historySectionHeader: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    historyHeadingText: { flex: 1, gap: 3 },
    historySectionLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.2,
    },
    historySectionHint: { color: colors.textMuted, fontSize: 11 },
    historyOptionSection: { gap: 11 },
    searchInput: {
      width: '100%',
      minHeight: 54,
      paddingHorizontal: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      color: colors.text,
      backgroundColor: colors.input,
      fontSize: 14,
    },
    clearButton: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderRadius: 11,
      backgroundColor: colors.dangerSoft,
    },
    clearButtonText: { color: colors.danger, fontSize: 10, fontWeight: '900' },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    filterChip: {
      flexGrow: 1,
      minWidth: 72,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 21,
      backgroundColor: colors.surfaceAlt,
    },
    filterChipActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    filterChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
    filterChipTextActive: { color: colors.accentStrong },
    shelfControls: { gap: 7, paddingHorizontal: 16, paddingBottom: 8 },
    shelfTabs: { gap: 7 },
    shelfChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    shelfChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    shelfChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
    shelfChipTextActive: { color: colors.accentStrong },
    addShelfButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.accent },
    addShelfText: { color: colors.onAccent, fontSize: 11, fontWeight: '900' },
    shelfActions: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 14 },
    selectedShelfTitle: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '800' },
    shelfActionText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
    shelfDeleteText: { color: colors.danger, fontSize: 11, fontWeight: '800' },
    listContent: {
      flexGrow: 1,
      gap: 16,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 110,
    },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    cardMain: { flexDirection: 'row', gap: 15, padding: 15 },
    cover: {
      width: 92,
      height: 128,
      borderRadius: 13,
      backgroundColor: colors.surfaceAlt,
    },
    coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    coverPlaceholderText: { fontSize: 30 },
    cardBody: { flex: 1, gap: 7 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    cardTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
      lineHeight: 23,
    },
    offlineBadge: {
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 7,
      backgroundColor: colors.accentSoft,
    },
    offlineBadgeText: {
      color: colors.accentStrong,
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    author: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    meta: { color: colors.textMuted, fontSize: 10, lineHeight: 16 },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 4,
    },
    progressTrack: {
      flex: 1,
      height: 6,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    progressValue: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
    progressText: {
      minWidth: 36,
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      textAlign: 'right',
    },
    openLabel: {
      marginTop: 5,
      color: colors.accent,
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'right',
    },
    removeButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    removeButtonText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
    markCard: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
    markMain: { gap: 6, padding: 14 },
    markHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    markProgress: { color: colors.accent, fontSize: 11, fontWeight: '900' },
    markExcerpt: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 20 },
    markNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    emptyState: { flex: 1, minHeight: 340, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 28 },
    emptyIcon: { fontSize: 38 },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
    keyboardAvoider: { flex: 1 },
    modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.overlay },
    editorModal: { width: '100%', maxWidth: 460, gap: 14, padding: 20, borderRadius: 18, backgroundColor: colors.surface },
    editorTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
    editorInput: { minHeight: 48, paddingHorizontal: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 13, color: colors.text, backgroundColor: colors.input, fontSize: 14 },
    editorButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
    cancelButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12 },
    cancelText: { color: colors.text, fontSize: 12, fontWeight: '800' },
    saveButton: { minWidth: 82, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accent },
    saveText: { color: colors.onAccent, fontSize: 12, fontWeight: '900' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.68 },
  });
}
