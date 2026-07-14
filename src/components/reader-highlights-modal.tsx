import type { PixivNovelItem } from '@book000/pixivts';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createReaderHighlight,
  deleteReaderHighlight,
  listReaderHighlights,
  type ReaderHighlight,
  type ReaderHighlightColor,
} from '@/lib/reader-highlights-db';

interface ReaderHighlightsModalProps {
  accent: string;
  background: string;
  border: string;
  currentBlockIndex: number;
  currentExcerpt: string;
  detail: PixivNovelItem | null;
  muted: string;
  onClose: () => void;
  onJump: (highlight: ReaderHighlight) => void;
  onStatus: (message: string) => void;
  overlay: string;
  text: string;
  visible: boolean;
}

const COLOR_OPTIONS: { value: ReaderHighlightColor; label: string; color: string }[] = [
  { value: 'yellow', label: '黄', color: '#F5D547' },
  { value: 'blue', label: '青', color: '#70B7FF' },
  { value: 'pink', label: '桃', color: '#FF91B8' },
  { value: 'green', label: '緑', color: '#72D69B' },
];

export function ReaderHighlightsModal({
  accent,
  background,
  border,
  currentBlockIndex,
  currentExcerpt,
  detail,
  muted,
  onClose,
  onJump,
  onStatus,
  overlay,
  text,
  visible,
}: ReaderHighlightsModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const [items, setItems] = useState<ReaderHighlight[]>([]);
  const [note, setNote] = useState('');
  const [color, setColor] = useState<ReaderHighlightColor>('yellow');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !detail) {
      return;
    }

    let isActive = true;
    const frameId = requestAnimationFrame(() => {
      setNote('');
      setError(null);
      setIsLoading(true);
      void listReaderHighlights(detail.id)
        .then((highlights) => {
          if (isActive) setItems(highlights);
        })
        .catch((loadError) => {
          if (isActive) setError(toErrorMessage(loadError));
        })
        .finally(() => {
          if (isActive) setIsLoading(false);
        });
    });

    return () => {
      isActive = false;
      cancelAnimationFrame(frameId);
    };
  }, [detail, visible]);

  async function save() {
    if (!detail || !currentExcerpt.trim() || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await createReaderHighlight({
        detail,
        blockIndex: currentBlockIndex,
        excerpt: currentExcerpt,
        note,
        color,
      });
      setItems(await listReaderHighlights(detail.id));
      setNote('');
      onStatus('ハイライトを保存しました');
    } catch (saveError) {
      setError(toErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(highlight: ReaderHighlight) {
    await deleteReaderHighlight(highlight.id);
    setItems((current) => current.filter((item) => item.id !== highlight.id));
    onStatus('ハイライトを削除しました');
  }

  async function copy(highlight: ReaderHighlight) {
    await Clipboard.setStringAsync(buildQuote(highlight, detail));
    onStatus('引用文をコピーしました');
  }

  async function share(highlight: ReaderHighlight) {
    await Share.share({
      message: buildQuote(highlight, detail),
      title: detail?.title ?? highlight.title,
    });
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <Pressable onPress={onClose} style={styles.backdrop}>
          <Pressable onPress={() => {}} style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>HIGHLIGHTS</Text>
                <Text style={styles.title}>ハイライト・引用</Text>
                <Text style={styles.subtitle}>本文を長押しして段落を選択</Text>
              </View>
              <Pressable
                accessibilityLabel="ハイライトを閉じる"
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

            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.composer}>
                <Text style={styles.sectionTitle}>現在の段落</Text>
                <Text numberOfLines={6} style={styles.currentExcerpt}>
                  {currentExcerpt || '本文を長押しすると、ここに選択した段落が表示される。'}
                </Text>
                <View style={styles.colorRow}>
                  {COLOR_OPTIONS.map((option) => (
                    <Pressable
                      accessibilityLabel={`ハイライト色 ${option.label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: color === option.value }}
                      key={option.value}
                      onPress={() => setColor(option.value)}
                      style={({ pressed }) => [
                        styles.colorButton,
                        { backgroundColor: option.color },
                        color === option.value && styles.colorButtonActive,
                        pressed && styles.pressed,
                      ]}
                    />
                  ))}
                </View>
                <TextInput
                  multiline
                  onChangeText={setNote}
                  placeholder="この引用へのメモ（任意）"
                  placeholderTextColor={muted}
                  style={styles.noteInput}
                  textAlignVertical="top"
                  value={note}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!detail || !currentExcerpt.trim() || isSaving}
                  onPress={() => void save()}
                  style={({ pressed }) => [
                    styles.saveButton,
                    (!detail || !currentExcerpt.trim() || isSaving) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveText}>この段落を保存</Text>
                  )}
                </Pressable>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.listSection}>
                <Text style={styles.sectionTitle}>保存済み</Text>
                {isLoading ? (
                  <ActivityIndicator color={accent} />
                ) : items.length === 0 ? (
                  <Text style={styles.empty}>まだハイライトはありません。</Text>
                ) : (
                  items.map((item) => {
                    const option = COLOR_OPTIONS.find(
                      (candidate) => candidate.value === item.color,
                    );
                    return (
                      <View key={item.id} style={styles.card}>
                        <View
                          style={[
                            styles.colorBar,
                            { backgroundColor: option?.color ?? '#F5D547' },
                          ]}
                        />
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => onJump(item)}
                          style={({ pressed }) => [
                            styles.cardBody,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.excerpt}>{item.excerpt}</Text>
                          {item.note ? (
                            <Text style={styles.note}>{item.note}</Text>
                          ) : null}
                          <Text style={styles.position}>本文位置 #{item.blockIndex + 1}</Text>
                        </Pressable>
                        <View style={styles.actions}>
                          <Action label="コピー" onPress={() => void copy(item)} styles={styles} />
                          <Action label="共有" onPress={() => void share(item)} styles={styles} />
                          <Action danger label="削除" onPress={() => void remove(item)} styles={styles} />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Action({
  danger = false,
  label,
  onPress,
  styles,
}: {
  danger?: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

function buildQuote(
  highlight: ReaderHighlight,
  detail: PixivNovelItem | null,
): string {
  const title = detail?.title ?? highlight.title;
  const author = detail?.user.name ?? highlight.authorName;
  const url = `https://www.pixiv.net/novel/show.php?id=${highlight.novelId}`;
  return `「${highlight.excerpt}」\n— ${title} / ${author}\n${url}`;
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
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      maxHeight: '94%',
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.background,
    },
    handle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      marginTop: 9,
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 12,
    },
    headerText: { flex: 1, gap: 2 },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.3,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 10 },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: colors.border,
    },
    closeText: { color: colors.text, fontSize: 23, lineHeight: 25 },
    content: { gap: 20, paddingHorizontal: 18, paddingBottom: 36 },
    composer: {
      gap: 10,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
    },
    sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
    currentExcerpt: { color: colors.text, fontSize: 13, lineHeight: 21 },
    colorRow: { flexDirection: 'row', gap: 12 },
    colorButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    colorButtonActive: { borderColor: colors.text },
    noteInput: {
      minHeight: 76,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      color: colors.text,
      fontSize: 12,
      lineHeight: 18,
    },
    saveButton: {
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 13,
      backgroundColor: colors.accent,
    },
    saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
    error: { color: '#E95464', fontSize: 11, lineHeight: 18 },
    listSection: { gap: 10 },
    empty: { color: colors.muted, fontSize: 11, paddingVertical: 16 },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
    },
    colorBar: { height: 5 },
    cardBody: { gap: 6, padding: 13 },
    excerpt: { color: colors.text, fontSize: 12, lineHeight: 19 },
    note: { color: colors.muted, fontSize: 11, lineHeight: 17 },
    position: { color: colors.accent, fontSize: 9, fontWeight: '800' },
    actions: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    action: { flex: 1, alignItems: 'center', paddingVertical: 10 },
    actionText: { color: colors.accent, fontSize: 10, fontWeight: '900' },
    danger: { color: '#E95464' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.62 },
  });
}
