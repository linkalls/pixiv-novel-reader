import { getLibraryDatabase } from './library-db';
import {
  enqueueOfflineDownloads,
  processOfflineDownloadQueue,
} from './offline-download-queue';
import { fetchNovelSeries } from './pixiv';

export interface OfflineSeriesSubscription {
  seriesId: number;
  anchorNovelId: number;
  title: string;
  knownNovelIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface OfflineSeriesSyncResult {
  checkedSeries: number;
  discoveredNovels: number;
  queuedNovels: number;
  completedDownloads: number;
  failedDownloads: number;
  blockedByWifi: boolean;
}

let schemaPromise: Promise<void> | null = null;
let syncPromise: Promise<OfflineSeriesSyncResult> | null = null;

export async function ensureOfflineSeriesSubscriptionStorage(): Promise<void> {
  const database = await getLibraryDatabase();
  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS offline_series_subscriptions (
          series_id INTEGER PRIMARY KEY NOT NULL,
          anchor_novel_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          known_novel_ids_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS offline_series_subscriptions_updated_idx
          ON offline_series_subscriptions(updated_at DESC);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

export async function getOfflineSeriesSubscription(
  seriesId: number,
): Promise<OfflineSeriesSubscription | null> {
  await ensureOfflineSeriesSubscriptionStorage();
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<SubscriptionRow>(
    `
      SELECT *
      FROM offline_series_subscriptions
      WHERE series_id = ?
    `,
    seriesId,
  );
  return row ? mapSubscription(row) : null;
}

export async function listOfflineSeriesSubscriptions(): Promise<
  OfflineSeriesSubscription[]
> {
  await ensureOfflineSeriesSubscriptionStorage();
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<SubscriptionRow>(`
    SELECT *
    FROM offline_series_subscriptions
    ORDER BY updated_at DESC
  `);
  return rows.map(mapSubscription);
}

export async function subscribeOfflineSeries(input: {
  seriesId: number;
  anchorNovelId: number;
  title: string;
  knownNovelIds: readonly number[];
}): Promise<void> {
  if (!Number.isInteger(input.seriesId) || input.seriesId <= 0) {
    throw new Error('シリーズIDが不正です');
  }
  if (!Number.isInteger(input.anchorNovelId) || input.anchorNovelId <= 0) {
    throw new Error('作品IDが不正です');
  }

  await ensureOfflineSeriesSubscriptionStorage();
  const database = await getLibraryDatabase();
  const now = Date.now();
  const knownNovelIds = normalizeNovelIds(input.knownNovelIds);
  await database.runAsync(
    `
      INSERT INTO offline_series_subscriptions (
        series_id, anchor_novel_id, title, known_novel_ids_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id) DO UPDATE SET
        anchor_novel_id = excluded.anchor_novel_id,
        title = excluded.title,
        known_novel_ids_json = CASE
          WHEN offline_series_subscriptions.known_novel_ids_json = '[]'
            THEN excluded.known_novel_ids_json
          ELSE offline_series_subscriptions.known_novel_ids_json
        END,
        updated_at = excluded.updated_at
    `,
    input.seriesId,
    input.anchorNovelId,
    input.title.trim() || `シリーズ ${input.seriesId}`,
    JSON.stringify(knownNovelIds),
    now,
    now,
  );
}

export async function unsubscribeOfflineSeries(seriesId: number): Promise<void> {
  await ensureOfflineSeriesSubscriptionStorage();
  const database = await getLibraryDatabase();
  await database.runAsync(
    'DELETE FROM offline_series_subscriptions WHERE series_id = ?',
    seriesId,
  );
}

export async function syncOfflineSeriesSubscriptions(): Promise<OfflineSeriesSyncResult> {
  if (syncPromise) return syncPromise;
  syncPromise = syncSubscriptionsInternal().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function syncSubscriptionsInternal(): Promise<OfflineSeriesSyncResult> {
  const subscriptions = await listOfflineSeriesSubscriptions();
  const database = await getLibraryDatabase();
  let discoveredNovels = 0;
  let queuedNovels = 0;

  for (const subscription of subscriptions) {
    try {
      const result = await fetchNovelSeries(subscription.seriesId);
      const knownIds = new Set(subscription.knownNovelIds);
      const newNovels = result.novels.filter((novel) => !knownIds.has(novel.id));
      discoveredNovels += newNovels.length;

      if (newNovels.length > 0) {
        queuedNovels += await enqueueOfflineDownloads(newNovels);
      }

      await database.runAsync(
        `
          UPDATE offline_series_subscriptions
          SET anchor_novel_id = ?, title = ?, known_novel_ids_json = ?,
              updated_at = ?
          WHERE series_id = ?
        `,
        result.novels[0]?.id ?? subscription.anchorNovelId,
        result.detail.title || subscription.title,
        JSON.stringify(normalizeNovelIds(result.novels.map((novel) => novel.id))),
        Date.now(),
        subscription.seriesId,
      );
    } catch {
      // 1シリーズの取得失敗で、ほかの購読まで止めない。
    }
  }

  const queueResult =
    queuedNovels > 0
      ? await processOfflineDownloadQueue()
      : {
          processed: 0,
          completed: 0,
          failed: 0,
          blockedByWifi: false,
        };

  return {
    checkedSeries: subscriptions.length,
    discoveredNovels,
    queuedNovels,
    completedDownloads: queueResult.completed,
    failedDownloads: queueResult.failed,
    blockedByWifi: queueResult.blockedByWifi,
  };
}

interface SubscriptionRow {
  series_id: number;
  anchor_novel_id: number;
  title: string;
  known_novel_ids_json: string;
  created_at: number;
  updated_at: number;
}

function mapSubscription(row: SubscriptionRow): OfflineSeriesSubscription {
  return {
    seriesId: row.series_id,
    anchorNovelId: row.anchor_novel_id,
    title: row.title,
    knownNovelIds: parseNovelIds(row.known_novel_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseNovelIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? normalizeNovelIds(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeNovelIds(values: readonly unknown[]): number[] {
  return Array.from(
    new Set(
      values
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}
