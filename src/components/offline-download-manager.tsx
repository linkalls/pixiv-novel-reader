import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  clearCompletedOfflineDownloads,
  getOfflineDownloadSettings,
  listOfflineDownloadQueue,
  processOfflineDownloadQueue,
  retryFailedOfflineDownloads,
  saveOfflineDownloadSettings,
  type OfflineDownloadQueueItem,
  type OfflineDownloadSettings,
} from '@/lib/offline-download-queue';
import {
  listOfflineSeriesSubscriptions,
  unsubscribeOfflineSeries,
  type OfflineSeriesSubscription,
} from '@/lib/offline-series-subscriptions';
import { type AppColors, useAppTheme } from '@/theme';

interface OfflineDownloadManagerProps {
  onChanged: () => void;
  visible: boolean;
}

const DEFAULT_SETTINGS: OfflineDownloadSettings = {
  wifiOnly: true,
  includeImages: true,
  deleteFinished: false,
};

export function OfflineDownloadManager({
  onChanged,
  visible,
}: OfflineDownloadManagerProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [items, setItems] = useState<OfflineDownloadQueueItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!visible) return;
    setIsLoading(true);
    setError(null);
    try {
      const [nextItems, nextSettings, nextSubscriptions] = await Promise.all([
        listOfflineDownloadQueue(),
        getOfflineDownloadSettings(),
        listOfflineSeriesSubscriptions(),
      ]);
      setItems(nextItems);
      setSettings(nextSettings);
      setSubscriptions(nextSubscriptions);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frameId);
  }, [load]);

  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      void listOfflineDownloadQueue()
        .then(setItems)
        .catch(() => {});
    }, 700);
    return () => clearInterval(timer);
  }, [isProcessing]);

  async function updateSettings(next: OfflineDownloadSettings) {
    setSettings(next);
    try {
      await saveOfflineDownloadSettings(next);
    } catch (saveError) {
      setError(toErrorMessage(saveError));
      await load();
    }
  }

  async function processQueue() {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      const result = await processOfflineDownloadQueue();
      if (result.blockedByWifi) {
        Alert.alert(
          'Wi-Fi接続を待っています',
          'Wi-Fi限定が有効です。接続後に自動で再開します。',
        );
      } else if (result.processed > 0) {
        Alert.alert(
          '保存処理が完了しました',
          `${result.completed}作品を保存、${result.failed}作品が失敗しました。`,
        );
      }
      await load();
      onChanged();
    } catch (processError) {
      setError(toErrorMessage(processError));
    } finally {
      setIsProcessing(false);
    }
  }

  async function retryFailed() {
    await retryFailedOfflineDownloads();
    await load();
    await processQueue();
  }

  async function clearCompleted() {
    await clearCompletedOfflineDownloads();
    await load();
  }

  async function removeSeriesSubscription(
    subscription: OfflineSeriesSubscription,
  ) {
    await unsubscribeOfflineSeries(subscription.seriesId);
    setSubscriptions((current) =>
      current.filter((item) => item.seriesId !== subscription.seriesId),
    );
  }

  const pending = items.filter(
    (item) => item.status === 'pending' || item.status === 'downloading',
  );
  const failed = items.filter((item) => item.status === 'failed');
  const completed = items.filter((item) => item.status === 'completed');

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>DOWNLOAD QUEUE</Text>
          <Text style={styles.title}>保存キュー</Text>
        </View>
        {isLoading ? <ActivityIndicator color={colors.accent} /> : null}
      </View>

      <View style={styles.settingsCard}>
        <SettingToggle
          label="Wi-Fi接続時のみ保存"
          onPress={() =>
            void updateSettings({ ...settings, wifiOnly: !settings.wifiOnly })
          }
          styles={styles}
          value={settings.wifiOnly}
        />
        <SettingToggle
          label="挿絵も保存する"
          onPress={() =>
            void updateSettings({
              ...settings,
              includeImages: !settings.includeImages,
            })
          }
          styles={styles}
          value={settings.includeImages}
        />
        <SettingToggle
          label="読了した保存作品を自動削除"
          onPress={() =>
            void updateSettings({
              ...settings,
              deleteFinished: !settings.deleteFinished,
            })
          }
          styles={styles}
          value={settings.deleteFinished}
        />
      </View>

      {subscriptions.length > 0 ? (
        <View style={styles.subscriptionSection}>
          <View style={styles.subscriptionHeading}>
            <Text style={styles.subscriptionTitle}>新話の自動保存</Text>
            <Text style={styles.subscriptionCount}>
              {subscriptions.length}シリーズ
            </Text>
          </View>
          {subscriptions.map((subscription) => (
            <View key={subscription.seriesId} style={styles.subscriptionRow}>
              <View style={styles.subscriptionBody}>
                <Text numberOfLines={1} style={styles.subscriptionName}>
                  {subscription.title}
                </Text>
                <Text style={styles.subscriptionMeta}>
                  {subscription.knownNovelIds.length}話を確認済み
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => void removeSeriesSubscription(subscription)}
                style={({ pressed }) => [
                  styles.subscriptionRemove,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.subscriptionRemoveText}>解除</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.summaryRow}>
        <QueueSummary label="待機中" value={pending.length} styles={styles} />
        <QueueSummary label="失敗" value={failed.length} styles={styles} />
        <QueueSummary label="完了" value={completed.length} styles={styles} />
      </View>

      <View style={styles.actionRow}>
        <ManagerAction
          disabled={isProcessing || pending.length === 0}
          label={isProcessing ? '保存中…' : 'キューを実行'}
          onPress={() => void processQueue()}
          primary
          styles={styles}
        />
        <ManagerAction
          disabled={isProcessing || failed.length === 0}
          label="失敗だけ再試行"
          onPress={() => void retryFailed()}
          styles={styles}
        />
        <ManagerAction
          disabled={isProcessing || completed.length === 0}
          label="完了履歴を消す"
          onPress={() => void clearCompleted()}
          styles={styles}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {items.length > 0 ? (
        <View style={styles.queueList}>
          {items.slice(0, 12).map((item) => (
            <View key={item.novelId} style={styles.queueRow}>
              <View style={styles.queueBody}>
                <Text numberOfLines={1} style={styles.queueTitle}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={styles.queueMeta}>
                  {item.authorName} ・ {statusLabel(item.status)}
                  {item.includeImages ? ' ・ 挿絵あり' : ' ・ 本文のみ'}
                  {item.attempts > 0 ? ` ・ ${item.attempts}回試行` : ''}
                </Text>
                {item.error ? (
                  <Text numberOfLines={2} style={styles.queueError}>
                    {item.error}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.statusDot,
                  item.status === 'completed' && styles.statusDotCompleted,
                  item.status === 'failed' && styles.statusDotFailed,
                  item.status === 'downloading' && styles.statusDotDownloading,
                ]}
              />
            </View>
          ))}
          {items.length > 12 ? (
            <Text style={styles.moreText}>ほか{items.length - 12}件</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.emptyText}>
          作者プロフィールやシリーズ一覧から一括保存すると、ここへ追加されます。
        </Text>
      )}
    </View>
  );
}

function SettingToggle({
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
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={[styles.switchTrack, value && styles.switchTrackActive]}>
        <View style={[styles.switchThumb, value && styles.switchThumbActive]} />
      </View>
    </Pressable>
  );
}

function QueueSummary({
  label,
  styles,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: number;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ManagerAction({
  disabled,
  label,
  onPress,
  primary = false,
  styles,
}: {
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
        styles.action,
        primary && styles.actionPrimary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function statusLabel(status: OfflineDownloadQueueItem['status']): string {
  switch (status) {
    case 'pending':
      return '待機中';
    case 'downloading':
      return '保存中';
    case 'failed':
      return '失敗';
    case 'completed':
      return '完了';
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      gap: 12,
      marginHorizontal: 14,
      marginBottom: 12,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 17,
      backgroundColor: colors.surface,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    eyebrow: {
      color: colors.accentStrong,
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    title: { color: colors.text, fontSize: 17, fontWeight: '900' },
    settingsCard: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
    },
    settingRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    settingLabel: { flex: 1, color: colors.text, fontSize: 11, fontWeight: '800' },
    switchTrack: {
      width: 42,
      height: 24,
      justifyContent: 'center',
      paddingHorizontal: 3,
      borderRadius: 12,
      backgroundColor: colors.border,
    },
    switchTrackActive: { backgroundColor: colors.accent },
    switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
    switchThumbActive: { alignSelf: 'flex-end' },
    subscriptionSection: {
      gap: 8,
      padding: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
    },
    subscriptionHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    subscriptionTitle: { color: colors.text, fontSize: 11, fontWeight: '900' },
    subscriptionCount: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
    subscriptionRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 10,
      borderRadius: 11,
      backgroundColor: colors.surface,
    },
    subscriptionBody: { flex: 1, gap: 3 },
    subscriptionName: { color: colors.text, fontSize: 10, fontWeight: '800' },
    subscriptionMeta: { color: colors.textMuted, fontSize: 8 },
    subscriptionRemove: {
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
      borderRadius: 10,
    },
    subscriptionRemoveText: { color: colors.danger, fontSize: 9, fontWeight: '900' },
    summaryRow: { flexDirection: 'row', gap: 8 },
    summaryCard: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    summaryValue: { color: colors.text, fontSize: 16, fontWeight: '900' },
    summaryLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    action: {
      minHeight: 38,
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 11,
    },
    actionPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
    actionText: { color: colors.text, fontSize: 9, fontWeight: '900' },
    actionTextPrimary: { color: colors.onAccent },
    error: { color: colors.danger, fontSize: 10, lineHeight: 16 },
    queueList: { gap: 8 },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    queueBody: { flex: 1, gap: 3 },
    queueTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
    queueMeta: { color: colors.textMuted, fontSize: 9, lineHeight: 14 },
    queueError: { color: colors.danger, fontSize: 9, lineHeight: 14 },
    statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textMuted },
    statusDotDownloading: { backgroundColor: colors.accent },
    statusDotCompleted: { backgroundColor: colors.success },
    statusDotFailed: { backgroundColor: colors.danger },
    moreText: { color: colors.textMuted, fontSize: 9, textAlign: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 10, lineHeight: 17, textAlign: 'center' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
  });
}
