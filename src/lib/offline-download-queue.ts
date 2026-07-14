import type { PixivNovelItem } from '@book000/pixivts';
import * as Network from 'expo-network';

import { getLibraryDatabase, saveOfflineNovel } from './library-db';
import { localizeNovelImages } from './offline-assets';
import { fetchNovelText } from './pixiv';

export type OfflineDownloadStatus =
  | 'pending'
  | 'downloading'
  | 'failed'
  | 'completed';

export interface OfflineDownloadQueueItem {
  novelId: number;
  title: string;
  authorName: string;
  status: OfflineDownloadStatus;
  attempts: number;
  error: string | null;
  includeImages: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OfflineDownloadSettings {
  wifiOnly: boolean;
  includeImages: boolean;
  deleteFinished: boolean;
}

export interface OfflineDownloadQueueSummary {
  pending: number;
  downloading: number;
  failed: number;
  completed: number;
}

export interface OfflineQueueProcessResult {
  processed: number;
  completed: number;
  failed: number;
  blockedByWifi: boolean;
}

let schemaPromise: Promise<void> | null = null;
let processingPromise: Promise<OfflineQueueProcessResult> | null = null;

export async function ensureOfflineDownloadQueueStorage(): Promise<void> {
  const database = await getLibraryDatabase();
  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS offline_download_queue (
          novel_id INTEGER PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          include_images INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS offline_download_queue_status_idx
          ON offline_download_queue(status, created_at ASC);

        CREATE TABLE IF NOT EXISTS offline_download_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          wifi_only INTEGER NOT NULL DEFAULT 1,
          include_images INTEGER NOT NULL DEFAULT 1,
          delete_finished INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO offline_download_settings (
          id, wifi_only, include_images, delete_finished, updated_at
        ) VALUES (1, 1, 1, 0, ${Date.now()});
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;

  // アプリ強制終了時に downloading のまま残った項目を再開可能にする。
  await database.runAsync(`
    UPDATE offline_download_queue
    SET status = 'pending', updated_at = ${Date.now()}
    WHERE status = 'downloading'
  `);
}

export async function getOfflineDownloadSettings(): Promise<OfflineDownloadSettings> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{
    wifi_only: number;
    include_images: number;
    delete_finished: number;
  }>(`
    SELECT wifi_only, include_images, delete_finished
    FROM offline_download_settings
    WHERE id = 1
  `);
  return {
    wifiOnly: row?.wifi_only !== 0,
    includeImages: row?.include_images !== 0,
    deleteFinished: row?.delete_finished === 1,
  };
}

export async function saveOfflineDownloadSettings(
  settings: OfflineDownloadSettings,
): Promise<void> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  await database.runAsync(
    `
      INSERT INTO offline_download_settings (
        id, wifi_only, include_images, delete_finished, updated_at
      ) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        wifi_only = excluded.wifi_only,
        include_images = excluded.include_images,
        delete_finished = excluded.delete_finished,
        updated_at = excluded.updated_at
    `,
    settings.wifiOnly ? 1 : 0,
    settings.includeImages ? 1 : 0,
    settings.deleteFinished ? 1 : 0,
    Date.now(),
  );
}

export async function enqueueOfflineDownloads(
  novels: readonly PixivNovelItem[],
): Promise<number> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  const settings = await getOfflineDownloadSettings();
  const unique = new Map<number, PixivNovelItem>();
  for (const novel of novels) {
    if (Number.isInteger(novel.id) && novel.id > 0) unique.set(novel.id, novel);
  }

  const now = Date.now();
  for (const novel of unique.values()) {
    await database.runAsync(
      `
        INSERT INTO offline_download_queue (
          novel_id, title, author_name, detail_json, status,
          attempts, error, include_images, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?)
        ON CONFLICT(novel_id) DO UPDATE SET
          title = excluded.title,
          author_name = excluded.author_name,
          detail_json = excluded.detail_json,
          status = CASE
            WHEN offline_download_queue.status = 'completed' THEN 'completed'
            ELSE 'pending'
          END,
          error = NULL,
          include_images = excluded.include_images,
          updated_at = excluded.updated_at
      `,
      novel.id,
      novel.title,
      novel.user.name,
      JSON.stringify(novel),
      settings.includeImages ? 1 : 0,
      now,
      now,
    );
  }
  return unique.size;
}

