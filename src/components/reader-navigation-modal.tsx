import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  ReaderSearchMatch,
  ReaderTocEntry,
} from '@/lib/reader-navigation';

export type ReaderNavigationMode = 'toc' | 'search';

interface ReaderNavigationModalProps {
  accent: string;
  background: string;
  border: string;
  matches: ReaderSearchMatch[];
  mode: ReaderNavigationMode;
  muted: string;
  onClose: () => void;
  onModeChange: (mode: ReaderNavigationMode) => void;
  onQueryChange: (query: string) => void;
  onSelectMatch: (index: number) => void;
  onSelectToc: (entry: ReaderTocEntry) => void;
  overlay: string;
  query: string;
  text: string;
  toc: ReaderTocEntry[];
  visible: boolean;
}

export function ReaderNavigationModal({
  accent,
  background,
  border,
  matches,
  mode,
  muted,
  onClose,
  onModeChange,
  onQueryChange,
  onSelectMatch,
  onSelectToc,
  overlay,
  query,
  text,
  toc,
  visible,
}: ReaderNavigationModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
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
            <Text style={styles.title}>目次・本文内検索</Text>
            <Pressable
              accessibilityLabel="目次と検索を閉じる"
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

          <View style={styles.tabs}>
            <ModeButton
              active={mode === 'toc'}
              label={`目次 ${toc.length}`}
              onPress={() => onModeChange('toc')}
              styles={styles}
            />
            <ModeButton
              active={mode === 'search'}
              label="検索"
              onPress={() => onModeChange('search')}
              styles={styles}
            />
          </View>

          {mode === 'search' ? (
            <View style={styles.searchHeader}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={onQueryChange}
                placeholder="本文から探す"
                placeholderTextColor={muted}
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
              <Text style={styles.searchCount}>
                {query.trim().length > 0 ? `${matches.length}件` : '検索語を入力'}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {mode === 'toc' ? (
              toc.map((entry, index) => (
                <Pressable
                  accessibilityRole="button"
                  key={`${entry.type}-${entry.blockIndex}-${index}`}
                  onPress={() => onSelectToc(entry)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rowIndex}>{index + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text numberOfLines={2} style={styles.rowTitle}>
                      {entry.label}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {entry.type === 'chapter'
                        ? '章'
                        : entry.type === 'page'
                          ? '改ページ'
                          : '先頭'}
                    </Text>
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </Pressable>
              ))
            ) : matches.length > 0 ? (
              matches.map((match, index) => (
                <Pressable
                  accessibilityRole="button"
                  key={`${match.blockIndex}-${match.matchIndex}-${index}`}
                  onPress={() => onSelectMatch(index)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rowIndex}>{index + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text numberOfLines={3} style={styles.preview}>
                      {match.preview || '一致した箇所'}
                    </Text>
                    <Text style={styles.rowMeta}>本文内の一致</Text>
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </Pressable>
              ))
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {query.trim().length > 0
                    ? '一致する箇所はありません'
                    : '検索語を入力してください'}
                </Text>
                <Text style={styles.emptyText}>
                  章題と本文をまとめて検索できます。
                </Text>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ModeButton({
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active && styles.tabActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
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
      maxHeight: '84%',
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
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 19,
      fontWeight: '800',
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
    tabs: {
      flexDirection: 'row',
      gap: 7,
      paddingBottom: 12,
    },
    tab: {
      flex: 1,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
    },
    tabActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    tabText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: '800',
    },
    tabTextActive: {
      color: '#FFFFFF',
    },
    searchHeader: {
      gap: 7,
      paddingBottom: 10,
    },
    searchInput: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      color: colors.text,
      backgroundColor: colors.background,
      fontSize: 15,
    },
    searchCount: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: '700',
      textAlign: 'right',
    },
    list: {
      paddingBottom: 20,
    },
    row: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowIndex: {
      width: 26,
      color: colors.muted,
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'center',
    },
    rowBody: {
      flex: 1,
      gap: 4,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '800',
      lineHeight: 20,
    },
    preview: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 20,
    },
    rowMeta: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
    },
    arrow: {
      color: colors.accent,
      fontSize: 24,
    },
    empty: {
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 22,
      paddingVertical: 48,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
      textAlign: 'center',
    },
    emptyText: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 19,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.66,
    },
  });
}
