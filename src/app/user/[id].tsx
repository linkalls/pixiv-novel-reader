import type { PixivNovelItem } from '@book000/pixivts';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelCard } from '@/components/novel-card';
import {
  getNovelReadingStatuses,
  type NovelReadingStatus,
} from '@/lib/library-db';
import { muteAuthor, muteTag } from '@/lib/content-preferences-db';
import {
  enqueueOfflineDownloads,
  processOfflineDownloadQueue,
} from '@/lib/offline-download-queue';
import { cacheNovelForRoute } from '@/lib/novel-route-cache';
import {
  fetchAllUserNovels,
  fetchUserNovels,
  fetchUserProfile,
  setUserFollow,
  type UserProfileResult,
} from '@/lib/pixiv';
import { type AppColors, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

export default function UserProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const userId = Number(rawId);
  const isValidUserId = Number.isInteger(userId) && userId > 0;

  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [profileResult, setProfileResult] = useState<UserProfileResult | null>(
    null,
  );
  const [novels, setNovels] = useState<PixivNovelItem[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [readingStatuses, setReadingStatuses] = useState<
    Record<number, NovelReadingStatus>
  >({});
  const [isLoading, setIsLoading] = useState(isValidUserId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isQueueLoading, setIsQueueLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isValidUserId ? null : 'ユーザーIDを読み取れませんでした',
  );
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);

  // 画面を素早く行き来した場合に、古い通信結果で新しい画面を上書きしない。
  const requestVersionRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const readReadingStatuses = useCallback(
    async (
      targetNovels: readonly PixivNovelItem[],
    ): Promise<Record<number, NovelReadingStatus>> => {
      try {
        const statusMap = await getNovelReadingStatuses(
          targetNovels.map((novel) => novel.id),
        );
        const nextStatuses: Record<number, NovelReadingStatus> = {};

        for (const [novelId, status] of statusMap) {
          nextStatuses[novelId] = status;
        }

        return nextStatuses;
      } catch {
        // ローカル履歴の取得失敗だけでプロフィール全体を開けなくしない。
        return {};
      }
    },
    [],
  );

  const loadInitial = useCallback(
    async (refreshing = false) => {
      if (!isValidUserId) {
        requestVersionRef.current += 1;
        loadingMoreRef.current = false;
        setProfileResult(null);
        setNovels([]);
        setNextUrl(null);
        setReadingStatuses({});
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        setErrorMessage('ユーザーIDを読み取れませんでした');
        setLoadMoreError(null);
        return;
      }

      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);

      if (refreshing) {
        setIsLoading(false);
        setIsRefreshing(true);
      } else {
        setIsRefreshing(false);
        setProfileResult(null);
        setNovels([]);
        setNextUrl(null);
        setReadingStatuses({});
        setIsLoading(true);
      }
      setErrorMessage(null);
      setLoadMoreError(null);

      try {
        const [nextProfileResult, novelPage] = await Promise.all([
          fetchUserProfile(userId),
          fetchUserNovels(userId),
        ]);
        const nextStatuses = await readReadingStatuses(novelPage.novels);

        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setProfileResult(nextProfileResult);
        setNovels(novelPage.novels);
        setNextUrl(novelPage.nextUrl);
        setReadingStatuses(nextStatuses);
      } catch (error) {
        if (requestVersionRef.current === requestVersion) {
          setErrorMessage(toErrorMessage(error));
        }
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [isValidUserId, readReadingStatuses, userId],
  );

  const loadMore = useCallback(async () => {
    if (
      !isValidUserId ||
      !nextUrl ||
      isLoading ||
      isRefreshing ||
      loadingMoreRef.current
    ) {
      return;
    }

    const requestVersion = requestVersionRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const page = await fetchUserNovels(userId, nextUrl);
      const pageStatuses = await readReadingStatuses(page.novels);

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setNovels((current) => {
        const seenIds = new Set(current.map((novel) => novel.id));
        const additions = page.novels.filter((novel) => !seenIds.has(novel.id));
        return [...current, ...additions];
      });
      setNextUrl(page.nextUrl);
      setReadingStatuses((current) => ({
        ...current,
        ...pageStatuses,
      }));
    } catch (error) {
      if (requestVersionRef.current === requestVersion) {
        setLoadMoreError(toErrorMessage(error));
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [
    isLoading,
    isRefreshing,
    isValidUserId,
    nextUrl,
    readReadingStatuses,
    userId,
  ]);

  useEffect(() => {
    // Reactのeffect本体で同期的にstate更新を始めないよう、次フレームへ渡す。
    const frameId = requestAnimationFrame(() => {
      void loadInitial();
    });

    return () => {
      cancelAnimationFrame(frameId);
      requestVersionRef.current += 1;
      loadingMoreRef.current = false;
    };
  }, [loadInitial]);

  // 作品を読んで戻ってきた際、読書中・読了バッジを最新状態へ更新する。
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      if (novels.length > 0) {
        void readReadingStatuses(novels).then((nextStatuses) => {
          if (isActive) {
            setReadingStatuses(nextStatuses);
          }
        });
      }

      return () => {
        isActive = false;
      };
    }, [novels, readReadingStatuses]),
  );

  async function toggleFollow() {
    if (!profileResult || isFollowLoading) {
      return;
    }

    const previous = profileResult;
    const shouldFollow = !Boolean(profileResult.user.isFollowed);
    setIsFollowLoading(true);
    setProfileResult({
      ...profileResult,
      user: { ...profileResult.user, isFollowed: shouldFollow },
    });

    try {
      const refreshToken = await setUserFollow(userId, shouldFollow);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    } catch (error) {
      setProfileResult(previous);
      setErrorMessage(`フォローを変更できませんでした: ${toErrorMessage(error)}`);
    } finally {
      setIsFollowLoading(false);
    }
  }

  async function queueNovelsForOffline(
    target: 'filtered' | 'all',
  ) {
    if (isQueueLoading) return;
    setIsQueueLoading(true);
    setErrorMessage(null);
    try {
      const targetNovels =
        target === 'all' ? await fetchAllUserNovels(userId) : filteredNovels;
      const queued = await enqueueOfflineDownloads(targetNovels);
      const result = await processOfflineDownloadQueue();
      Alert.alert(
        'オフライン保存キューへ追加しました',
        result.blockedByWifi
          ? `${queued}作品を追加しました。Wi-Fi接続時に自動で再開します。`
          : `${queued}作品を追加し、${result.completed}作品を保存しました。${
              result.failed > 0 ? ` ${result.failed}作品は失敗一覧から再試行できます。` : ''
            }`,
      );
      const nextStatuses = await readReadingStatuses(targetNovels);
      setReadingStatuses((current) => ({ ...current, ...nextStatuses }));
    } catch (error) {
      setErrorMessage(`一括保存を開始できませんでした: ${toErrorMessage(error)}`);
    } finally {
      setIsQueueLoading(false);
    }
  }

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const novel of novels) {
      for (const tag of novel.tags) {
        const name = tag.name.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja'))
      .slice(0, 30);
  }, [novels]);

  const availableSeries = useMemo(() => {
    const series = new Map<number, { title: string; count: number }>();
    for (const novel of novels) {
      if (!novel.series) continue;
      const current = series.get(novel.series.id);
      series.set(novel.series.id, {
        title: novel.series.title,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...series.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, 'ja'));
  }, [novels]);

  const filteredNovels = (() => {
    const query = profileSearchQuery.trim().toLocaleLowerCase('ja-JP');
    return novels.filter((novel) => {
      if (selectedSeriesId !== null && novel.series?.id !== selectedSeriesId) {
        return false;
      }
      if (
        selectedTag &&
        !novel.tags.some((tag) => tag.name.trim() === selectedTag)
      ) {
        return false;
      }
      if (!query) return true;
      return [
        novel.title,
        novel.caption,
        novel.series?.title ?? '',
        ...novel.tags.map((tag) => tag.name),
      ].some((value) => value.toLocaleLowerCase('ja-JP').includes(query));
    });
  })();

  function confirmMuteAuthor() {
    if (!profileResult) return;
    Alert.alert(
      `「${profileResult.user.name}」をミュートしますか？`,
      'この作者の作品をおすすめ・新着・ランキング・検索・ブックマーク一覧から非表示にします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ミュート',
          style: 'destructive',
          onPress: () => {
            void muteAuthor(profileResult.user.id, profileResult.user.name).then(() => {
              Alert.alert('ミュートしました', 'ライブラリの「ミュート」から解除できます。');
            });
          },
        },
      ],
    );
  }

  function confirmMuteTag(tagName: string) {
    Alert.alert(
      `#${tagName} をミュートしますか？`,
      'このタグを含む作品をすべての一覧から非表示にします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ミュート',
          style: 'destructive',
          onPress: () => void muteTag(tagName),
        },
      ],
    );
  }

  const listHeader = profileResult ? (
    <ProfileHeader
      availableSeries={availableSeries}
      availableTags={availableTags}
      colors={colors}
      filteredCount={filteredNovels.length}
      isFollowLoading={isFollowLoading}
      isQueueLoading={isQueueLoading}
      onDownloadAll={() => void queueNovelsForOffline('all')}
      onDownloadFiltered={() => void queueNovelsForOffline('filtered')}
      onMuteAuthor={confirmMuteAuthor}
      onQueryChange={setProfileSearchQuery}
      onSelectSeries={setSelectedSeriesId}
      onSelectTag={setSelectedTag}
      onToggleFollow={() => void toggleFollow()}
      profileResult={profileResult}
      query={profileSearchQuery}
      selectedSeriesId={selectedSeriesId}
      selectedTag={selectedTag}
      styles={styles}
    />
  ) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="前の画面へ戻る"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headerButtonText}>‹ 戻る</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          作者プロフィール
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading && !profileResult ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>プロフィールを読み込み中…</Text>
        </View>
      ) : errorMessage && !profileResult ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>プロフィールを開けませんでした</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadInitial()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryButtonText}>もう一度読み込む</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filteredNovels}
          keyExtractor={(novel) => String(novel.id)}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>条件に合う小説はありません</Text>
              <Text style={styles.emptyText}>
                作者内検索・タグ・シリーズの条件を変更してみてください。
              </Text>
            </View>
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>続きを読み込み中…</Text>
              </View>
            ) : loadMoreError ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadMore()}
                style={({ pressed }) => [
                  styles.loadMoreError,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.errorText}>{loadMoreError}</Text>
                <Text style={styles.loadMoreRetry}>タップして再読み込み</Text>
              </Pressable>
            ) : null
          }
          ListHeaderComponent={listHeader}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.7}
          refreshControl={
            <RefreshControl
              colors={[colors.accent]}
              onRefresh={() => void loadInitial(true)}
              refreshing={isRefreshing}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <NovelCard
              novel={item}
              onPress={() => {
                cacheNovelForRoute(item);
                router.push({
                  pathname: '/novel/detail/[id]',
                  params: {
                    bookmarked: item.isBookmarked ? '1' : '0',
                    id: String(item.id),
                  },
                });
              }}
              onTagLongPress={confirmMuteTag}
              onTagPress={(tagName) => {
                setSelectedTag((current) =>
                  current === tagName ? null : tagName,
                );
              }}
              readingStatus={readingStatuses[item.id]}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ProfileHeader({
  availableSeries,
  availableTags,
  colors,
  filteredCount,
  isFollowLoading,
  isQueueLoading,
  onDownloadAll,
  onDownloadFiltered,
  onMuteAuthor,
  onQueryChange,
  onSelectSeries,
  onSelectTag,
  onToggleFollow,
  profileResult,
  query,
  selectedSeriesId,
  selectedTag,
  styles,
}: {
  availableSeries: { id: number; title: string; count: number }[];
  availableTags: [string, number][];
  colors: AppColors;
  filteredCount: number;
  isFollowLoading: boolean;
  isQueueLoading: boolean;
  onDownloadAll: () => void;
  onDownloadFiltered: () => void;
  onMuteAuthor: () => void;
  onQueryChange: (value: string) => void;
  onSelectSeries: (value: number | null) => void;
  onSelectTag: (value: string | null) => void;
  onToggleFollow: () => void;
  profileResult: UserProfileResult;
  query: string;
  selectedSeriesId: number | null;
  selectedTag: string | null;
  styles: ReturnType<typeof createStyles>;
}) {
  const { profile, user } = profileResult;
  const metadata = [profile.region, profile.job].filter(
    (value): value is string => Boolean(value?.trim()),
  );

  return (
    <View style={styles.profileSection}>
      <View style={styles.profileHero}>
        {profile.backgroundImageUrl ? (
          <Image
            contentFit="cover"
            source={{
              uri: profile.backgroundImageUrl,
              headers: { Referer: 'https://app-api.pixiv.net/' },
            }}
            style={styles.profileBackground}
            transition={180}
          />
        ) : (
          <View style={styles.profileBackgroundPlaceholder} />
        )}
        <View style={styles.profileBackgroundShade} />
        <Image
          contentFit="cover"
          source={{
            uri: user.profileImageUrls.medium,
            headers: { Referer: 'https://app-api.pixiv.net/' },
          }}
          style={styles.profileAvatar}
          transition={180}
        />
      </View>

      <View style={styles.profileIdentity}>
        <Text style={styles.profileName}>{user.name}</Text>
        <Text style={styles.profileAccount}>@{user.account}</Text>
      </View>

      <View style={styles.profileActions}>
        <Pressable
        accessibilityRole="button"
        disabled={isFollowLoading}
        onPress={onToggleFollow}
        style={({ pressed }) => [
          styles.followButton,
          user.isFollowed && styles.followButtonActive,
          pressed && styles.pressed,
          isFollowLoading && styles.disabled,
        ]}
      >
        {isFollowLoading ? (
          <ActivityIndicator
            color={user.isFollowed ? colors.text : colors.onAccent}
            size="small"
          />
        ) : (
          <Text
            style={[
              styles.followButtonText,
              user.isFollowed && styles.followButtonTextActive,
            ]}
          >
            {user.isFollowed ? 'フォロー中' : 'フォローする'}
          </Text>
        )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onMuteAuthor}
          style={({ pressed }) => [
            styles.muteAuthorButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.muteAuthorText}>ミュート</Text>
        </Pressable>
      </View>

      {metadata.length > 0 ? (
        <View style={styles.metadataRow}>
          {metadata.map((value) => (
            <View key={value} style={styles.metadataChip}>
              <Text style={styles.metadataText}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {user.comment.trim().length > 0 ? (
        <Text style={styles.profileComment}>{user.comment.trim()}</Text>
      ) : null}

      <View style={styles.statsRow}>
        <ProfileStat
          label="小説"
          styles={styles}
          value={profile.totalNovels.toLocaleString()}
        />
        <ProfileStat
          label="シリーズ"
          styles={styles}
          value={profile.totalNovelSeries.toLocaleString()}
        />
        <ProfileStat
          label="フォロー中"
          styles={styles}
          value={profile.totalFollowUsers.toLocaleString()}
        />
      </View>

      <View style={styles.worksHeading}>
        <View>
          <Text style={styles.worksEyebrow}>NOVELS</Text>
          <Text style={styles.worksTitle}>小説作品</Text>
        </View>
        <Text style={[styles.worksCount, { color: colors.textMuted }]}>
          {profile.totalNovels.toLocaleString()}作品
        </Text>
      </View>

      <View style={styles.profileFilters}>
        <TextInput
          onChangeText={onQueryChange}
          placeholder="この作者の作品を検索"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          style={styles.profileSearchInput}
          value={query}
        />
        <View style={styles.filterSummaryRow}>
          <Text style={styles.filterSummary}>{filteredCount}作品を表示</Text>
          {(selectedTag || selectedSeriesId !== null || query) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onQueryChange('');
                onSelectTag(null);
                onSelectSeries(null);
              }}
            >
              <Text style={styles.clearFiltersText}>条件をクリア</Text>
            </Pressable>
          ) : null}
        </View>
        {availableSeries.length > 0 ? (
          <View style={styles.filterGroup}>
            <Text style={styles.filterGroupLabel}>シリーズ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterChips}>
                <FilterChip
                  active={selectedSeriesId === null}
                  label="すべて"
                  onPress={() => onSelectSeries(null)}
                  styles={styles}
                />
                {availableSeries.map((series) => (
                  <FilterChip
                    active={selectedSeriesId === series.id}
                    key={series.id}
                    label={`${series.title} · ${series.count}`}
                    onPress={() => onSelectSeries(series.id)}
                    styles={styles}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}
        {availableTags.length > 0 ? (
          <View style={styles.filterGroup}>
            <Text style={styles.filterGroupLabel}>タグ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterChips}>
                <FilterChip
                  active={selectedTag === null}
                  label="すべて"
                  onPress={() => onSelectTag(null)}
                  styles={styles}
                />
                {availableTags.map(([tagName, count]) => (
                  <FilterChip
                    active={selectedTag === tagName}
                    key={tagName}
                    label={`#${tagName} · ${count}`}
                    onPress={() => onSelectTag(tagName)}
                    styles={styles}
                  />
                ))}
                <View style={styles.downloadActions}>
          <Pressable
            accessibilityRole="button"
            disabled={isQueueLoading || filteredCount === 0}
            onPress={onDownloadFiltered}
            style={({ pressed }) => [
              styles.downloadFilteredButton,
              (isQueueLoading || filteredCount === 0) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.downloadFilteredText}>
              {isQueueLoading ? 'キューへ追加中…' : `表示中の${filteredCount}作品を保存`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isQueueLoading}
            onPress={onDownloadAll}
            style={({ pressed }) => [
              styles.downloadAllButton,
              isQueueLoading && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.downloadAllText}>作者の全作品を保存</Text>
          </Pressable>
        </View>
      </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
  styles,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
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
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProfileStat({
  label,
  styles,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
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
    listContent: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      gap: 12,
      padding: 16,
      paddingBottom: 80,
    },
    profileSection: {
      marginBottom: 6,
      gap: 14,
    },
    profileHero: {
      height: 190,
      position: 'relative',
      marginHorizontal: -16,
      marginTop: -16,
      marginBottom: 34,
      backgroundColor: colors.surfaceAlt,
    },
    profileBackground: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.surfaceAlt,
    },
    profileBackgroundPlaceholder: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.accentSoft,
    },
    profileBackgroundShade: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.18)',
    },
    profileAvatar: {
      position: 'absolute',
      left: 20,
      bottom: -38,
      width: 84,
      height: 84,
      borderWidth: 4,
      borderColor: colors.background,
      borderRadius: 42,
      backgroundColor: colors.surfaceAlt,
    },
    profileIdentity: {
      gap: 3,
    },
    profileName: {
      color: colors.text,
      fontSize: 25,
      fontWeight: '900',
      lineHeight: 33,
    },
    profileAccount: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    profileActions: { flexDirection: 'row', gap: 9, marginHorizontal: 18 },
    followButton: {
      flex: 1,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      backgroundColor: colors.accent,
    },
    followButtonActive: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    followButtonText: {
      color: colors.onAccent,
      fontSize: 13,
      fontWeight: '900',
    },
    followButtonTextActive: { color: colors.text },
    muteAuthorButton: {
      minHeight: 42,
      justifyContent: 'center',
      paddingHorizontal: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
      borderRadius: 14,
    },
    muteAuthorText: { color: colors.danger, fontSize: 11, fontWeight: '900' },
    metadataRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    metadataChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    metadataText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
    profileComment: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 21,
    },
    statsRow: {
      flexDirection: 'row',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 17,
      backgroundColor: colors.surface,
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      minHeight: 70,
      paddingHorizontal: 6,
      paddingVertical: 12,
    },
    statValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '900',
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    worksHeading: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 10,
      marginBottom: 2,
    },
    worksEyebrow: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.5,
    },
    worksTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '900',
    },
    worksCount: {
      fontSize: 11,
      fontWeight: '700',
    },
    profileFilters: { gap: 12 },
    profileSearchInput: {
      minHeight: 50,
      paddingHorizontal: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
      color: colors.text,
      backgroundColor: colors.input,
      fontSize: 13,
    },
    filterSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    filterSummary: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
    clearFiltersText: { color: colors.accentStrong, fontSize: 10, fontWeight: '900' },
    filterGroup: { gap: 7 },
    filterGroupLabel: { color: colors.text, fontSize: 11, fontWeight: '900' },
    filterChips: { flexDirection: 'row', gap: 7, paddingRight: 16 },
    filterChip: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    filterChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    filterChipText: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
    filterChipTextActive: { color: colors.accentStrong },
    downloadActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
    downloadFilteredButton: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      borderRadius: 13,
      backgroundColor: colors.accentSoft,
    },
    downloadFilteredText: { color: colors.accentStrong, fontSize: 10, fontWeight: '900' },
    downloadAllButton: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      borderRadius: 13,
      backgroundColor: colors.accent,
    },
    downloadAllText: { color: colors.onAccent, fontSize: 10, fontWeight: '900' },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      paddingHorizontal: 28,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    errorTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '900',
      textAlign: 'center',
    },
    errorText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 19,
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
      fontSize: 13,
      fontWeight: '900',
    },
    emptyCard: {
      alignItems: 'center',
      gap: 8,
      padding: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.surface,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '900',
      textAlign: 'center',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 18,
      textAlign: 'center',
    },
    footerLoading: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 22,
    },
    loadMoreError: {
      alignItems: 'center',
      gap: 6,
      padding: 18,
    },
    loadMoreRetry: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '900',
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.65,
    },
  });
}