export async function listOfflineDownloadQueue(): Promise<OfflineDownloadQueueItem[]> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<QueueRow>(`
    SELECT * FROM offline_download_queue
    ORDER BY
      CASE status
        WHEN 'downloading' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'failed' THEN 2
        ELSE 3
      END,
      updated_at DESC
  `);
  return rows.map(mapQueueRow);
}

export async function getOfflineDownloadQueueSummary(): Promise<OfflineDownloadQueueSummary> {
  const items = await listOfflineDownloadQueue();
  return {
    pending: items.filter((item) => item.status === 'pending').length,
    downloading: items.filter((item) => item.status === 'downloading').length,
    failed: items.filter((item) => item.status === 'failed').length,
    completed: items.filter((item) => item.status === 'completed').length,
  };
}

export async function retryFailedOfflineDownloads(): Promise<void> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  await database.runAsync(`
    UPDATE offline_download_queue
    SET status = 'pending', error = NULL, updated_at = ${Date.now()}
    WHERE status = 'failed'
  `);
}

export async function clearCompletedOfflineDownloads(): Promise<void> {
  await ensureOfflineDownloadQueueStorage();
  const database = await getLibraryDatabase();
  await database.runAsync(
    "DELETE FROM offline_download_queue WHERE status = 'completed'",
  );
}

export async function processOfflineDownloadQueue(): Promise<OfflineQueueProcessResult> {
  if (processingPromise) return processingPromise;
  processingPromise = processQueueInternal().finally(() => {
    processingPromise = null;
  });
  return processingPromise;
}

async function processQueueInternal(): Promise<OfflineQueueProcessResult> {
  await ensureOfflineDownloadQueueStorage();
  const settings = await getOfflineDownloadSettings();
  const network = await Network.getNetworkStateAsync().catch(() => null);
  if (
    settings.wifiOnly &&
    network &&
    network.type !== Network.NetworkStateType.WIFI &&
    network.type !== Network.NetworkStateType.ETHERNET
  ) {
    return { processed: 0, completed: 0, failed: 0, blockedByWifi: true };
  }

  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<QueueRow>(`
    SELECT * FROM offline_download_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
  let completed = 0;
  let failed = 0;

  for (const row of rows) {
    await database.runAsync(
      `
        UPDATE offline_download_queue
        SET status = 'downloading', attempts = attempts + 1,
            error = NULL, updated_at = ?
        WHERE novel_id = ?
      `,
      Date.now(),
      row.novel_id,
    );

    try {
      const detail = JSON.parse(row.detail_json) as PixivNovelItem;
      const content = await fetchNovelText(row.novel_id);
      const savedContent = row.include_images === 1
        ? await localizeNovelImages(row.novel_id, content)
        : { ...content, embeddedImages: {} };
      await saveOfflineNovel(detail, savedContent);
      await database.runAsync(
        `
          UPDATE offline_download_queue
          SET status = 'completed', error = NULL, updated_at = ?
          WHERE novel_id = ?
        `,
        Date.now(),
        row.novel_id,
      );
      completed += 1;
    } catch (error) {
      await database.runAsync(
        `
          UPDATE offline_download_queue
          SET status = 'failed', error = ?, updated_at = ?
          WHERE novel_id = ?
        `,
        toErrorMessage(error).slice(0, 500),
        Date.now(),
        row.novel_id,
      );
      failed += 1;
    }
  }

  return {
    processed: rows.length,
    completed,
    failed,
    blockedByWifi: false,
  };
}

interface QueueRow {
  novel_id: number;
  title: string;
  author_name: string;
  detail_json: string;
  status: string;
  attempts: number;
  error: string | null;
  include_images: number;
  created_at: number;
  updated_at: number;
}

function mapQueueRow(row: QueueRow): OfflineDownloadQueueItem {
  return {
    novelId: row.novel_id,
    title: row.title,
    authorName: row.author_name,
    status: isStatus(row.status) ? row.status : 'failed',
    attempts: row.attempts,
    error: row.error,
    includeImages: row.include_images === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isStatus(value: string): value is OfflineDownloadStatus {
  return (
    value === 'pending' ||
    value === 'downloading' ||
    value === 'failed' ||
    value === 'completed'
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
