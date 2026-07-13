import type { PixivNovelItem } from '@book000/pixivts';
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
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelCard } from '@/components/novel-card';
import {
  getNovelReadingStatuses,
  type NovelReadingStatus,
} from '@/lib/library-db';
import { cacheNovelForRoute } from '@/lib/novel-route-cache';
import {
  fetchUserNovels,
  fetchUserProfile,
  type UserProfileResult,
} from '@/lib/pixiv';
import { type AppColors, useAppTheme } from '@/theme';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isValidUserId ? null : 'ユーザーIDを読み取れませんでした',
  );
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

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
    void loadInitial();

    return () => {
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

  const listHeader = profileResult ? (
    <ProfileHeader
      colors={colors}
      profileResult={profileResult}
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
          data={novels}
          keyExtractor={(novel) => String(novel.id)}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>公開中の小説はありません</Text>
              <Text style={styles.emptyText}>
                この作者が公開している小説は、現在取得できませんでした。
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
              onTagPress={(tagName) => {
                router.push({
                  pathname: '/',
                  params: { tag: tagName },
                });
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
  colors,
  profileResult,
  styles,
}: {
  colors: AppColors;
  profileResult: UserProfileResult;
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
    </View>
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
    pressed: {
      opacity: 0.65,
    },
  });
}
