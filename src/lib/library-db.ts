import type { PixivNovelItem } from '@book000/pixivts';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { deleteNovelOfflineAssets } from '@/lib/offline-assets';
import type { NovelReaderContent } from '@/lib/pixiv';

const DATABASE_NAME = 'pixiv-novel-reader.db';

export interface LibraryNovel {
  novelId: number;
  title: string;
  authorName: string;
  coverUrl: string | null;
  tags: string[];
  textLength: number;
  progress: number;
  scrollOffset: number;
  isFinished: boolean;
  lastReadAt: number;
  isOffline: boolean;
  savedAt: number | null;
}

export interface OfflineNovelRecord {
  detail: PixivNovelItem;
  content: NovelReaderContent;
  savedAt: number;
}

export interface NovelReadingStatus {
  progress: number;
  isFinished: boolean;
  isOffline: boolean;
}

interface HistoryRow {
  novel_id: number;
  title: string;
  author_name: string;
  cover_url: string | null;
  tags_json: string;
  text_length: number;
  progress: number;
  scroll_offset: number;
  is_finished: number;
  last_read_at: number;
  is_offline: number;
  saved_at: number | null;
}

interface OfflineRow {
  detail_json: string;
  content_json: string;
  saved_at: number;
}

interface OfflineListRow extends OfflineRow {
  progress: number | null;
  scroll_offset: number | null;
  is_finished: number | null;
  last_read_at: number | null;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

/** SQLiteを一度だけ初期化し、履歴とオフライン保存を同じDBで管理する。 */
async function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS reading_history (
          novel_id INTEGER PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          cover_url TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          text_length INTEGER NOT NULL DEFAULT 0,
          progress REAL NOT NULL DEFAULT 0,
          scroll_offset REAL NOT NULL DEFAULT 0,
          is_finished INTEGER NOT NULL DEFAULT 0,
          last_read_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS offline_novels (
          novel_id INTEGER PRIMARY KEY NOT NULL,
          detail_json TEXT NOT NULL,
          content_json TEXT NOT NULL,
          saved_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS reading_history_last_read_at_idx
          ON reading_history(last_read_at DESC);
        CREATE INDEX IF NOT EXISTS offline_novels_saved_at_idx
          ON offline_novels(saved_at DESC);
      `);

      await ensureReadingHistoryTagsColumn(database);
      return database;
    });
  }

  return databasePromise;
}

/** 同じSQLiteへ機能別テーブルを追加する内部向けアクセサ。 */
export async function getLibraryDatabase(): Promise<SQLiteDatabase> {
  return getDatabase();
}

export type ReadingHistoryFilter = 'all' | 'reading' | 'finished' | 'offline';
export type ReadingHistorySort = 'recent' | 'progress' | 'title';

export interface ReadingHistoryQuery {
  filter?: ReadingHistoryFilter;
  limit?: number;
  query?: string;
  sort?: ReadingHistorySort;
}

export async function recordNovelOpened(
  detail: PixivNovelItem,
  progress = 0,
  scrollOffset = 0,
): Promise<void> {
  const database = await getDatabase();
  const coverUrl =
    detail.imageUrls.medium ||
    detail.imageUrls.squareMedium ||
    detail.imageUrls.large ||
    null;

  await database.runAsync(
    `
      INSERT INTO reading_history (
        novel_id,
        title,
        author_name,
        cover_url,
        tags_json,
        text_length,
        progress,
        scroll_offset,
        is_finished,
        last_read_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id) DO UPDATE SET
        title = excluded.title,
        author_name = excluded.author_name,
        cover_url = excluded.cover_url,
        tags_json = excluded.tags_json,
        text_length = excluded.text_length,
        progress = MAX(reading_history.progress, excluded.progress),
        scroll_offset = CASE
          WHEN excluded.progress >= reading_history.progress
            THEN excluded.scroll_offset
          ELSE reading_history.scroll_offset
        END,
        is_finished = MAX(reading_history.is_finished, excluded.is_finished),
        last_read_at = excluded.last_read_at
    `,
    detail.id,
    detail.title,
    detail.user.name,
    coverUrl,
    JSON.stringify(normalizeTagNames(detail.tags)),
    detail.textLength,
    clampProgress(progress),
    Math.max(0, scrollOffset),
    progress >= 0.985 ? 1 : 0,
    Date.now(),
  );
}

export async function updateReadingProgress(
  novelId: number,
  progress: number,
  scrollOffset: number,
): Promise<void> {
  const database = await getDatabase();
  const normalizedProgress = clampProgress(progress);

  await database.runAsync(
    `
      UPDATE reading_history
      SET progress = ?,
          scroll_offset = ?,
          is_finished = CASE WHEN ? >= 0.985 THEN 1 ELSE is_finished END
      WHERE novel_id = ?
    `,
    normalizedProgress,
    Math.max(0, scrollOffset),
    normalizedProgress,
    novelId,
  );
}

export async function getReadingHistory(
  novelId: number,
): Promise<LibraryNovel | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<HistoryRow>(
    historySelectSql('WHERE h.novel_id = ?'),
    novelId,
  );

  return row ? mapHistoryRow(row) : null;
}

export async function getNovelReadingStatuses(
  novelIds: readonly number[],
): Promise<Map<number, NovelReadingStatus>> {
  const uniqueIds = Array.from(
    new Set(
      novelIds.filter(
        (novelId) => Number.isInteger(novelId) && novelId > 0,
      ),
    ),
  ).slice(0, 500);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const database = await getDatabase();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await database.getAllAsync<{
    novel_id: number;
    progress: number;
    is_finished: number;
    is_offline: number;
  }>(
    `
      SELECT
        h.novel_id,
        h.progress,
        h.is_finished,
        CASE WHEN o.novel_id IS NULL THEN 0 ELSE 1 END AS is_offline
      FROM reading_history h
      LEFT JOIN offline_novels o ON o.novel_id = h.novel_id
      WHERE h.novel_id IN (${placeholders})
    `,
    ...uniqueIds,
  );

  return new Map(
    rows.map((row) => [
      row.novel_id,
      {
        progress: clampProgress(row.progress),
        isFinished: row.is_finished === 1,
        isOffline: row.is_offline === 1,
      },
    ]),
  );
}

export async function listReadingHistory(
  options: ReadingHistoryQuery = {},
): Promise<LibraryNovel[]> {
  const database = await getDatabase();
  const query =
    options.query?.trim().replace(/^#+/, '').toLocaleLowerCase('ja-JP') ?? '';
  const filter = options.filter ?? 'all';
  const sort = options.sort ?? 'recent';
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const conditions: string[] = [];
  const parameters: (number | string)[] = [];

  if (query.length > 0) {
    conditions.push(
      '(LOWER(h.title) LIKE ? OR LOWER(h.author_name) LIKE ? OR LOWER(h.tags_json) LIKE ?)',
    );
    const likeQuery = `%${query}%`;
    parameters.push(likeQuery, likeQuery, likeQuery);
  }

  if (filter === 'reading') {
    conditions.push('h.is_finished = 0 AND h.progress < 0.985');
  } else if (filter === 'finished') {
    conditions.push('h.is_finished = 1');
  } else if (filter === 'offline') {
    conditions.push('o.novel_id IS NOT NULL');
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderClause =
    sort === 'progress'
      ? 'ORDER BY h.is_finished ASC, h.progress DESC, h.last_read_at DESC'
      : sort === 'title'
        ? 'ORDER BY h.title COLLATE NOCASE ASC, h.last_read_at DESC'
        : 'ORDER BY h.last_read_at DESC';

  parameters.push(limit);
  const rows = await database.getAllAsync<HistoryRow>(
    `${historySelectSql(whereClause)} ${orderClause} LIMIT ?`,
    ...parameters,
  );

  return rows.map(mapHistoryRow);
}

export async function deleteReadingHistory(novelId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'DELETE FROM reading_history WHERE novel_id = ?',
    novelId,
  );
}

export async function setReadingFinished(
  novelId: number,
  isFinished: boolean,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `
      UPDATE reading_history
      SET is_finished = ?,
          progress = CASE
            WHEN ? = 1 THEN 1
            WHEN progress >= 0.985 THEN 0
            ELSE progress
          END
      WHERE novel_id = ?
    `,
    isFinished ? 1 : 0,
    isFinished ? 1 : 0,
    novelId,
  );
}

export async function deleteOfflineNovels(novelIds: readonly number[]): Promise<void> {
  const uniqueIds = Array.from(
    new Set(novelIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  for (const novelId of uniqueIds) {
    await deleteOfflineNovel(novelId);
  }
}

export async function clearReadingHistory(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM reading_history');
}

export async function saveOfflineNovel(
  detail: PixivNovelItem,
  content: NovelReaderContent,
): Promise<void> {
  const database = await getDatabase();
  const savedAt = Date.now();

  await database.runAsync(
    `
      INSERT INTO offline_novels (
        novel_id,
        detail_json,
        content_json,
        saved_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(novel_id) DO UPDATE SET
        detail_json = excluded.detail_json,
        content_json = excluded.content_json,
        saved_at = excluded.saved_at
    `,
    detail.id,
    JSON.stringify(detail),
    JSON.stringify(content),
    savedAt,
  );

  await recordNovelOpened(detail);
}

/** 保存済み本文を触らず、ブックマーク数など作品情報だけ更新する。 */
export async function updateOfflineNovelDetail(
  detail: PixivNovelItem,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `
      UPDATE offline_novels
      SET detail_json = ?
      WHERE novel_id = ?
    `,
    JSON.stringify(detail),
    detail.id,
  );
}

export async function getOfflineNovel(
  novelId: number,
): Promise<OfflineNovelRecord | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<OfflineRow>(
    `
      SELECT detail_json, content_json, saved_at
      FROM offline_novels
      WHERE novel_id = ?
    `,
    novelId,
  );

  if (!row) {
    return null;
  }

  try {
    return {
      detail: JSON.parse(row.detail_json) as PixivNovelItem,
      content: JSON.parse(row.content_json) as NovelReaderContent,
      savedAt: row.saved_at,
    };
  } catch {
    // 保存データが壊れていた場合は、次回のオンライン取得を優先する。
    await deleteOfflineNovel(novelId);
    return null;
  }
}

export async function deleteOfflineNovel(novelId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'DELETE FROM offline_novels WHERE novel_id = ?',
    novelId,
  );
  await deleteNovelOfflineAssets(novelId).catch(() => {});
}

export async function listOfflineNovels(limit = 100): Promise<LibraryNovel[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<OfflineListRow>(
    `
      SELECT
        o.detail_json,
        o.content_json,
        o.saved_at,
        h.progress,
        h.scroll_offset,
        h.is_finished,
        h.last_read_at
      FROM offline_novels o
      LEFT JOIN reading_history h ON h.novel_id = o.novel_id
      ORDER BY o.saved_at DESC
      LIMIT ?
    `,
    limit,
  );

  const items: LibraryNovel[] = [];

  for (const row of rows) {
    try {
      const detail = JSON.parse(row.detail_json) as PixivNovelItem;
      items.push({
        novelId: detail.id,
        title: detail.title,
        authorName: detail.user.name,
        coverUrl:
          detail.imageUrls.medium ||
          detail.imageUrls.squareMedium ||
          detail.imageUrls.large ||
          null,
        tags: normalizeTagNames(detail.tags),
        textLength: detail.textLength,
        progress: clampProgress(row.progress ?? 0),
        scrollOffset: Math.max(0, row.scroll_offset ?? 0),
        isFinished: row.is_finished === 1,
        lastReadAt: row.last_read_at ?? row.saved_at,
        isOffline: true,
        savedAt: row.saved_at,
      });
    } catch {
      // 壊れた1件だけを飛ばし、ほかの保存作品は表示する。
    }
  }

  return items;
}

function historySelectSql(whereClause: string): string {
  return `
    SELECT
      h.novel_id,
      h.title,
      h.author_name,
      h.cover_url,
      h.tags_json,
      h.text_length,
      h.progress,
      h.scroll_offset,
      h.is_finished,
      h.last_read_at,
      CASE WHEN o.novel_id IS NULL THEN 0 ELSE 1 END AS is_offline,
      o.saved_at
    FROM reading_history h
    LEFT JOIN offline_novels o ON o.novel_id = h.novel_id
    ${whereClause}
  `;
}

function mapHistoryRow(row: HistoryRow): LibraryNovel {
  return {
    novelId: row.novel_id,
    title: row.title,
    authorName: row.author_name,
    coverUrl: row.cover_url,
    tags: parseTagNames(row.tags_json),
    textLength: row.text_length,
    progress: clampProgress(row.progress),
    scrollOffset: Math.max(0, row.scroll_offset),
    isFinished: row.is_finished === 1,
    lastReadAt: row.last_read_at,
    isOffline: row.is_offline === 1,
    savedAt: row.saved_at,
  };
}

async function ensureReadingHistoryTagsColumn(
  database: SQLiteDatabase,
): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(reading_history)',
  );

  if (columns.some((column) => column.name === 'tags_json')) {
    return;
  }

  await database.execAsync(
    "ALTER TABLE reading_history ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
  );
}

function normalizeTagNames(tags: readonly { name: string }[]): string[] {
  const unique = new Set<string>();

  for (const tag of tags) {
    const name = tag.name.trim();
    if (name.length > 0) {
      unique.add(name);
    }
  }

  return Array.from(unique);
}

function parseTagNames(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(1, progress));
}
