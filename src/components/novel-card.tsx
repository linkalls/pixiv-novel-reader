import type { PixivNovelItem } from '@book000/pixivts';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface NovelCardProps {
  novel: PixivNovelItem;
  rank?: number;
  onPress: () => void;
}

export function NovelCard({ novel, rank, onPress }: NovelCardProps) {
  const tags = novel.tags
    .slice(0, 3)
    .map((tag) => `#${tag.name}`)
    .join('  ');

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
          <Text numberOfLines={1} style={styles.tags}>
            {tags}
          </Text>
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

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 13,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: '#17212B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
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
    backgroundColor: '#E8EEF3',
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
    backgroundColor: 'rgba(0, 142, 239, 0.92)',
  },
  rankText: {
    color: '#FFFFFF',
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
    color: '#20262E',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  bookmarkMark: {
    color: '#FFB000',
    fontSize: 18,
    lineHeight: 22,
  },
  author: {
    color: '#5F6B76',
    fontSize: 13,
    fontWeight: '600',
  },
  tags: {
    color: '#008DDD',
    fontSize: 11,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 9,
    marginTop: 2,
  },
  meta: {
    color: '#84909B',
    fontSize: 11,
  },
  restricted: {
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FFF0F2',
    color: '#E14555',
    fontSize: 10,
    fontWeight: '800',
  },
});
