import {
  deleteAsync,
  documentDirectory,
  downloadAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';

import type { NovelReaderContent } from './pixiv';

const OFFLINE_ROOT_NAME = 'pixiv-novel-reader/offline-assets';

export interface OfflineImageProgress {
  completed: number;
  total: number;
}

/**
 * 本文中の挿絵を永続ストレージへ保存し、embeddedImagesをfile URIへ差し替える。
 * 一件でも失敗した場合は中途半端な作品フォルダを削除して再試行可能にする。
 */
export async function localizeNovelImages(
  novelId: number,
  content: NovelReaderContent,
  onProgress?: (progress: OfflineImageProgress) => void,
): Promise<NovelReaderContent> {
  const entries = Object.entries(content.embeddedImages);

  if (entries.length === 0) {
    return content;
  }

  const directory = getNovelAssetDirectory(novelId);
  await deleteAsync(directory, { idempotent: true });
  await makeDirectoryAsync(directory, { intermediates: true });

  const localizedImages: Record<string, string> = {};
  let completed = 0;
  onProgress?.({ completed, total: entries.length });

  try {
    for (const [imageId, imageUrl] of entries) {
      const destination = `${directory}/${sanitizeFilePart(imageId)}${getExtension(
        imageUrl,
      )}`;
      const result = await downloadAsync(imageUrl, destination, {
        headers: {
          Referer: 'https://www.pixiv.net/',
        },
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(`挿絵 ${imageId} の保存に失敗しました (${result.status})`);
      }

      localizedImages[imageId] = result.uri;
      completed += 1;
      onProgress?.({ completed, total: entries.length });
    }
  } catch (error) {
    await deleteAsync(directory, { idempotent: true }).catch(() => {});
    throw error;
  }

  return {
    ...content,
    embeddedImages: localizedImages,
  };
}

export async function deleteNovelOfflineAssets(novelId: number): Promise<void> {
  await deleteAsync(getNovelAssetDirectory(novelId), { idempotent: true });
}

function getNovelAssetDirectory(novelId: number): string {
  if (!documentDirectory) {
    throw new Error('端末の保存領域を利用できませんでした');
  }

  return `${documentDirectory}${OFFLINE_ROOT_NAME}/${novelId}`;
}

function sanitizeFilePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
  return sanitized.length > 0 ? sanitized : 'image';
}

function getExtension(url: string): string {
  const pathname = url.split('?')[0] ?? '';
  const match = pathname.match(/\.(jpe?g|png|gif|webp)$/i);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}
