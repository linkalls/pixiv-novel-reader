import type { PixivNovelItem } from '@book000/pixivts';
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
  deleteOfflineNovels,
  deleteReadingHistory,
  listOfflineNovels,
  listReadingHistory,
  setReadingFinished,
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
  moveBookshelfNovel,
  removeNovelFromBookshelf,
  renameBookshelf,
  setNovelInBookshelf,
  type Bookshelf,
  type ReaderMark,
} from '@/lib/organizer-db';
import {
  listContentMutes,
  removeContentMute,
  type ContentMute,
} from '@/lib/content-preferences-db';
import {
  enqueueOfflineDownloads,
  processOfflineDownloadQueue,
} from '@/lib/offline-download-queue';
import { fetchNovelDetail } from '@/lib/pixiv';
import {
  getOfflineAssetStorageSummary,
  getOfflineNovelAssetStorageSummary,
} from '@/lib/offline-assets';
import { OfflineDownloadManager } from '@/components/offline-download-manager';
import { ReadingInsightsView } from '@/components/reading-insights-view';
import { type AppColors, useAppTheme } from '@/theme';

type LibraryMode =
  | 'history'
  | 'shelves'
  | 'marks'
  | 'offline'
  | 'mutes'
  | 'stats';
type ShelfEditorMode = 'create' | 'rename';

interface LibraryViewProps {
  onOpenAuthor: (novelId: number) => void;
  onOpenNovel: (
    novelId: number,
    resume: boolean,
    scrollOffset?: number,
    blockIndex?: number,
  ) => void;
  onTagPress: (tagName: string) => void;
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

export function LibraryView({
  onOpenAuthor,
  onOpenNovel,
  onTagPress,
}: LibraryViewProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<LibraryMode>('history');
  const [items, setItems] = useState<LibraryNovel[]>([]);
  const [marks, setMarks] = useState<ReaderMark[]>([]);
  const [contentMutes, setContentMutes] = useState<ContentMute[]>([]);
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
  const [selectedNovelIds, setSelectedNovelIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [offlineAssetBytes, setOfflineAssetBytes] = useState(0);
  const [offlineAssetFiles, setOfflineAssetFiles] = useState(0);
  const [offlineNovelSizes, setOfflineNovelSizes] = useState<Record<number, number>>(
    {},
  );
  const [isBatchBusy, setIsBatchBusy] = useState(false);
  const [isBulkShelfVisible, setIsBulkShelfVisible] = useState(false);

  const selectedShelf = shelves.find((shelf) => shelf.id === selectedShelfId);
  const isSelectionMode = selectedNovelIds.size > 0;

  function changeMode(nextMode: LibraryMode) {
    setSelectedNovelIds(new Set());
    setMode(nextMode);
  }

  function toggleSelected(novelId: number) {
    setSelectedNovelIds((current) => {
      const next = new Set(current);
      if (next.has(novelId)) next.delete(novelId);
      else next.add(novelId);
      return next;
    });
  }


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
        setContentMutes([]);
        return;
      }

      if (mode === 'offline') {
        const [offlineItems, storage] = await Promise.all([
          listOfflineNovels(300),
          getOfflineAssetStorageSummary(),
        ]);
        setItems(offlineItems);
        setOfflineAssetBytes(storage.assetBytes);
        setOfflineAssetFiles(storage.assetFiles);
        const sizeEntries = await Promise.all(
          offlineItems.map(async (item) => {
            const assetStorage = await getOfflineNovelAssetStorageSummary(
              item.novelId,
            );
            // 本文・作品情報はSQLite内なので、JSON文字数から概算する。
            const databaseBytes =
              (JSON.stringify(item).length + item.textLength) * 2;
            return [
              item.novelId,
              assetStorage.assetBytes + databaseBytes,
            ] as const;
          }),
        );
        setOfflineNovelSizes(Object.fromEntries(sizeEntries));
        setMarks([]);
        setContentMutes([]);
        return;
      }

      if (mode === 'marks') {
        setMarks(await listReaderMarks());
        setContentMutes([]);
        setItems([]);
        return;
      }


      if (mode === 'mutes') {
        setContentMutes(await listContentMutes());
        setMarks([]);
        setItems([]);
        return;
      }

      if (mode === 'stats') {
        setItems([]);
        setMarks([]);
        setContentMutes([]);
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
      setContentMutes([]);
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

  async function removeHistory(novelId: number) {
    await deleteReadingHistory(novelId);
    await loadItems();
  }

  async function fetchSelectedNovelDetails() {
    const ids = [...selectedNovelIds];
    const details: PixivNovelItem[] = [];
    const failedIds: number[] = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch = ids.slice(offset, offset + 4);
      const results = await Promise.allSettled(
        batch.map((novelId) => fetchNovelDetail(novelId)),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') details.push(result.value);
        else failedIds.push(batch[index]);
      });
    }
    return { details, failedIds };
  }

