import { useEffect, useMemo, useState } from 'react';
import {
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

import type { AdvancedSearchFilters } from '@/lib/content-preferences-db';
import { type AppColors, useAppTheme } from '@/theme';

interface AdvancedSearchModalProps {
  filters: AdvancedSearchFilters;
  onApply: (filters: AdvancedSearchFilters) => void;
  onClose: () => void;
  visible: boolean;
}

export function AdvancedSearchModal({
  filters,
  onApply,
  onClose,
  visible,
}: AdvancedSearchModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(filters);
  const [minCharacters, setMinCharacters] = useState(
    toInputValue(filters.minCharacters),
  );
  const [maxCharacters, setMaxCharacters] = useState(
    toInputValue(filters.maxCharacters),
  );
  const [minBookmarks, setMinBookmarks] = useState(
    toInputValue(filters.minBookmarks),
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      setDraft(filters);
      setMinCharacters(toInputValue(filters.minCharacters));
      setMaxCharacters(toInputValue(filters.maxCharacters));
      setMinBookmarks(toInputValue(filters.minBookmarks));
    });

    return () => cancelAnimationFrame(frameId);
  }, [filters, visible]);

  function apply() {
    onApply({
      ...draft,
      minCharacters: parseOptionalNumber(minCharacters),
      maxCharacters: parseOptionalNumber(maxCharacters),
      minBookmarks: parseOptionalNumber(minBookmarks),
    });
  }

  function reset() {
    const next: AdvancedSearchFilters = {
      minCharacters: null,
      maxCharacters: null,
      minBookmarks: null,
      includeR18: true,
      includeAi: true,
      dateRange: 'all',
      seriesMode: 'all',
      hideFinished: false,
    };
    setDraft(next);
    setMinCharacters('');
    setMaxCharacters('');
    setMinBookmarks('');
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
                <Text style={styles.eyebrow}>SEARCH FILTER</Text>
                <Text style={styles.title}>高度な検索条件</Text>
              </View>
              <Pressable
                accessibilityLabel="高度な検索条件を閉じる"
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
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>文字数</Text>
                <View style={styles.inputRow}>
                  <NumberField
                    label="最低文字数"
                    onChangeText={setMinCharacters}
                    styles={styles}
                    value={minCharacters}
                  />
                  <NumberField
                    label="最大文字数"
                    onChangeText={setMaxCharacters}
                    styles={styles}
                    value={maxCharacters}
                  />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>人気度</Text>
                <NumberField
                  label="最低ブックマーク数"
                  onChangeText={setMinBookmarks}
                  styles={styles}
                  value={minBookmarks}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>投稿期間</Text>
                <View style={styles.chipRow}>
                  {(
                    [
                      ['all', '全期間'],
                      ['week', '1週間以内'],
                      ['month', '1か月以内'],
                      ['year', '1年以内'],
                    ] as const
                  ).map(([value, label]) => (
                    <ChoiceChip
                      active={draft.dateRange === value}
                      key={value}
                      label={label}
                      onPress={() => setDraft({ ...draft, dateRange: value })}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>作品種別</Text>
                <View style={styles.chipRow}>
                  <ChoiceChip
                    active={draft.seriesMode === 'all'}
                    label="すべて"
                    onPress={() => setDraft({ ...draft, seriesMode: 'all' })}
                    styles={styles}
                  />
                  <ChoiceChip
                    active={draft.seriesMode === 'series'}
                    label="シリーズのみ"
                    onPress={() => setDraft({ ...draft, seriesMode: 'series' })}
                    styles={styles}
                  />
                  <ChoiceChip
                    active={draft.seriesMode === 'standalone'}
                    label="単発のみ"
                    onPress={() =>
                      setDraft({ ...draft, seriesMode: 'standalone' })
                    }
                    styles={styles}
                  />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>除外条件</Text>
                <ToggleRow
                  label="R-18作品を表示"
                  onPress={() =>
                    setDraft({ ...draft, includeR18: !draft.includeR18 })
                  }
                  styles={styles}
                  value={draft.includeR18}
                />
                <ToggleRow
                  label="AI生成作品を表示"
                  onPress={() =>
                    setDraft({ ...draft, includeAi: !draft.includeAi })
                  }
                  styles={styles}
                  value={draft.includeAi}
                />
                <ToggleRow
                  label="読了済みを除外"
                  onPress={() =>
                    setDraft({ ...draft, hideFinished: !draft.hideFinished })
                  }
                  styles={styles}
                  value={draft.hideFinished}
                />
              </View>

              <Text style={styles.note}>
                作者名とタグを長押しすると、検索を含むすべての一覧からミュートできる。
              </Text>
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                onPress={reset}
                style={({ pressed }) => [
                  styles.resetButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.resetText}>リセット</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={apply}
                style={({ pressed }) => [
                  styles.applyButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.applyText}>条件を適用</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NumberField({
  label,
  onChangeText,
  styles,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.numberField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        inputMode="numeric"
        keyboardType="number-pad"
        onChangeText={(next) => onChangeText(next.replace(/[^0-9]/g, ''))}
        placeholder="指定なし"
        placeholderTextColor={styles.placeholder.color}
        returnKeyType="done"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function ChoiceChip({
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
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        active && styles.choiceChipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  onPress,
  styles,
  value,
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  value: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onPress}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.switchTrack, value && styles.switchTrackActive]}>
        <View style={[styles.switchThumb, value && styles.switchThumbActive]} />
      </View>
    </Pressable>
  );
}

function toInputValue(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      maxHeight: '90%',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.surface,
    },
    handle: {
      alignSelf: 'center',
      width: 46,
      height: 5,
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
    headerText: { gap: 2 },
    eyebrow: {
      color: colors.accentStrong,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: '900' },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: colors.surfaceAlt,
    },
    closeText: { color: colors.text, fontSize: 23, lineHeight: 25 },
    content: { gap: 20, paddingHorizontal: 20, paddingBottom: 22 },
    section: { gap: 10 },
    sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
    inputRow: { flexDirection: 'row', gap: 10 },
    numberField: { flex: 1, gap: 6 },
    fieldLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
    input: {
      minHeight: 46,
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 13,
      backgroundColor: colors.background,
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    placeholder: { color: colors.placeholder },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choiceChip: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.background,
    },
    choiceChipActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    choiceText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
    choiceTextActive: { color: colors.accentStrong },
    toggleRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.background,
    },
    toggleLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
    switchTrack: {
      width: 44,
      height: 26,
      justifyContent: 'center',
      paddingHorizontal: 3,
      borderRadius: 13,
      backgroundColor: colors.border,
    },
    switchTrackActive: { backgroundColor: colors.accent },
    switchThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    switchThumbActive: { alignSelf: 'flex-end' },
    note: { color: colors.textMuted, fontSize: 10, lineHeight: 17 },
    footer: {
      flexDirection: 'row',
      gap: 10,
      padding: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    resetButton: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
    },
    resetText: { color: colors.text, fontSize: 12, fontWeight: '900' },
    applyButton: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 15,
      backgroundColor: colors.accent,
    },
    applyText: { color: colors.onAccent, fontSize: 13, fontWeight: '900' },
    pressed: { opacity: 0.65 },
  });
}
