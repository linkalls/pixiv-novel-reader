import type { PixivNovelItem } from '@book000/pixivts';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createReaderMark,
  deleteReaderMark,
  listReaderMarks,
  updateReaderMarkNote,
  type ReaderMark,
} from '@/lib/organizer-db';

interface ReaderMarksModalProps {
  accent: string;
  background: string;
  border: string;
  currentBlockIndex: number;
  currentExcerpt: string;
  currentProgress: number;
  currentScrollOffset: number;
  detail: PixivNovelItem | null;
  muted: string;
  onClose: () => void;
  onJump: (mark: ReaderMark) => void;
  onStatus: (message: string) => void;
  overlay: string;
  text: string;
  visible: boolean;
}

export function ReaderMarksModal({
  accent,
  background,
  border,
  currentBlockIndex,
  currentExcerpt,
  currentProgress,
  currentScrollOffset,
  detail,
  muted,
  onClose,
  onJump,
  onStatus,
  overlay,
  text,
  visible,
}: ReaderMarksModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const [marks, setMarks] = useState<ReaderMark[]>([]);
  const [note, setNote] = useState('');
  const [editingMarkId, setEditingMarkId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!visible || !detail) {
      return () => {
        mounted = false;
      };
    }

    const currentDetail = detail;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const nextMarks = await listReaderMarks(currentDetail.id);
        if (mounted) {
          setMarks(nextMarks);
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
  }, [detail, visible]);

  async function saveCurrentMark() {
    if (!detail || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const id = await createReaderMark({
        detail,
        blockIndex: currentBlockIndex,
        scrollOffset: currentScrollOffset,
        progress: currentProgress,
        excerpt: currentExcerpt,
        note,
      });
      const nextMarks = await listReaderMarks(detail.id);
      setMarks(nextMarks);
      setNote('');
      onStatus(`しおりを追加したよ（${Math.round(currentProgress * 100)}%）`);
      const created = nextMarks.find((mark) => mark.id === id);
      if (created) {
        setEditingMarkId(null);
      }
    } catch (saveError) {
      setError(toErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEditedNote() {
    if (editingMarkId === null || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await updateReaderMarkNote(editingMarkId, note);
      setMarks((current) =>
        current.map((mark) =>
          mark.id === editingMarkId
            ? { ...mark, note: note.trim(), updatedAt: Date.now() }
            : mark,
        ),
      );
      setEditingMarkId(null);
      setNote('');
      onStatus('メモを更新したよ');
    } catch (saveError) {
      setError(toErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMark(markId: number) {
    try {
      await deleteReaderMark(markId);
      setMarks((current) => current.filter((mark) => mark.id !== markId));
      if (editingMarkId === markId) {
        setEditingMarkId(null);
        setNote('');
      }
      onStatus('しおりを削除したよ');
    } catch (removeError) {
      setError(toErrorMessage(removeError));
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
              <Text style={styles.eyebrow}>MARKS & NOTES</Text>
              <Text style={styles.title}>しおり・メモ</Text>
              <Text style={styles.subtitle}>
                現在位置 {Math.round(currentProgress * 100)}%
              </Text>
            </View>
            <Pressable
              accessibilityLabel="しおりを閉じる"
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

          <View style={styles.editorCard}>
            <Text numberOfLines={2} style={styles.excerpt}>
              {editingMarkId === null
                ? currentExcerpt
                : (marks.find((mark) => mark.id === editingMarkId)?.excerpt ??
                  currentExcerpt)}
            </Text>
            <TextInput
              maxLength={500}
              multiline
              onChangeText={setNote}
              placeholder="メモを入力（空でもしおりだけ保存できる）"
              placeholderTextColor={muted}
              style={styles.noteInput}
              textAlignVertical="top"
              value={note}
            />
            <View style={styles.editorActions}>
              {editingMarkId !== null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setEditingMarkId(null);
                    setNote('');
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryText}>キャンセル</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => {
                  void (editingMarkId === null
                    ? saveCurrentMark()
                    : saveEditedNote());
                }}
                style={({ pressed }) => [
                  styles.saveButton,
                  isSaving && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveText}>
                    {editingMarkId === null ? '現在位置を保存' : 'メモを更新'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={accent} />
              </View>
            ) : marks.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>まだしおりがないよ</Text>
                <Text style={styles.muted}>
                  気になった位置へメモ付きで戻れるようになる。
                </Text>
              </View>
            ) : (
              marks.map((mark) => (
                <View key={mark.id} style={styles.markCard}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onJump(mark)}
                    style={({ pressed }) => [
                      styles.markMain,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.markHeading}>
                      <Text style={styles.progressLabel}>
                        {Math.round(mark.progress * 100)}%
                      </Text>
                      <Text style={styles.dateText}>
                        {new Date(mark.updatedAt).toLocaleDateString('ja-JP')}
                      </Text>
                    </View>
                    <Text numberOfLines={3} style={styles.markExcerpt}>
                      {mark.excerpt}
                    </Text>
                    {mark.note ? (
                      <Text numberOfLines={3} style={styles.markNote}>
                        📝 {mark.note}
                      </Text>
                    ) : null}
                    <Text style={styles.jumpText}>この位置へ移動 ›</Text>
                  </Pressable>
                  <View style={styles.markActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setEditingMarkId(mark.id);
                        setNote(mark.note);
                      }}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>メモ編集</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        void removeMark(mark.id);
                      }}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.deleteText}>削除</Text>
                    </Pressable>
                  </View>
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
    sheet: {
      width: '100%',
      maxWidth: 700,
      maxHeight: '92%',
      alignSelf: 'center',
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 22,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      backgroundColor: colors.background,
    },
    handle: { width: 40, height: 4, alignSelf: 'center', borderRadius: 999, backgroundColor: colors.border },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    headerText: { flex: 1, gap: 3 },
    eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
    title: { color: colors.text, fontSize: 20, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 11 },
    closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.border },
    closeText: { color: colors.text, fontSize: 22, lineHeight: 25 },
    editorCard: { gap: 10, padding: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 15 },
    excerpt: { color: colors.text, fontSize: 12, fontWeight: '700', lineHeight: 18 },
    noteInput: { minHeight: 76, padding: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, color: colors.text, fontSize: 13, lineHeight: 19 },
    editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    secondaryButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12 },
    secondaryText: { color: colors.text, fontSize: 12, fontWeight: '800' },
    saveButton: { minWidth: 120, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.accent },
    saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
    error: { marginTop: 8, color: '#D75555', fontSize: 12, lineHeight: 18 },
    list: { gap: 10, paddingTop: 12, paddingBottom: 16 },
    loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
    empty: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
    muted: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
    markCard: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 15 },
    markMain: { gap: 7, padding: 13 },
    markHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    progressLabel: { color: colors.accent, fontSize: 11, fontWeight: '900' },
    dateText: { color: colors.muted, fontSize: 10 },
    markExcerpt: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 19 },
    markNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    jumpText: { color: colors.accent, fontSize: 11, fontWeight: '800', textAlign: 'right' },
    markActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    actionButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
    actionText: { color: colors.text, fontSize: 11, fontWeight: '800' },
    deleteText: { color: '#D75555', fontSize: 11, fontWeight: '800' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.65 },
  });
}
