import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  checkForAppUpdate,
  CURRENT_RELEASE_HIGHLIGHTS,
  getCurrentAppVersion,
  getReleasesUrl,
  markUpdateNotified,
  type AppUpdateInfo,
} from '@/lib/app-update';
import {
  cleanupInstalledUpdateApk,
  downloadUpdateApk,
  launchUpdateInstaller,
  openUnknownAppInstallSettings,
  type DownloadedUpdateApk,
} from '@/lib/app-installer';
import {
  isNewContentNotificationEnabled,
  setNewContentNotificationEnabled,
} from '@/lib/app-notifications';
import { disconnectPixiv } from '@/lib/pixiv';
import { clearRecentSearchHistory } from '@/lib/search-history-db';
import { type AppColors, type ThemeMode, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';
const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '端末設定' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, mode: themeMode, setMode: setThemeMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isNewContentNotificationOn, setIsNewContentNotificationOn] = useState(false);
  const [isNotificationSaving, setIsNotificationSaving] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);
  const [downloadedUpdateApk, setDownloadedUpdateApk] =
    useState<DownloadedUpdateApk | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.all([
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      isNewContentNotificationEnabled(),
    ]).then(([token, notificationEnabled]) => {
      if (!active) return;
      setHasSession(Boolean(token));
      setIsNewContentNotificationOn(notificationEnabled);
    });

    return () => {
      active = false;
    };
  }, []);

  async function toggleNewContentNotifications() {
    if (isNotificationSaving) return;
    const nextValue = !isNewContentNotificationOn;
    setIsNotificationSaving(true);
    setIsNewContentNotificationOn(nextValue);

    try {
      await setNewContentNotificationEnabled(nextValue);
    } catch (error) {
      setIsNewContentNotificationOn(!nextValue);
      Alert.alert('通知設定を変更できませんでした', toErrorMessage(error));
    } finally {
      setIsNotificationSaving(false);
    }
  }

  async function checkAppUpdate() {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);

    try {
      const info = await checkForAppUpdate(true);
      if (!info) return;
      setAppUpdateInfo(info);
      if (info.shouldNotify) {
        await markUpdateNotified(info.latestVersion);
      }
      if (!info.hasUpdate) {
        Alert.alert('最新版です', `v${info.currentVersion}を利用中です。`);
      }
    } catch (error) {
      Alert.alert('更新を確認できませんでした', toErrorMessage(error));
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function installAppUpdate(info: AppUpdateInfo) {
    if (isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateDownloadProgress(0);
    let downloaded: DownloadedUpdateApk | null = downloadedUpdateApk;

    try {
      if (!downloaded || downloaded.version !== info.latestVersion) {
        if (!info.apkAsset) {
          throw new Error('このReleaseに対応するAPKがありません');
        }
        downloaded = await downloadUpdateApk(
          info.latestVersion,
          info.apkAsset,
          setUpdateDownloadProgress,
        );
        setDownloadedUpdateApk(downloaded);
      }
      await launchUpdateInstaller(downloaded.localUri);
    } catch (error) {
      Alert.alert(
        downloaded
          ? 'インストーラーを起動できませんでした'
          : 'APKをダウンロードできませんでした',
        `${toErrorMessage(error)}\n\n提供元が未許可の場合は設定を開いてください。`,
        [
          { text: '閉じる', style: 'cancel' },
          ...(downloaded
            ? [
                {
                  text: '提供元の許可設定',
                  onPress: () => void openUnknownAppInstallSettings(),
                },
              ]
            : []),
          {
            text: 'Releaseを開く',
            onPress: () => void Linking.openURL(info.releaseUrl),
          },
        ],
      );
    } finally {
      setIsInstallingUpdate(false);
    }
  }

  async function logout() {
    disconnectPixiv();
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
    setHasSession(false);
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Text style={styles.headerButtonText}>‹ 戻る</Text>
        </Pressable>
        <View style={styles.headerTextArea}>
          <Text style={styles.eyebrow}>APP SETTINGS</Text>
          <Text style={styles.headerTitle}>設定</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Section title="アカウント" styles={styles}>
          <Text style={styles.description}>
            {hasSession === null
              ? '確認中…'
              : hasSession
                ? 'Pixivへ接続済み'
                : 'オフラインモードで利用中'}
          </Text>
          <Text style={styles.note}>
            認証情報は端末内だけに保存されます。ログアウトするとrefresh tokenを削除します。
          </Text>
        </Section>

        <Section title="表示" styles={styles}>
          <View style={styles.chipRow}>
            {THEME_OPTIONS.map((option) => (
              <Pressable
                accessibilityRole="button"
                key={option.value}
                onPress={() => setThemeMode(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  themeMode === option.value && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    themeMode === option.value && styles.chipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>現在は{isDark ? 'ダーク' : 'ライト'}表示</Text>
        </Section>

        <Section title="通知" styles={styles}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: isNewContentNotificationOn }}
            disabled={isNotificationSaving}
            onPress={() => void toggleNewContentNotifications()}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <View style={styles.actionTextArea}>
              <Text style={styles.actionTitle}>フォロー新着・シリーズ新話</Text>
              <Text style={styles.actionDescription}>
                アプリ起動時と復帰時に新着を検出した場合だけ通知します。
              </Text>
            </View>
            <View
              style={[
                styles.switchTrack,
                isNewContentNotificationOn && styles.switchTrackActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  isNewContentNotificationOn && styles.switchThumbActive,
                ]}
              />
            </View>
          </Pressable>
        </Section>

        <Section title="ライブラリとデータ" styles={styles}>
          <SettingsAction
            description="履歴、本棚、しおり、保存作品、統計、バックアップ"
            label="ライブラリ管理"
            onPress={() => router.replace({ pathname: '/', params: { tab: 'library' } })}
            styles={styles}
          />
          <SettingsAction
            description="ピン留め以外の履歴を削除"
            label="検索履歴を整理"
            onPress={() => {
              Alert.alert(
                '検索履歴を削除',
                'ピン留めした検索は残し、通常の検索履歴だけ削除します。',
                [
                  { text: 'キャンセル', style: 'cancel' },
                  {
                    text: '削除',
                    style: 'destructive',
                    onPress: () => void clearRecentSearchHistory(),
                  },
                ],
              );
            }}
            styles={styles}
          />
          <SettingsAction
            description="インストール済みの古いAPKを削除"
            label="更新ファイルを整理"
            onPress={() => {
              void cleanupInstalledUpdateApk()
                .then(() => Alert.alert('整理完了', '古い更新用APKを削除しました。'))
                .catch((error) =>
                  Alert.alert('整理できませんでした', toErrorMessage(error)),
                );
            }}
            styles={styles}
          />
        </Section>

        <Section title="アプリ情報" styles={styles}>
          <View style={styles.versionRow}>
            <Text style={styles.description}>現在 v{getCurrentAppVersion()}</Text>
            {appUpdateInfo?.hasUpdate ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>v{appUpdateInfo.latestVersion}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.changelogCard}>
            {CURRENT_RELEASE_HIGHLIGHTS.map((highlight) => (
              <View key={highlight} style={styles.changelogRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.changelogText}>{highlight}</Text>
              </View>
            ))}
          </View>
          <View style={styles.updateActions}>
            <Pressable
              accessibilityRole="button"
              disabled={isCheckingUpdate || isInstallingUpdate}
              onPress={() => {
                if (appUpdateInfo?.hasUpdate) {
                  void installAppUpdate(appUpdateInfo);
                } else {
                  void checkAppUpdate();
                }
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                (isCheckingUpdate || isInstallingUpdate) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {isCheckingUpdate ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isInstallingUpdate
                    ? `ダウンロード中 ${Math.round(updateDownloadProgress * 100)}%`
                    : appUpdateInfo?.hasUpdate
                      ? downloadedUpdateApk?.version === appUpdateInfo.latestVersion
                        ? 'インストールを再開'
                        : `v${appUpdateInfo.latestVersion}へ更新`
                      : '更新を確認'}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                void Linking.openURL(appUpdateInfo?.releaseUrl ?? getReleasesUrl())
              }
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>Release一覧</Text>
            </Pressable>
          </View>
        </Section>

        <Pressable
          accessibilityRole="button"
          disabled={!hasSession}
          onPress={() => void logout()}
          style={({ pressed }) => [
            styles.logoutButton,
            !hasSession && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.logoutButtonText}>ログアウト</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  children,
  title,
  styles,
}: {
  children: ReactNode;
  title: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SettingsAction({
  description,
  label,
  onPress,
  styles,
}: {
  description: string;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
    >
      <View style={styles.actionTextArea}>
        <Text style={styles.actionTitle}>{label}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Text style={styles.actionArrow}>›</Text>
    </Pressable>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    header: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    headerButton: { minWidth: 76, paddingVertical: 10 },
    headerButtonText: { color: colors.accent, fontSize: 15, fontWeight: '900' },
    headerTextArea: { flex: 1, alignItems: 'center' },
    eyebrow: { color: colors.accentStrong, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
    headerTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
    headerSpacer: { width: 76 },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      gap: 16,
      padding: 18,
      paddingBottom: 56,
    },
    section: {
      gap: 11,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.surface,
    },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
    description: { color: colors.textSecondary, fontSize: 14, fontWeight: '800' },
    note: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.surfaceAlt },
    chipActive: { backgroundColor: colors.accent },
    chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
    chipTextActive: { color: colors.onAccent },
    actionRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
    },
    actionTextArea: { flex: 1, gap: 3 },
    actionTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
    actionDescription: { color: colors.textMuted, fontSize: 10, lineHeight: 16 },
    actionArrow: { color: colors.accent, fontSize: 24, fontWeight: '700' },
    switchTrack: { width: 44, height: 26, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 13, backgroundColor: colors.border },
    switchTrackActive: { backgroundColor: colors.accent },
    switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface },
    switchThumbActive: { alignSelf: 'flex-end' },
    versionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.accentSoft },
    badgeText: { color: colors.accentStrong, fontSize: 10, fontWeight: '900' },
    changelogCard: { gap: 7, padding: 12, borderRadius: 13, backgroundColor: colors.surfaceAlt },
    changelogRow: { flexDirection: 'row', gap: 7 },
    bullet: { color: colors.accentStrong, fontSize: 12, fontWeight: '900' },
    changelogText: { flex: 1, color: colors.textMuted, fontSize: 10, lineHeight: 16 },
    updateActions: { flexDirection: 'row', gap: 8 },
    primaryButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accent },
    primaryButtonText: { color: colors.onAccent, fontSize: 12, fontWeight: '900' },
    secondaryButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 13 },
    secondaryButtonText: { color: colors.text, fontSize: 12, fontWeight: '900' },
    logoutButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.dangerSoft },
    logoutButtonText: { color: colors.danger, fontSize: 14, fontWeight: '900' },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
  });
}