  async function saveSelectedOffline() {
    if (isBatchBusy || selectedNovelIds.size === 0) return;
    setIsBatchBusy(true);
    setErrorMessage(null);
    try {
      const { details, failedIds } = await fetchSelectedNovelDetails();
      const queued = await enqueueOfflineDownloads(details);
      const result = await processOfflineDownloadQueue();
      Alert.alert(
        '一括保存を開始しました',
        result.blockedByWifi
          ? `${queued}作品をキューへ追加しました。Wi-Fi接続時に自動で保存します。`
          : `${result.completed}作品を保存、${result.failed + failedIds.length}作品が失敗しました。`,
      );
      setSelectedNovelIds(new Set());
      await loadItems();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBatchBusy(false);
    }
  }

  async function openBulkShelfPicker() {
    if (isBatchBusy || selectedNovelIds.size === 0) return;
    setIsBatchBusy(true);
    try {
      setShelves(await listBookshelves());
      setIsBulkShelfVisible(true);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBatchBusy(false);
    }
  }

  async function moveSelectedToShelf(targetShelfId: number) {
    if (isBatchBusy) return;
    setIsBatchBusy(true);
    setErrorMessage(null);
    try {
      const { details, failedIds } = await fetchSelectedNovelDetails();
      for (const detail of details) {
        await setNovelInBookshelf(targetShelfId, detail, true);
        if (
          mode === 'shelves' &&
          selectedShelfId &&
          selectedShelfId !== targetShelfId
        ) {
          await removeNovelFromBookshelf(selectedShelfId, detail.id);
        }
      }
      setIsBulkShelfVisible(false);
      setSelectedNovelIds(new Set());
      await loadItems();
      Alert.alert(
        mode === 'shelves' ? '本棚へ移動しました' : '本棚へ追加しました',
        `${details.length}作品を反映しました。${
          failedIds.length > 0 ? `${failedIds.length}作品は取得に失敗しました。` : ''
        }`,
      );
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBatchBusy(false);
    }
  }

  async function runBatchAction(action: 'remove' | 'finished' | 'unread') {
    const ids = [...selectedNovelIds];
    if (ids.length === 0 || isBatchBusy) return;

    setIsBatchBusy(true);
    try {
      if (action === 'finished' || action === 'unread') {
        for (const novelId of ids) {
          await setReadingFinished(novelId, action === 'finished');
        }
      } else if (mode === 'offline') {
        await deleteOfflineNovels(ids);
      } else if (mode === 'shelves' && selectedShelfId) {
        for (const novelId of ids) {
          await removeNovelFromBookshelf(selectedShelfId, novelId);
        }
      } else if (mode === 'history') {
        for (const novelId of ids) await deleteReadingHistory(novelId);
      }
      setSelectedNovelIds(new Set());
      await loadItems();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBatchBusy(false);
    }
  }

