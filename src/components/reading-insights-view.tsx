import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  exportAppBackup,
  pickAndRestoreAppBackup,
} from '@/lib/app-backup';
import {
  clearReadingStatistics,
  getReadingStatistics,
  type ReadingStatistics,
} from '@/lib/reading-stats-db';
import { formatReadingDuration } from '@/lib/reading-stats';
import { type AppColors, useAppTheme } from '@/theme';

interface ReadingInsightsViewProps {
  onDataRestored: () => void;
}

type BusyAction = 'export' | 'restore' | 'clear' | null;

export function ReadingInsightsView({
  onDataRestored,
}: ReadingInsightsViewProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [statistics, setStatistics] = useState<ReadingStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatistics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatistics(await getReadingStatistics(30));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadStatistics();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStatistics]);

  async function exportBackup() {
    if (busyAction) {
      return;
    }
    setBusyAction('export');
    setError(null);
    try {
      const result = await exportAppBackup();
      Alert.alert(
        'バックアップを作成しました',
        `${result.fileName}を共有先へ保存できます。`,
      );
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    } finally {
      setBusyAction(null);
    }
  }

  function confirmRestoreBackup() {
    Alert.alert(
      'バックアップから復元しますか？',
      '現在の履歴、本棚、しおり、オフライン本文、統計、表示設定をバックアップ時点の内容へ置き換えます。認証情報は変更しません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '復元する',
          onPress: () => {
            void restoreBackup();
          },
        },
      ],
    );
  }

  async function restoreBackup() {
    if (busyAction) {
      return;
    }
    setBusyAction('restore');
    setError(null);
    try {
      const result = await pickAndRestoreAppBackup();
      if (!result) {
        return;
      }
      await loadStatistics();
      onDataRestored();
      Alert.alert(
        '復元が完了しました',
        `${result.restoredRows.toLocaleString()}件のデータを復元しました。表示設定を完全に反映するにはアプリを再起動してください。`,
      );
    } catch (restoreError) {
      setError(toErrorMessage(restoreError));
    } finally {
      setBusyAction(null);
    }
  }

  function confirmClearStatistics() {
    Alert.alert(
      '読書統計をリセットしますか？',
      '履歴、本棚、しおり、オフライン保存は削除されません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '統計をリセット',
          style: 'destructive',
          onPress: () => {
            void clearStatistics();
          },
        },
      ],
    );
  }

  async function clearStatistics() {
    if (busyAction) {
      return;
    }
    setBusyAction('clear');
    try {
      await clearReadingStatistics();
      await loadStatistics();
    } catch (clearError) {
      setError(toErrorMessage(clearError));
    } finally {
      setBusyAction(null);
    }
  }

  if (isLoading && !statistics) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>読書統計を集計中…</Text>
      </View>
    );
  }

  const maximumDailyDuration = Math.max(
    1,
    ...(statistics?.daily.map((day) => day.durationMs) ?? [1]),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={() => void loadStatistics()}
          refreshing={isLoading}
          tintColor={colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>READING INSIGHTS</Text>
        <Text style={styles.title}>読書統計</Text>
        <Text style={styles.subtitle}>直近30日間の読書状況</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.summaryGrid}>
        <SummaryCard
          label="今日"
          styles={styles}
          value={formatReadingDuration(statistics?.todayDurationMs ?? 0)}
        />
        <SummaryCard
          label="直近7日"
          styles={styles}
          value={formatReadingDuration(statistics?.last7DaysDurationMs ?? 0)}
        />
        <SummaryCard
          label="直近30日"
          styles={styles}
          value={formatReadingDuration(statistics?.totalDurationMs ?? 0)}
        />
        <SummaryCard
          label="推定読書文字数"
          styles={styles}
          value={`${(statistics?.charactersRead ?? 0).toLocaleString()}字`}
        />
        <SummaryCard
          label="読んだ作品"
          styles={styles}
          value={`${statistics?.uniqueNovels ?? 0}作品`}
        />
        <SummaryCard
          label="読了作品"
          styles={styles}
          value={`${statistics?.finishedNovels ?? 0}作品`}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>直近7日間</Text>
          <Text style={styles.sectionMeta}>
            {statistics?.sessionCount ?? 0}セッション
          </Text>
        </View>
        <View style={styles.chartCard}>
          {(statistics?.daily ?? []).map((day) => (
            <View key={day.date} style={styles.chartRow}>
              <Text style={styles.chartDate}>{formatDateLabel(day.date)}</Text>
              <View style={styles.chartTrack}>
                <View
                  style={[
                    styles.chartValue,
                    {
                      width: `${Math.max(
                        day.durationMs > 0 ? 3 : 0,
                        (day.durationMs / maximumDailyDuration) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.chartDuration}>
                {day.durationMs > 0
                  ? formatReadingDuration(day.durationMs)
                  : '—'}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>よく読んだ作品</Text>
        <View style={styles.rankingCard}>
          {(statistics?.topNovels.length ?? 0) > 0 ? (
            statistics?.topNovels.map((novel, index) => (
              <View key={novel.novelId} style={styles.rankingRow}>
                <Text style={styles.rank}>{index + 1}</Text>
                <View style={styles.rankingBody}>
                  <Text numberOfLines={2} style={styles.novelTitle}>
                    {novel.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.novelAuthor}>
                    {novel.authorName}
                  </Text>
                </View>
                <View style={styles.rankingValue}>
                  <Text style={styles.rankingDuration}>
                    {formatReadingDuration(novel.durationMs)}
                  </Text>
                  <Text style={styles.rankingCharacters}>
                    {novel.charactersRead.toLocaleString()}字
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>
              5秒以上読書すると統計へ記録されます。
            </Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>バックアップと復元</Text>
        <Text style={styles.sectionDescription}>
          読書履歴、本棚、しおり、オフライン本文、統計、表示設定をJSONファイルへ保存します。Pixivの認証情報は含みません。
        </Text>
        <View style={styles.actionCard}>
          <InsightAction
            busy={busyAction === 'export'}
            disabled={busyAction !== null}
            label="バックアップを書き出す"
            onPress={() => void exportBackup()}
            primary
            styles={styles}
          />
          <InsightAction
            busy={busyAction === 'restore'}
            disabled={busyAction !== null}
            label="バックアップから復元"
            onPress={confirmRestoreBackup}
            styles={styles}
          />
          <InsightAction
            busy={busyAction === 'clear'}
            danger
            disabled={busyAction !== null}
            label="読書統計をリセット"
            onPress={confirmClearStatistics}
            styles={styles}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function SummaryCard({
  label,
  styles,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function InsightAction({
  busy,
  danger = false,
  disabled,
  label,
  onPress,
  primary = false,
  styles,
}: {
  busy: boolean;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
  primary?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.actionButtonPrimary,
        danger && styles.actionButtonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={primary ? '#FFFFFF' : danger ? styles.actionDangerText.color : styles.actionText.color}
          size="small"
        />
      ) : null}
      <Text
        style={[
          styles.actionText,
          primary && styles.actionPrimaryText,
          danger && styles.actionDangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatDateLabel(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 30,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 21,
    },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      gap: 24,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 80,
    },
    heading: { gap: 3 },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.5,
    },
    title: { color: colors.text, fontSize: 25, fontWeight: '900' },
    subtitle: { color: colors.textMuted, fontSize: 12 },
    error: {
      padding: 13,
      borderRadius: 12,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 19,
      backgroundColor: colors.dangerSoft,
    },
    summaryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    summaryCard: {
      minWidth: '30%',
      flexGrow: 1,
      gap: 4,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
      backgroundColor: colors.surface,
    },
    summaryValue: { color: colors.text, fontSize: 18, fontWeight: '900' },
    summaryLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
    section: { gap: 11 },
    sectionHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
    sectionMeta: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
    sectionDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
    chartCard: {
      gap: 11,
      padding: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    chartRow: {
      minHeight: 25,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    chartDate: { width: 34, color: colors.textMuted, fontSize: 10 },
    chartTrack: {
      flex: 1,
      height: 8,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    chartValue: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    chartDuration: {
      width: 60,
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '700',
      textAlign: 'right',
    },
    rankingCard: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    rankingRow: {
      minHeight: 70,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rank: {
      width: 22,
      color: colors.accent,
      fontSize: 16,
      fontWeight: '900',
      textAlign: 'center',
    },
    rankingBody: { flex: 1, gap: 3 },
    novelTitle: { color: colors.text, fontSize: 12, fontWeight: '800', lineHeight: 18 },
    novelAuthor: { color: colors.textMuted, fontSize: 10 },
    rankingValue: { alignItems: 'flex-end', gap: 3 },
    rankingDuration: { color: colors.text, fontSize: 11, fontWeight: '800' },
    rankingCharacters: { color: colors.textMuted, fontSize: 9 },
    emptyText: {
      padding: 22,
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 18,
      textAlign: 'center',
    },
    actionCard: {
      gap: 9,
      padding: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    actionButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 13,
    },
    actionButtonPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
    actionButtonDanger: { borderColor: colors.danger },
    actionText: { color: colors.text, fontSize: 12, fontWeight: '800' },
    actionPrimaryText: { color: '#FFFFFF' },
    actionDangerText: { color: colors.danger },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.65 },
  });
}
