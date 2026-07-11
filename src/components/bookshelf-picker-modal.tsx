import type { PixivNovelItem } from '@book000/pixivts';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createBookshelf,
  listBookshelfMemberships,
  listBookshelves,
  setNovelInBookshelf,
  type Bookshelf,
} from '@/lib/organizer-db';

interface BookshelfPickerModalProps {
  accent: string;
  background: string;
  border: string;
  detail: PixivNovelItem | null;
  muted: string;
  onClose: () => void;
  onStatus: (message: string) => void;
  overlay: string;
  text: string;
  visible: boolean;
}

export function BookshelfPickerModal({
  accent,
  background,
  border,
  detail,
  muted,
  onClose,
  onStatus,
  overlay,
  text,
  visible,
}: BookshelfPickerModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const [shelves, setShelves] = useState<Bookshelf[]>([]);
  const [memberships, setMemberships] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [busyShelfId, setBusyShelfId] = useState<number | null>(null);
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
        const [nextShelves, nextMemberships] = await Promise.all([
          listBookshelves(),
          listBookshelfMemberships(currentDetail.id),
        ]);
        if (mounted) {
          setShelves(nextShelves);
          setMemberships(nextMemberships);
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

  function closeModal() {
    Keyboard.dismiss();
    onClose();
  }

  async function toggleShelf(shelf: Bookshelf) {
    if (!detail || busyShelfId !== null) {
      return;
    }

    const shouldInclude = !memberships.has(shelf.id);
    const previous = memberships;
    const optimistic = new Set(previous);
    if (shouldInclude) {
      optimistic.add(shelf.id);
    } else {
      optimistic.delete(shelf.id);
    }
    setMemberships(optimistic);
    setBusyShelfId(shelf.id);

    try {
      await setNovelInBookshelf(shelf.id, detail, shouldInclude);
      setShelves((current) =>
        current.map((item) =>
          item.id === shelf.id
            ? {
                ...item,
                itemCount: Math.max(
                  0,
                  item.itemCount + (shouldInclude ? 1 : -1),
                ),
              }
            : item,
        ),
      );
      onStatus(
        shouldInclude
          ? `「${shelf.name}」へ追加したよ`
          : `「${shelf.name}」から外したよ`,
      );
    } catch (toggleError) {
      setMemberships(previous);
      setError(toErrorMessage(toggleError));
    } finally {
      setBusyShelfId(null);
    }
  }

  async function addShelf() {
    if (!detail || newName.trim().length === 0 || busyShelfId !== null) {
      return;
    }

    setBusyShelfId(-1);
    setError(null);
    try {
      const created = await createBookshelf(newName);
      await setNovelInBookshelf(created.id, detail, true);
      setShelves((current) => [...current, { ...created, itemCount: 1 }]);
      setMemberships((current) => new Set(current).add(created.id));
      setNewName('');
      Keyboard.dismiss();
      onStatus(`「${created.name}」を作って追加したよ`);
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setBusyShelfId(null);
    }
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={closeModal}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.keyboardAvoider}
      >
        <Pressable onPress={closeModal} style={styles.backdrop}>
          <Pressable onPress={() => {}} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>BOOKSHELVES</Text>
              <Text style={styles.title}>本棚に追加</Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {detail?.title ?? '作品'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="本棚を閉じる"
              accessibilityRole="button"
              onPress={closeModal}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={accent} />
              <Text style={styles.muted}>本棚を読み込んでる…</Text>
            </View>
          ) : (
            <ScrollView
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={styles.list}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              style={styles.scrollArea}
              showsVerticalScrollIndicator={false}
            >
              {shelves.map((shelf) => {
                const selected = memberships.has(shelf.id);
                const busy = busyShelfId === shelf.id;
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: busy }}
                    disabled={busyShelfId !== null}
                    key={shelf.id}
                    onPress={() => {
                      void toggleShelf(shelf);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      selected && styles.rowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selected && styles.checkboxSelected,
                      ]}
                    >
                      <Text style={styles.checkText}>{selected ? '✓' : ''}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{shelf.name}</Text>
                      <Text style={styles.muted}>{shelf.itemCount}作品</Text>
                    </View>
                    {busy ? <ActivityIndicator color={accent} size="small" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.createArea}>
            <TextInput
              maxLength={40}
              onChangeText={setNewName}
              onSubmitEditing={() => {
                void addShelf();
              }}
              placeholder="新しい本棚の名前"
              placeholderTextColor={muted}
              returnKeyType="done"
              style={styles.input}
              value={newName}
            />
            <Pressable
              accessibilityRole="button"
              disabled={newName.trim().length === 0 || busyShelfId !== null}
              onPress={() => {
                void addShelf();
              }}
              style={({ pressed }) => [
                styles.createButton,
                (newName.trim().length === 0 || busyShelfId !== null) &&
                  styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.createButtonText}>作成</Text>
            </Pressable>
          </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE')
    ? '同じ名前の本棚があるよ'
    : message;
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
    keyboardAvoider: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      width: '100%',
      maxWidth: 680,
      maxHeight: '86%',
      alignSelf: 'center',
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 24,
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    headerText: { flex: 1, gap: 3 },
    eyebrow: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.4,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 11 },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: colors.border,
    },
    closeText: { color: colors.text, fontSize: 22, lineHeight: 25 },
    error: {
      marginBottom: 8,
      padding: 10,
      borderRadius: 10,
      color: '#D75555',
      backgroundColor: '#D7555514',
      fontSize: 12,
      lineHeight: 18,
    },
    loading: {
      minHeight: 180,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    scrollArea: {
      flexShrink: 1,
    },
    list: { paddingBottom: 8 },
    row: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowSelected: { backgroundColor: `${colors.accent}12` },
    checkbox: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 7,
    },
    checkboxSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    checkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
    rowBody: { flex: 1, gap: 3 },
    rowTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
    muted: { color: colors.muted, fontSize: 11 },
    createArea: {
      flexDirection: 'row',
      gap: 9,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      minHeight: 46,
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 13,
      color: colors.text,
      fontSize: 14,
    },
    createButton: {
      minWidth: 74,
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 13,
      backgroundColor: colors.accent,
    },
    createButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
  });
}