  function confirmBatchRemove() {
    const count = selectedNovelIds.size;
    Alert.alert(
      `${count}件を削除しますか？`,
      mode === 'offline'
        ? '本文と保存済み挿絵を端末から削除します。読書履歴は残ります。'
        : 'ほかのライブラリ情報には影響しません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => void runBatchAction('remove'),
        },
      ],
    );
  }

  async function removeFromShelf(novelId: number) {
    if (!selectedShelfId) {
      return;
    }
    await removeNovelFromBookshelf(selectedShelfId, novelId);
    await loadItems();
  }

  async function moveInShelf(
    novelId: number,
    direction: 'up' | 'down',
  ) {
    if (!selectedShelfId) return;
    await moveBookshelfNovel(selectedShelfId, novelId, direction);
    await loadItems();
  }

  async function removeMark(markId: number) {
    await deleteReaderMark(markId);
    await loadItems();
  }


  async function unmuteContent(mute: ContentMute) {
    await removeContentMute(mute.kind, mute.value);
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
      <ScrollView
        contentContainerStyle={styles.modeTabs}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.modeTabsScroll}
      >
        <LibraryModeButton
          active={mode === 'history'}
          label="履歴"
          onPress={() => changeMode('history')}
        />
        <LibraryModeButton
          active={mode === 'shelves'}
          label="本棚"
          onPress={() => changeMode('shelves')}
        />
        <LibraryModeButton
          active={mode === 'marks'}
          label="しおり"
          onPress={() => changeMode('marks')}
        />
        <LibraryModeButton
          active={mode === 'offline'}
          label="オフライン"
          onPress={() => changeMode('offline')}
        />
        <LibraryModeButton
          active={mode === 'mutes'}
          label="ミュート"
          onPress={() => changeMode('mutes')}
        />
        <LibraryModeButton
          active={mode === 'stats'}
          label="統計"
          onPress={() => changeMode('stats')}
        />
      </ScrollView>

      {isSelectionMode ? (
        <View style={styles.batchToolbar}>
          <View style={styles.batchHeading}>
            <Text style={styles.batchCount}>{selectedNovelIds.size}件選択中</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedNovelIds(new Set())}
            >
              <Text style={styles.batchCancel}>選択解除</Text>
            </Pressable>
          </View>
          <View style={styles.batchActions}>
            <Pressable
              accessibilityRole="button"
              disabled={isBatchBusy}
              onPress={() =>
                setSelectedNovelIds(new Set(items.map((item) => item.novelId)))
              }
              style={({ pressed }) => [styles.batchSecondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.batchSecondaryText}>すべて選択</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isBatchBusy}
              onPress={() => void openBulkShelfPicker()}
              style={({ pressed }) => [
                styles.batchSecondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.batchSecondaryText}>
                {mode === 'shelves' ? '本棚へ移動' : '本棚へ追加'}
              </Text>
            </Pressable>
            {mode !== 'offline' ? (
              <Pressable
                accessibilityRole="button"
                disabled={isBatchBusy}
                onPress={() => void saveSelectedOffline()}
                style={({ pressed }) => [
                  styles.batchSecondaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.batchSecondaryText}>オフライン保存</Text>
              </Pressable>
            ) : null}
            {mode === 'history' ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={isBatchBusy}
                  onPress={() => void runBatchAction('finished')}
                  style={({ pressed }) => [styles.batchSecondaryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.batchSecondaryText}>読了にする</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isBatchBusy}
                  onPress={() => void runBatchAction('unread')}
                  style={({ pressed }) => [styles.batchSecondaryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.batchSecondaryText}>未読に戻す</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isBatchBusy}
              onPress={confirmBatchRemove}
              style={({ pressed }) => [styles.batchDangerButton, pressed && styles.pressed]}
            >
              <Text style={styles.batchDangerText}>{isBatchBusy ? '処理中…' : '削除'}</Text>
            </Pressable>
          </View>
        </View>
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
          onOpenAuthor={onOpenAuthor}
          onDataRestored={() => {
            void loadItems();
          }}
        />
      ) : mode === 'mutes' ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={contentMutes}
          keyExtractor={(mute) => `${mute.kind}-${mute.value}`}
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
              refreshing={isLoading && contentMutes.length > 0}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item: mute }) => (
            <ContentMuteCard
              mute={mute}
              onRestore={() => void unmuteContent(mute)}
            />
          )}
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
              onAuthor={() => onOpenAuthor(mark.novelId)}
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
          ListHeaderComponent={
            mode === 'history' ? (
              <HistoryControls
                filter={historyFilter}
                onClear={items.length > 0 ? confirmClearHistory : undefined}
                onFilterChange={setHistoryFilter}
                onQueryChange={setHistoryQuery}
                onSortChange={setHistorySort}
                query={historyQuery}
                sort={historySort}
              />
            ) : mode === 'offline' && !isSelectionMode ? (
              <View style={styles.offlineHeader}>
                <OfflineDownloadManager
                  onChanged={() => void loadItems()}
                  visible={mode === 'offline'}
                />
                <View style={styles.offlineSummary}>
                  <View>
                    <Text style={styles.offlineSummaryTitle}>オフライン保存</Text>
                    <Text style={styles.offlineSummaryText}>
                      {items.length}作品 ・ 挿絵{offlineAssetFiles}ファイル
                    </Text>
                  </View>
                  <Text style={styles.offlineSummarySize}>
                    {formatBytes(offlineAssetBytes)}
                  </Text>
                </View>
              </View>
            ) : null
          }
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
          renderItem={({ item, index }) => (
            <LibraryNovelCard
              item={item}
              mode={mode}
              selected={selectedNovelIds.has(item.novelId)}
              selectionMode={isSelectionMode}
              storageBytes={mode === 'offline' ? offlineNovelSizes[item.novelId] : undefined}
              onAuthor={() => onOpenAuthor(item.novelId)}
              onLongPress={() => toggleSelected(item.novelId)}
              onSelect={() => toggleSelected(item.novelId)}
              onTagPress={onTagPress}
              canMoveDown={mode === 'shelves' && index < items.length - 1}
              canMoveUp={mode === 'shelves' && index > 0}
              onMoveDown={() => void moveInShelf(item.novelId, 'down')}
              onMoveUp={() => void moveInShelf(item.novelId, 'up')}
              onOpen={() => {
                if (isSelectionMode) {
                  toggleSelected(item.novelId);
                  return;
                }
                onOpenNovel(item.novelId, mode === 'history' && !item.isFinished);
              }}
              onRemove={
                mode === 'offline'
                  ? () => void removeOffline(item.novelId)
                  : mode === 'shelves'
                    ? () => void removeFromShelf(item.novelId)
                    : mode === 'history'
                      ? () => void removeHistory(item.novelId)
                      : undefined
              }
            />
          )}
        />
      )}

      <Modal
        animationType="fade"
        onRequestClose={() => setIsBulkShelfVisible(false)}
        transparent
        visible={isBulkShelfVisible}
      >
        <Pressable
          onPress={() => setIsBulkShelfVisible(false)}
          style={styles.modalBackdrop}
        >
          <Pressable onPress={() => {}} style={styles.bulkShelfModal}>
            <Text style={styles.editorTitle}>
              {mode === 'shelves' ? '移動先の本棚' : '追加先の本棚'}
            </Text>
            <Text style={styles.bulkShelfDescription}>
              {selectedNovelIds.size}作品をまとめて反映します。
            </Text>
            <ScrollView
              contentContainerStyle={styles.bulkShelfList}
              showsVerticalScrollIndicator={false}
            >
              {shelves.map((shelf) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    isBatchBusy ||
                    (mode === 'shelves' && shelf.id === selectedShelfId)
                  }
                  key={shelf.id}
                  onPress={() => void moveSelectedToShelf(shelf.id)}
                  style={({ pressed }) => [
                    styles.bulkShelfRow,
                    mode === 'shelves' &&
                      shelf.id === selectedShelfId &&
                      styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.bulkShelfBody}>
                    <Text numberOfLines={1} style={styles.bulkShelfName}>
                      {shelf.name}
                    </Text>
                    <Text style={styles.bulkShelfCount}>{shelf.itemCount}作品</Text>
                  </View>
                  <Text style={styles.bulkShelfArrow}>›</Text>
                </Pressable>
              ))}
              {shelves.length === 0 ? (
                <Text style={styles.emptyText}>
                  本棚がありません。先に「本棚」タブから作成してください。
                </Text>
              ) : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsBulkShelfVisible(false)}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>キャンセル</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
            <Text style={styles.historySectionHint}>作品名・作者名・タグ</Text>
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
          placeholder="作品名・作者名・タグを入力"
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
  canMoveDown,
  canMoveUp,
  item,
  mode,
  onAuthor,
  onLongPress,
  onMoveDown,
  onMoveUp,
  onOpen,
  onRemove,
  onSelect,
  onTagPress,
  selected,
  selectionMode,
  storageBytes,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  item: LibraryNovel;
  mode: LibraryMode;
  onAuthor: () => void;
  onLongPress: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onOpen: () => void;
  onRemove?: () => void;
  onSelect: () => void;
  onTagPress: (tagName: string) => void;
  selected: boolean;
  selectionMode: boolean;
  storageBytes?: number;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progressPercent = Math.round(item.progress * 100);
  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable
        accessibilityRole="button"
        onLongPress={onLongPress}
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
            {selectionMode ? (
              <Pressable
                accessibilityLabel={selected ? '選択を解除' : '作品を選択'}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={(event) => {
                  event.stopPropagation();
                  onSelect();
                }}
                style={[styles.selectionCheck, selected && styles.selectionCheckActive]}
              >
                <Text style={styles.selectionCheckText}>{selected ? '✓' : ''}</Text>
              </Pressable>
            ) : null}
            {item.isOffline ? (
              <View style={styles.offlineBadge}>
                <Text style={styles.offlineBadgeText}>OFFLINE</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`作者「${item.authorName}」のプロフィールを開く`}
            accessibilityRole="link"
            onPress={(event) => {
              event.stopPropagation();
              onAuthor();
            }}
            style={({ pressed }) => [
              styles.authorButton,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={styles.author}>
              {item.authorName}
            </Text>
            <Text style={styles.authorArrow}>›</Text>
          </Pressable>
          {item.tags.length > 0 ? (
            <View style={styles.libraryTagsRow}>
              {item.tags.slice(0, 3).map((tagName) => (
                <Pressable
                  accessibilityLabel={`タグ「${tagName}」で検索`}
                  accessibilityRole="button"
                  key={tagName}
                  onPress={(event) => {
                    event.stopPropagation();
                    onTagPress(tagName);
                  }}
                  style={({ pressed }) => [
                    styles.libraryTagChip,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.libraryTagText}>
                    #{tagName}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.meta}>
            {item.textLength.toLocaleString()}字 ・ {
              item.isFinished && item.finishedAt
                ? `読了 ${formatRelativeTime(item.finishedAt)}`
                : formatRelativeTime(item.lastReadAt)
            }
          </Text>
          {storageBytes !== undefined ? (
            <Text style={styles.storageSizeText}>
              保存容量 約{formatBytes(storageBytes)}
            </Text>
          ) : null}
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
      {mode === 'shelves' ? (
        <View style={styles.shelfOrderActions}>
          <Pressable
            accessibilityLabel="本棚内で上へ移動"
            accessibilityRole="button"
            disabled={!canMoveUp}
            onPress={onMoveUp}
            style={({ pressed }) => [
              styles.shelfOrderButton,
              !canMoveUp && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.shelfOrderText}>↑ 上へ</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="本棚内で下へ移動"
            accessibilityRole="button"
            disabled={!canMoveDown}
            onPress={onMoveDown}
            style={({ pressed }) => [
              styles.shelfOrderButton,
              !canMoveDown && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.shelfOrderText}>↓ 下へ</Text>
          </Pressable>
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRemove}
              style={({ pressed }) => [
                styles.shelfRemoveButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.removeButtonText}>本棚から外す</Text>
            </Pressable>
          ) : null}
        </View>
      ) : onRemove ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRemove}
          style={({ pressed }) => [
            styles.removeButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.removeButtonText}>
            {mode === 'offline' ? '保存を削除' : '履歴から削除'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ContentMuteCard({
  mute,
  onRestore,
}: {
  mute: ContentMute;
  onRestore: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.muteCard}>
      <View style={styles.muteIcon}>
        <Text style={styles.muteIconText}>
          {mute.kind === 'author' ? '人' : '#'}
        </Text>
      </View>
      <View style={styles.muteBody}>
        <Text numberOfLines={2} style={styles.muteLabel}>
          {mute.label}
        </Text>
        <Text style={styles.meta}>
          {mute.kind === 'author' ? '作者をミュート中' : 'タグをミュート中'}
          　・　{formatRelativeTime(mute.createdAt)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRestore}
        style={({ pressed }) => [
          styles.restoreMuteButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.restoreMuteText}>解除</Text>
      </Pressable>
    </View>
  );
}

function ReaderMarkCard({
  mark,
  onAuthor,
  onDelete,
  onOpen,
}: {
  mark: ReaderMark;
  onAuthor: () => void;
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
        <Pressable
          accessibilityLabel={`作者「${mark.authorName}」のプロフィールを開く`}
          accessibilityRole="link"
          onPress={(event) => {
            event.stopPropagation();
            onAuthor();
          }}
          style={({ pressed }) => [
            styles.authorButton,
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={styles.author}>
            {mark.authorName}
          </Text>
          <Text style={styles.authorArrow}>›</Text>
        </Pressable>
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
  if (mode === 'mutes') {
    return {
      icon: '◎',
      title: 'ミュート中の作者・タグはありません',
      description: '作品カードの作者名やタグを長押しするとミュートできます。',
    };
  }
  return {
    icon: '📚',
    title: `「${shelfName ?? '本棚'}」は空です`,
    description: '読書画面の「…」から本棚へ追加できます。',
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
    container: { flex: 1, minHeight: 0 },
    modeTabsScroll: {
      flexGrow: 0,
      flexShrink: 0,
      height: 76,
    },
    modeTabs: {
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    modeButton: {
      minWidth: 76,
      minHeight: 44,
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
    batchToolbar: {
      gap: 9,
      marginHorizontal: 14,
      marginBottom: 9,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      borderRadius: 15,
      backgroundColor: colors.accentSoft,
    },
    batchHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    batchCount: { color: colors.text, fontSize: 13, fontWeight: '900' },
    batchCancel: { color: colors.accentStrong, fontSize: 11, fontWeight: '800' },
    batchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    batchSecondaryButton: {
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 11,
      backgroundColor: colors.surface,
    },
    batchSecondaryText: { color: colors.text, fontSize: 10, fontWeight: '800' },
    batchDangerButton: {
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderRadius: 11,
      backgroundColor: colors.danger,
    },
    batchDangerText: { color: colors.onAccent, fontSize: 10, fontWeight: '900' },
    offlineHeader: {
      gap: 12,
      paddingTop: 2,
    },
    offlineSummary: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 14,
      marginBottom: 9,
      paddingHorizontal: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
      backgroundColor: colors.surface,
    },
    offlineSummaryTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
    offlineSummaryText: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
    offlineSummarySize: { color: colors.accentStrong, fontSize: 15, fontWeight: '900' },
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
    cardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    selectionCheck: {
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 13,
    },
    selectionCheckActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    selectionCheckText: { color: colors.onAccent, fontSize: 14, fontWeight: '900' },
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
    authorButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: '100%',
      paddingVertical: 1,
    },
    author: {
      flexShrink: 1,
      color: colors.accentStrong,
      fontSize: 12,
      fontWeight: '700',
    },
    authorArrow: {
      color: colors.accentStrong,
      fontSize: 10,
      fontWeight: '900',
    },
    libraryTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    libraryTagChip: {
      maxWidth: '100%',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
    },
    libraryTagText: {
      color: colors.accentStrong,
      fontSize: 10,
      fontWeight: '700',
    },
    meta: { color: colors.textMuted, fontSize: 10, lineHeight: 16 },
    storageSizeText: { color: colors.accentStrong, fontSize: 9, fontWeight: '800' },
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
    shelfOrderActions: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    shelfOrderButton: {
      minHeight: 42,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
    },
    shelfOrderText: { color: colors.accentStrong, fontSize: 11, fontWeight: '800' },
    shelfRemoveButton: {
      minHeight: 42,
      flex: 1.2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    removeButtonText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
    muteCard: {
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    muteIcon: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      backgroundColor: colors.surfaceAlt,
    },
    muteIconText: {
      color: colors.accentStrong,
      fontSize: 16,
      fontWeight: '900',
    },
    muteBody: { flex: 1, gap: 5 },
    muteLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '900',
    },
    restoreMuteButton: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      borderRadius: 12,
    },
    restoreMuteText: {
      color: colors.accentStrong,
      fontSize: 11,
      fontWeight: '900',
    },
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
    bulkShelfModal: {
      width: '100%',
      maxWidth: 460,
      maxHeight: '78%',
      gap: 12,
      padding: 18,
      borderRadius: 19,
      backgroundColor: colors.surface,
    },
    bulkShelfDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
    bulkShelfList: { gap: 8 },
    bulkShelfRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 13,
      backgroundColor: colors.surfaceAlt,
    },
    bulkShelfBody: { flex: 1, gap: 3 },
    bulkShelfName: { color: colors.text, fontSize: 12, fontWeight: '900' },
    bulkShelfCount: { color: colors.textMuted, fontSize: 9 },
    bulkShelfArrow: { color: colors.accentStrong, fontSize: 22, fontWeight: '900' },
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
