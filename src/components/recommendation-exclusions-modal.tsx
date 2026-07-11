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

import {
  listRecommendationExclusions,
  restoreRecommendation,
  type RecommendationExclusion,
} from '@/lib/organizer-db';

interface RecommendationExclusionsModalProps {
  accent: string;
  background: string;
  border: string;
  muted: string;
  onClose: () => void;
  onRestored: (novelId: number) => void;
  overlay: string;
  text: string;
  visible: boolean;
}

export function RecommendationExclusionsModal({
  accent,
  background,
  border,
  muted,
  onClose,
  onRestored,
  overlay,
  text,
  visible,
}: RecommendationExclusionsModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const [items, setItems] = useState<RecommendationExclusion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!visible) {
      return () => {
        mounted = false;
      };
    }
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const nextItems = await listRecommendationExclusions();
        if (mounted) {
          setItems(nextItems);
        }
      } catch (loadError) {
        if (mounted) {
          setError(toErrorMessage(loadError));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [visible]);

  async function restore(item: RecommendationExclusion) {
    if (busyId !== null) {
      return;
    }
    setBusyId(item.novelId);
    try {
      await restoreRecommendation(item.novelId);
      setItems((current) =>
        current.filter((entry) => entry.novelId !== item.novelId),
      );
      onRestored(item.novelId);
    } catch (restoreError) {
      setError(toErrorMessage(restoreError));
    } finally {
      setBusyId(null);
    }
  }

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
              <Text style={styles.eyebrow}>RECOMMENDATIONS</Text>
              <Text style={styles.title}>おすすめ除外</Text>
              <Text style={styles.subtitle}>「興味なし」にした作品を戻せる</Text>
            </View>
            <Pressable
              accessibilityLabel="おすすめ除外を閉じる"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={accent} />
              </View>
            ) : items.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>除外した作品はないよ</Text>
                <Text style={styles.muted}>おすすめカードの「興味なし」から除外できます。</Text>
              </View>
            ) : (
              items.map((item) => (
                <View key={item.novelId} style={styles.row}>
                  <View style={styles.rowBody}>
                    <Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text>
                    <Text numberOfLines={1} style={styles.muted}>{item.authorName}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyId !== null}
                    onPress={() => {
                      void restore(item);
                    }}
                    style={({ pressed }) => [styles.restoreButton, pressed && styles.pressed]}
                  >
                    {busyId === item.novelId ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.restoreText}>戻す</Text>
                    )}
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
    sheet: { width: '100%', maxWidth: 680, maxHeight: '84%', alignSelf: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.background },
    handle: { width: 40, height: 4, alignSelf: 'center', borderRadius: 999, backgroundColor: colors.border },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    headerText: { flex: 1, gap: 3 },
    eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
    title: { color: colors.text, fontSize: 20, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 11 },
    closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.border },
    closeText: { color: colors.text, fontSize: 22, lineHeight: 25 },
    error: { marginBottom: 8, color: '#D75555', fontSize: 12, lineHeight: 18 },
    list: { paddingBottom: 18 },
    loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
    empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
    muted: { color: colors.muted, fontSize: 11, lineHeight: 17 },
    row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowBody: { flex: 1, gap: 4 },
    rowTitle: { color: colors.text, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    restoreButton: { minWidth: 62, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accent },
    restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
    pressed: { opacity: 0.65 },
  });
}
