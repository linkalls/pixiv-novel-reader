import type { PixivNovelItem } from '@book000/pixivts';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type AppColors, useAppTheme } from '@/theme';

interface NovelCardProps {
  novel: PixivNovelItem;
  rank?: number;
  onPress: () => void;
  onTagPress?: (tagName: string) => void;
}

export function NovelCard({
  novel,
  rank,
  onPress,
  onTagPress,
}: NovelCardProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tags = novel.tags.slice(0, 3);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.coverContainer}>
        <Image
          contentFit="cover"
          source={{
            uri: novel.imageUrls.medium || novel.imageUrls.squareMedium,
            headers: {
              Referer: 'https://app-api.pixiv.net/',
            },
          }}
          style={styles.cover}
          transition={180}
        />
        {rank !== undefined && (
          <View style={styles.rankBadge}>
            <Text style={styles.rankText}>{rank}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text numberOfLines={2} style={styles.title}>
            {novel.title}
          </Text>
          <Text style={styles.bookmarkMark}>
            {novel.isBookmarked ? '★' : '☆'}
          </Text>
        </View>

        <Text numberOfLines={1} style={styles.author}>
          {novel.user.name}
        </Text>

        {tags.length > 0 && (
          <View style={styles.tagsRow}>
            {tags.map((tag) => (
              <Pressable
                accessibilityLabel={`タグ「${tag.name}」で検索`}
                accessibilityRole="button"
                key={tag.name}
                onPress={(event) => {
                  event.stopPropagation();
                  onTagPress?.(tag.name);
                }}
                style={({ pressed }) => [
                  styles.tagChip,
                  pressed && styles.tagChipPressed,
                ]}
              >
                <Text numberOfLines={1} style={styles.tagText}>
                  #{tag.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.meta}>{novel.textLength.toLocaleString()}字</Text>
          <Text style={styles.meta}>♡ {novel.totalBookmarks.toLocaleString()}</Text>
          <Text style={styles.meta}>👁 {novel.totalView.toLocaleString()}</Text>
          {novel.xRestrict > 0 && <Text style={styles.restricted}>R-18</Text>}
        </View>
      </View>
    </Pressable>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      gap: 13,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.surface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 2,
    },
    pressed: {
      opacity: 0.76,
      transform: [{ scale: 0.992 }],
    },
    coverContainer: {
      position: 'relative',
    },
    cover: {
      width: 84,
      height: 112,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    rankBadge: {
      position: 'absolute',
      top: 6,
      left: 6,
      minWidth: 29,
      height: 29,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
      borderRadius: 10,
      backgroundColor: colors.accent,
    },
    rankText: {
      color: colors.onAccent,
      fontSize: 13,
      fontWeight: '900',
    },
    body: {
      flex: 1,
      justifyContent: 'center',
      gap: 5,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
      lineHeight: 22,
    },
    bookmarkMark: {
      color: colors.bookmark,
      fontSize: 18,
      lineHeight: 22,
    },
    author: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    tagChip: {
      maxWidth: '100%',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
    },
    tagChipPressed: {
      opacity: 0.65,
    },
    tagText: {
      color: colors.accentStrong,
      fontSize: 10,
      fontWeight: '700',
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 9,
      marginTop: 2,
    },
    meta: {
      color: colors.textMuted,
      fontSize: 11,
    },
    restricted: {
      overflow: 'hidden',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: colors.dangerSoft,
      color: colors.danger,
      fontSize: 10,
      fontWeight: '800',
    },
  });
}
