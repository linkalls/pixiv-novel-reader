import Constants from 'expo-constants';
import {
  ActivityAction,
  startActivityAsync,
} from 'expo-intent-launcher';
import {
  cacheDirectory,
  createDownloadResumable,
  deleteAsync,
  getContentUriAsync,
  getInfoAsync,
} from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { AppUpdateAsset } from './app-update-assets';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export interface DownloadedUpdateApk {
  assetName: string;
  localUri: string;
  version: string;
}

export async function downloadUpdateApk(
  version: string,
  asset: AppUpdateAsset,
  onProgress?: (progress: number) => void,
): Promise<DownloadedUpdateApk> {
  if (Platform.OS !== 'android') {
    throw new Error('アプリ内更新はAndroid版でのみ利用できます');
  }
  if (!cacheDirectory) {
    throw new Error('APKの保存先を利用できません');
  }

  const safeVersion = version.replace(/[^0-9A-Za-z._-]/g, '_');
  const localUri = `${cacheDirectory}pixiv-novel-reader-update-${safeVersion}.apk`;
  const existing = await getInfoAsync(localUri).catch(() => null);
  if (existing?.exists && existing.size === asset.size && asset.size > 0) {
    onProgress?.(1);
    return { assetName: asset.name, localUri, version };
  }

  await deleteAsync(localUri, { idempotent: true }).catch(() => {});
  onProgress?.(0);

  const task = createDownloadResumable(
    asset.downloadUrl,
    localUri,
    {
      headers: {
        Accept: APK_MIME_TYPE,
        'User-Agent': 'pixiv-novel-reader',
      },
    },
    ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
      if (totalBytesExpectedToWrite > 0) {
        onProgress?.(
          Math.min(1, Math.max(0, totalBytesWritten / totalBytesExpectedToWrite)),
        );
      }
    },
  );
  const result = await task.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    await deleteAsync(localUri, { idempotent: true }).catch(() => {});
    throw new Error(
      `APKをダウンロードできませんでした (${result?.status ?? '中断'})`,
    );
  }

  const downloaded = await getInfoAsync(result.uri);
  if (!downloaded.exists || (asset.size > 0 && downloaded.size !== asset.size)) {
    await deleteAsync(localUri, { idempotent: true }).catch(() => {});
    throw new Error('ダウンロードしたAPKのサイズがRelease情報と一致しません');
  }

  onProgress?.(1);
  return { assetName: asset.name, localUri: result.uri, version };
}

export async function launchUpdateInstaller(localUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('APKのインストールはAndroid版でのみ利用できます');
  }
  const info = await getInfoAsync(localUri);
  if (!info.exists) {
    throw new Error('ダウンロード済みAPKが見つかりません');
  }

  const contentUri = await getContentUriAsync(localUri);
  await startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}

export async function openUnknownAppInstallSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const packageName = Constants.expoConfig?.android?.package;
  await startActivityAsync(ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
    data: packageName ? `package:${packageName}` : undefined,
  });
}
