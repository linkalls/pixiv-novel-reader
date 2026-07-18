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
  createAutomaticBackup,
  exportAppBackup,
  getAutomaticBackupState,
  pickAppBackupForPreview,
  restoreAppBackup,
  type BackupPreviewSelection,
  restoreLatestAutomaticBackup,
  setAutomaticBackupEnabled,
  shareLatestAutomaticBackup,
  type AutomaticBackupState,
} from '@/lib/app-backup';
import {
  clearReadingStatistics,
  getReadingStatistics,
  setReadingGoals,
  type ReadingStatistics,
} from '@/lib/reading-stats-db';
import { formatReadingDuration } from '@/lib/reading-stats';
import { type AppColors, useAppTheme } from '@/theme';

interface ReadingInsightsViewProps {
  onDataRestored: () => void;
  onOpenAuthor: (novelId: number) => void;
}

type BusyAction =
  | 'export'
  | 'restore'
  | 'clear'
  | 'goal'
  | 'auto-create'
  | 'auto-restore'
  | 'auto-share'
  | 'auto-toggle'
  | null;

export function ReadingInsightsView({
  onDataRestored,
  onOpenAuthor,
}: ReadingInsightsViewProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [statistics, setStatistics] = useState<ReadingStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [automaticBackup, setAutomaticBackup] =
    useState<AutomaticBackupState | null>(null);

  const loadStatistics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextStatistics, nextAutomaticBackup] = await Promise.all([
        getReadingStatistics(30),
        getAutomaticBackupState(),
      ]);
      setStatistics(nextStatistics);
      setAutomaticBackup(nextAutomaticBackup);
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

  async function chooseBackupForRestore() {
    if (busyAction) return;
    setBusyAction('restore');
    setError(null);
    try {
      const preview = await pickAppBackupForPreview();
      if (!preview) return;
      Alert.alert(
        'バックアップ内容を確認',
        formatBackupPreview(preview),
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: 'この内容を復元',
            onPress: () => void restorePreviewedBackup(preview),
          },
        ],
      );
    } catch (previewError) {
      setError(toErrorMessage(previewError));
    } finally {
      setBusyAction(null);
    }
  }

  async function restorePreviewedBackup(preview: BackupPreviewSelection) {
    if (busyAction) return;
    setBusyAction('restore');
    setError(null);
    try {
      const result = await restoreAppBackup(preview.payload);
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

  async function toggleAutomaticBackup() {
    if (busyAction) return;
    setBusyAction('auto-toggle');
    setError(null);
    try {
      await setAutomaticBackupEnabled(!automaticBackup?.enabled);
      setAutomaticBackup(await getAutomaticBackupState());
    } catch (toggleError) {
      setError(toErrorMessage(toggleError));
    } finally {
      setBusyAction(null);
    }
  }

  async function createAutoBackupNow() {
    if (busyAction) return;
    setBusyAction('auto-create');
    setError(null);
    try {
      await createAutomaticBackup();
      setAutomaticBackup(await getAutomaticBackupState());
      Alert.alert('自動バックアップを作成しました', '端末内へ安全に保存しました。');
    } catch (backupError) {
      setError(toErrorMessage(backupError));
    } finally {
      setBusyAction(null);
    }
  }

  function confirmRestoreLatestAutomaticBackup() {
    Alert.alert(
      '最新の自動バックアップへ戻しますか？',
      '現在の読書データを最新の自動バックアップ時点へ置き換えます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '復元する',
          onPress: () => void restoreLatestAutoBackup(),
        },
      ],
    );
  }

  async function restoreLatestAutoBackup() {
    if (busyAction) return;
    setBusyAction('auto-restore');
    setError(null);
    try {
      const result = await restoreLatestAutomaticBackup();
      await loadStatistics();
      onDataRestored();
      Alert.alert(
        '復元が完了しました',
        `${result.restoredRows.toLocaleString()}件を最新の自動バックアップから復元しました。`,
      );
    } catch (restoreError) {
      setError(toErrorMessage(restoreError));
    } finally {
      setBusyAction(null);
    }
  }

  async function shareLatestAutoBackup() {
    if (busyAction) return;
    setBusyAction('auto-share');
    setError(null);
    try {
      await shareLatestAutomaticBackup();
    } catch (shareError) {
      setError(toErrorMessage(shareError));
    } finally {
      setBusyAction(null);
    }
  }

  async function updateGoals(
    dailyMinutes: number,
    weeklyMinutes: number,
  ) {
    if (busyAction) return;
    setBusyAction('goal');
    setError(null);
    try {
      await setReadingGoals({ dailyMinutes, weeklyMinutes });
      await loadStatistics();
    } catch (goalError) {
      setError(toErrorMessage(goalError));
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
        <SummaryCard
          label="現在の連続読書"
          styles={styles}
          value={`${statistics?.currentStreakDays ?? 0}日`}
        />
        <SummaryCard
          label="最長連続記録"
          styles={styles}
          value={`${statistics?.longestStreakDays ?? 0}日`}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>読書目標</Text>
          <Text style={styles.sectionMeta}>タップで変更</Text>
        </View>
        <View style={styles.goalCard}>
          <GoalProgress
            currentMs={statistics?.todayDurationMs ?? 0}
            label="今日"
            targetMinutes={statistics?.dailyGoalMinutes ?? 20}
            styles={styles}
          />
          <GoalProgress
            currentMs={statistics?.last7DaysDurationMs ?? 0}
            label="直近7日"
            targetMinutes={statistics?.weeklyGoalMinutes ?? 120}
            styles={styles}
          />
          <View style={styles.goalPresetSection}>
            <Text style={styles.goalPresetLabel}>1日の目標</Text>
            <View style={styles.goalPresetRow}>
              {[15, 20, 30, 45, 60].map((minutes) => (
                <GoalPreset
                  active={(statistics?.dailyGoalMinutes ?? 20) === minutes}
                  key={`daily-${minutes}`}
                  label={`${minutes}分`}
                  onPress={() =>
                    void updateGoals(
                      minutes,
                      Math.max(
                        minutes * 5,
                        statistics?.weeklyGoalMinutes ?? 120,
                      ),
                    )
                  }
                  styles={styles}
                />
              ))}
            </View>
          </View>
          <View style={styles.goalPresetSection}>
            <Text style={styles.goalPresetLabel}>週間目標</Text>
            <View style={styles.goalPresetRow}>
              {[90, 120, 180, 240, 300, 420].map((minutes) => (
                <GoalPreset
                  active={(statistics?.weeklyGoalMinutes ?? 120) === minutes}
                  key={`weekly-${minutes}`}
                  label={formatGoalMinutes(minutes)}
                  onPress={() =>
                    void updateGoals(
                      statistics?.dailyGoalMinutes ?? 20,
                      minutes,
                    )
                  }
                  styles={styles}
                />
              ))}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>直近7日間</Text>
          <Text style={styles.sectionMeta}>
            {statistics?.daily.reduce(
              (total, day) => total + day.sessions,
              0,
            ) ?? 0}
            セッション
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
                  <Pressable
                    accessibilityLabel={`作者「${novel.authorName}」のプロフィールを開く`}
                    accessibilityRole="link"
                    onPress={() => onOpenAuthor(novel.novelId)}
                    style={({ pressed }) => [
                      styles.novelAuthorButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.novelAuthor}>
                      {novel.authorName}
                    </Text>
                    <Text style={styles.novelAuthorArrow}>›</Text>
                  </Pressable>
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
        <Text style={styles.sectionTitle}>よく読む作者</Text>
        <View style={styles.aggregateCard}>
          {(statistics?.topAuthors.length ?? 0) > 0 ? (
            statistics?.topAuthors.map((author, index) => (
              <View key={author.authorName} style={styles.aggregateRow}>
                <Text style={styles.aggregateRank}>{index + 1}</Text>
                <View style={styles.aggregateBody}>
                  <Text numberOfLines={1} style={styles.aggregateTitle}>
                    {author.authorName}
                  </Text>
                  <Text style={styles.aggregateMeta}>
                    {author.works}作品 ・ {author.finishedWorks}作品読了
                  </Text>
                </View>
                <Text style={styles.aggregateTime}>
                  {formatDateTime(author.latestReadAt)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>読書履歴から作者別に集計します。</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>よく読むタグ</Text>
        <View style={styles.tagCloud}>
          {(statistics?.topTags.length ?? 0) > 0 ? (
            statistics?.topTags.map((tag) => (
              <View key={tag.tagName} style={styles.aggregateTag}>
                <Text style={styles.aggregateTagText}>#{tag.tagName}</Text>
                <Text style={styles.aggregateTagCount}>{tag.works}作品</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>履歴に保存されたタグを集計します。</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>バックアップと復元</Text>
        <Text style={styles.sectionDescription}>
          読書履歴、本棚、しおり、ミュート、オフライン本文、統計、検索条件、表示設定をJSONファイルへ保存します。Pixivの認証情報は含みません。
        </Text>
        <View style={styles.autoBackupCard}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: automaticBackup?.enabled ?? false }}
            disabled={busyAction !== null}
            onPress={() => void toggleAutomaticBackup()}
            style={({ pressed }) => [styles.autoBackupToggle, pressed && styles.pressed]}
          >
            <View style={styles.autoBackupTextArea}>
              <Text style={styles.autoBackupTitle}>1日1回、自動バックアップ</Text>
              <Text style={styles.autoBackupMeta}>
                {automaticBackup?.latestCreatedAt
                  ? `最新 ${formatDateTime(automaticBackup.latestCreatedAt)} ・ ${automaticBackup.backupCount}世代保存`
                  : '有効化すると端末内へ最大7世代保存'}
              </Text>
            </View>
            <View
              style={[
                styles.switchTrack,
                automaticBackup?.enabled && styles.switchTrackActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  automaticBackup?.enabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </Pressable>
          <View style={styles.autoBackupActions}>
            <SmallAction
              disabled={busyAction !== null}
              label="今すぐ作成"
              onPress={() => void createAutoBackupNow()}
              styles={styles}
            />
            <SmallAction
              disabled={busyAction !== null || !automaticBackup?.latestUri}
              label="最新を復元"
              onPress={confirmRestoreLatestAutomaticBackup}
              styles={styles}
            />
            <SmallAction
              disabled={busyAction !== null || !automaticBackup?.latestUri}
              label="最新を共有"
              onPress={() => void shareLatestAutoBackup()}
              styles={styles}
            />
          </View>
        </View>
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
            onPress={() => void chooseBackupForRestore()}
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

function GoalProgress({
  currentMs,
  label,
  targetMinutes,
  styles,
}: {
  currentMs: number;
  label: string;
  targetMinutes: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const targetMs = Math.max(1, targetMinutes * 60_000);
  const progress = Math.min(1, Math.max(0, currentMs / targetMs));
  return (
    <View style={styles.goalProgressBlock}>
      <View style={styles.goalProgressHeader}>
        <Text style={styles.goalProgressLabel}>{label}</Text>
        <Text style={styles.goalProgressValue}>
          {formatReadingDuration(currentMs)} / {formatGoalMinutes(targetMinutes)}
        </Text>
      </View>
      <View style={styles.goalTrack}>
        <View style={[styles.goalValue, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.goalPercent}>{Math.round(progress * 100)}%</Text>
    </View>
  );
}

function GoalPreset({
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.goalPreset,
        active && styles.goalPresetActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.goalPresetText,
          active && styles.goalPresetTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatGoalMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}時間${remainder}分` : `${hours}時間`;
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

function SmallAction({
  disabled,
  label,
  onPress,
  styles,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.smallActionText}>{label}</Text>
    </Pressable>
  );
}

function formatBackupPreview(preview: BackupPreviewSelection): string {
  return [
    preview.fileName,
    `作成日時: ${new Date(preview.exportedAt).toLocaleString('ja-JP')}`,
    `合計: ${preview.totalRows.toLocaleString()}件`,
    '',
    `読書履歴 ${preview.counts.history}件`,
    `本棚 ${preview.counts.shelves}件`,
    `しおり ${preview.counts.marks}件`,
    `オフライン作品 ${preview.counts.offline}件`,
    `読書セッション ${preview.counts.sessions}件`,
    '',
    '現在のデータはこの内容へ置き換わります。',
  ].join('\n');
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
    goalCard: {
      gap: 17,
      padding: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    goalProgressBlock: { gap: 7 },
    goalProgressHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    goalProgressLabel: { color: colors.text, fontSize: 12, fontWeight: '900' },
    goalProgressValue: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
    goalTrack: {
      height: 9,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    goalValue: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
    goalPercent: { color: colors.accentStrong, fontSize: 10, fontWeight: '900', textAlign: 'right' },
    goalPresetSection: { gap: 8 },
    goalPresetLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
    goalPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    goalPreset: {
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 11,
      backgroundColor: colors.surfaceAlt,
    },
    goalPresetActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    goalPresetText: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
    goalPresetTextActive: { color: colors.accentStrong },
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
    novelAuthorButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      maxWidth: '100%',
    },
    novelAuthor: {
      flexShrink: 1,
      color: colors.accentStrong,
      fontSize: 10,
      fontWeight: '700',
    },
    novelAuthorArrow: {
      color: colors.accentStrong,
      fontSize: 9,
      fontWeight: '900',
    },
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
    aggregateCard: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    aggregateRow: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    aggregateRank: {
      width: 22,
      color: colors.accentStrong,
      fontSize: 13,
      fontWeight: '900',
      textAlign: 'center',
    },
    aggregateBody: { flex: 1, gap: 3 },
    aggregateTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
    aggregateMeta: { color: colors.textMuted, fontSize: 9 },
    aggregateTime: { color: colors.textMuted, fontSize: 8, textAlign: 'right' },
    tagCloud: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    aggregateTag: {
      gap: 2,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 11,
      backgroundColor: colors.accentSoft,
    },
    aggregateTagText: { color: colors.accentStrong, fontSize: 10, fontWeight: '900' },
    aggregateTagCount: { color: colors.textMuted, fontSize: 8 },
    autoBackupCard: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    autoBackupToggle: {
      minHeight: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
    },
    autoBackupTextArea: { flex: 1, gap: 3 },
    autoBackupTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
    autoBackupMeta: { color: colors.textMuted, fontSize: 10, lineHeight: 16 },
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
    autoBackupActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      padding: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    smallAction: {
      minHeight: 38,
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 11,
    },
    smallActionText: { color: colors.text, fontSize: 10, fontWeight: '800' },
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
