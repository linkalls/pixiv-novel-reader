import { normalizeVersion } from './version-utils';

export interface AppUpdateAsset {
  contentType: string;
  downloadUrl: string;
  name: string;
  size: number;
}

export function selectAndroidApkAsset(
  rawAssets: unknown,
  version: string,
): AppUpdateAsset | null {
  if (!Array.isArray(rawAssets)) return null;

  const candidates = rawAssets
    .map((asset) => {
      if (!asset || typeof asset !== 'object') return null;
      const record = asset as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : '';
      const downloadUrl =
        typeof record.browser_download_url === 'string'
          ? record.browser_download_url
          : '';
      if (!name || !downloadUrl || !name.toLowerCase().endsWith('.apk')) {
        return null;
      }
      return {
        contentType:
          typeof record.content_type === 'string'
            ? record.content_type
            : 'application/vnd.android.package-archive',
        downloadUrl,
        name,
        size:
          typeof record.size === 'number' && Number.isFinite(record.size)
            ? Math.max(0, Math.floor(record.size))
            : 0,
      } satisfies AppUpdateAsset;
    })
    .filter((asset): asset is AppUpdateAsset => asset !== null);

  const normalizedVersion = normalizeVersion(version);
  return (
    candidates.find(
      (asset) =>
        asset.name.toLowerCase().includes(`v${normalizedVersion}`) &&
        asset.name.toLowerCase().includes('arm64'),
    ) ??
    candidates.find((asset) => asset.name.toLowerCase().includes('arm64')) ??
    candidates[0] ??
    null
  );
}
