import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import {
  selectAndroidApkAsset,
  type AppUpdateAsset,
} from './app-update-assets';
import { compareVersions, normalizeVersion } from './version-utils';

const LATEST_RELEASE_API =
  'https://api.github.com/repos/linkalls/pixiv-novel-reader/releases/latest';
const RELEASES_URL =
  'https://github.com/linkalls/pixiv-novel-reader/releases';
const LAST_CHECK_KEY = 'app-update-last-checked-at';
const LAST_NOTIFIED_VERSION_KEY = 'app-update-last-notified-version';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AppUpdateInfo {
  apkAsset: AppUpdateAsset | null;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string | null;
  hasUpdate: boolean;
  shouldNotify: boolean;
}

export const CURRENT_RELEASE_HIGHLIGHTS = [
  'フォロー新着・作者フォロー・作者内検索',
  '高度検索、作者／タグミュート、ミュート解除管理',
  '読書目標、連続読書記録',
  '永続オフライン保存キューと自動バックアップ',
  '表示設定スライダー、没入表示、明るさ調整',
] as const;

export function getCurrentAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

export function getReleasesUrl(): string {
  return RELEASES_URL;
}

export async function checkForAppUpdate(
  force = false,
): Promise<AppUpdateInfo | null> {
  if (!force) {
    const rawLastCheckedAt = await SecureStore.getItemAsync(LAST_CHECK_KEY).catch(
      () => null,
    );
    const lastCheckedAt = rawLastCheckedAt ? Number(rawLastCheckedAt) : 0;
    if (
      Number.isFinite(lastCheckedAt) &&
      Date.now() - lastCheckedAt < CHECK_INTERVAL_MS
    ) {
      return null;
    }
  }

  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pixiv-novel-reader',
    },
  });
  if (!response.ok) {
    throw new Error(`更新情報を取得できませんでした (${response.status})`);
  }

  const release = (await response.json()) as {
    tag_name?: unknown;
    name?: unknown;
    body?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    assets?: unknown;
  };
  const latestVersion = normalizeVersion(
    typeof release.tag_name === 'string' ? release.tag_name : '',
  );
  if (!latestVersion) {
    throw new Error('最新バージョンを読み取れませんでした');
  }

  const currentVersion = normalizeVersion(getCurrentAppVersion()) || '0.0.0';
  const apkAsset = selectAndroidApkAsset(release.assets, latestVersion);
  const lastNotifiedVersion = await SecureStore.getItemAsync(
    LAST_NOTIFIED_VERSION_KEY,
  ).catch(() => null);
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  await SecureStore.setItemAsync(LAST_CHECK_KEY, String(Date.now()));

  return {
    apkAsset,
    currentVersion,
    latestVersion,
    releaseName:
      typeof release.name === 'string' && release.name.trim()
        ? release.name.trim()
        : `Pixiv Novel Reader v${latestVersion}`,
    releaseNotes: typeof release.body === 'string' ? release.body.trim() : '',
    releaseUrl:
      typeof release.html_url === 'string' && release.html_url
        ? release.html_url
        : RELEASES_URL,
    publishedAt:
      typeof release.published_at === 'string' ? release.published_at : null,
    hasUpdate,
    shouldNotify: hasUpdate && lastNotifiedVersion !== latestVersion,
  };
}

export async function markUpdateNotified(version: string): Promise<void> {
  const normalized = normalizeVersion(version);
  if (normalized) {
    await SecureStore.setItemAsync(LAST_NOTIFIED_VERSION_KEY, normalized);
  }
}
