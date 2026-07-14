import type { PixivNovelItem } from '@book000/pixivts';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getLibraryDatabase,
  type LibraryNovel,
} from './library-db';

export interface Bookshelf {
  id: number;
  name: string;
  createdAt: number;
  itemCount: number;
}

export interface BookshelfNovel extends LibraryNovel {
  addedAt: number;
  shelfId: number;
  sortOrder: number;
}

export interface ReaderMark {
  id: number;
  novelId: number;
  title: string;
  authorName: string;
  coverUrl: string | null;
  blockIndex: number;
  scrollOffset: number;
  progress: number;
  excerpt: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReaderMarkInput {
  detail: PixivNovelItem;
  blockIndex: number;
  scrollOffset: number;
  progress: number;
  excerpt: string;
  note?: string;
}

export interface RecommendationExclusion {
  novelId: number;
  title: string;
  authorName: string;
  hiddenAt: number;
}

interface BookshelfRow {
  id: number;
  name: string;
  created_at: number;
  item_count: number;
}

interface BookshelfItemRow {
  shelf_id: number;
  detail_json: string;
  added_at: number;
  sort_order: number;
  progress: number | null;
  scroll_offset: number | null;
  is_finished: number | null;
  last_read_at: number | null;
  is_offline: number;
  saved_at: number | null;
}

interface ReaderMarkRow {
  id: number;
  novel_id: number;
  title: string;
  author_name: string;
  cover_url: string | null;
  block_index: number;
  scroll_offset: number;
  progress: number;
  excerpt: string;
  note: string;
  created_at: number;
  updated_at: number;
}

interface RecommendationExclusionRow {
  novel_id: number;
  title: string;
  author_name: string;
  hidden_at: number;
}

let schemaPromise: Promise<void> | null = null;

async function getOrganizerDatabase(): Promise<SQLiteDatabase> {
  const database = await getLibraryDatabase();

  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS bookshelves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at INTEGER NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS bookshelf_items (
          shelf_id INTEGER NOT NULL,
          novel_id INTEGER NOT NULL,
          detail_json TEXT NOT NULL,
          added_at INTEGER NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (shelf_id, novel_id),
          FOREIGN KEY (shelf_id) REFERENCES bookshelves(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reader_marks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          novel_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          cover_url TEXT,
          block_index INTEGER NOT NULL DEFAULT 0,
          scroll_offset REAL NOT NULL DEFAULT 0,
          progress REAL NOT NULL DEFAULT 0,
          excerpt TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recommendation_exclusions (
          novel_id INTEGER PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          hidden_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS bookshelf_items_added_at_idx
          ON bookshelf_items(shelf_id, added_at DESC);
        CREATE INDEX IF NOT EXISTS bookshelf_items_order_idx
          ON bookshelf_items(shelf_id, sort_order ASC);
        CREATE INDEX IF NOT EXISTS reader_marks_novel_idx
          ON reader_marks(novel_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS reader_marks_updated_idx
          ON reader_marks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS recommendation_exclusions_hidden_idx
          ON recommendation_exclusions(hidden_at DESC);

        INSERT OR IGNORE INTO bookshelves (name, created_at, sort_order)
          VALUES ('あとで読む', CAST(strftime('%s','now') AS INTEGER) * 1000, 0);
        INSERT OR IGNORE INTO bookshelves (name, created_at, sort_order)
          VALUES ('お気に入り', CAST(strftime('%s','now') AS INTEGER) * 1000, 1);
        INSERT OR IGNORE INTO bookshelves (name, created_at, sort_order)
          VALUES ('読み返したい', CAST(strftime('%s','now') AS INTEGER) * 1000, 2);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
  await ensureBookshelfItemSortOrderColumn(database);
  return database;
}

async function ensureBookshelfItemSortOrderColumn(
  database: SQLiteDatabase,
): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(bookshelf_items)',
  );
  if (!columns.some((column) => column.name === 'sort_order')) {
    await database.execAsync(
      'ALTER TABLE bookshelf_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
    );
  }

  const shelfIds = await database.getAllAsync<{ shelf_id: number }>(`
    SELECT DISTINCT shelf_id FROM bookshelf_items
  `);
  for (const { shelf_id: shelfId } of shelfIds) {
    const rows = await database.getAllAsync<{ novel_id: number }>(
      `
        SELECT novel_id
        FROM bookshelf_items
        WHERE shelf_id = ?
        ORDER BY
          CASE WHEN sort_order = 0 THEN 1 ELSE 0 END,
          sort_order ASC,
          added_at DESC,
          novel_id ASC
      `,
      shelfId,
    );
    for (let index = 0; index < rows.length; index += 1) {
      await database.runAsync(
        `UPDATE bookshelf_items SET sort_order = ? WHERE shelf_id = ? AND novel_id = ?`,
        index,
        shelfId,
        rows[index].novel_id,
      );
    }
  }
}

/** バックアップや統計画面から整理機能のスキーマを初期化する。 */
export async function ensureOrganizerStorage(): Promise<void> {
  await getOrganizerDatabase();
}

export async function listBookshelves(): Promise<Bookshelf[]> {
  const database = await getOrganizerDatabase();
  const rows = await database.getAllAsync<BookshelfRow>(`
    SELECT
      s.id,
      s.name,
      s.created_at,
      COUNT(i.novel_id) AS item_count
    FROM bookshelves s
    LEFT JOIN bookshelf_items i ON i.shelf_id = s.id
    GROUP BY s.id
    ORDER BY s.sort_order ASC, s.created_at ASC, s.id ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    itemCount: row.item_count,
  }));
}

export async function createBookshelf(rawName: string): Promise<Bookshelf> {
  const database = await getOrganizerDatabase();
  const name = normalizeShelfName(rawName);
  const createdAt = Date.now();
  const row = await database.getFirstAsync<{ next_order: number }>(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM bookshelves
  `);

  await database.runAsync(
    `INSERT INTO bookshelves (name, created_at, sort_order) VALUES (?, ?, ?)`,
    name,
    createdAt,
    row?.next_order ?? 0,
  );

  const created = await database.getFirstAsync<BookshelfRow>(
    `
      SELECT id, name, created_at, 0 AS item_count
      FROM bookshelves
      WHERE name = ? COLLATE NOCASE
    `,
    name,
  );

  if (!created) {
    throw new Error('本棚を作成できませんでした');
  }

  return {
    id: created.id,
    name: created.name,
    createdAt: created.created_at,
    itemCount: 0,
  };
}

export async function renameBookshelf(
  shelfId: number,
  rawName: string,
): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync(
    'UPDATE bookshelves SET name = ? WHERE id = ?',
    normalizeShelfName(rawName),
    shelfId,
  );
}

export async function deleteBookshelf(shelfId: number): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync('DELETE FROM bookshelves WHERE id = ?', shelfId);
}

export async function listBookshelfMemberships(
  novelId: number,
): Promise<Set<number>> {
  const database = await getOrganizerDatabase();
  const rows = await database.getAllAsync<{ shelf_id: number }>(
    'SELECT shelf_id FROM bookshelf_items WHERE novel_id = ?',
    novelId,
  );
  return new Set(rows.map((row) => row.shelf_id));
}

export async function setNovelInBookshelf(
  shelfId: number,
  detail: PixivNovelItem,
  shouldInclude: boolean,
): Promise<void> {
  const database = await getOrganizerDatabase();

  if (!shouldInclude) {
    await database.runAsync(
      'DELETE FROM bookshelf_items WHERE shelf_id = ? AND novel_id = ?',
      shelfId,
      detail.id,
    );
    return;
  }

  const nextOrderRow = await database.getFirstAsync<{ next_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM bookshelf_items
      WHERE shelf_id = ?
    `,
    shelfId,
  );
  await database.runAsync(
    `
      INSERT INTO bookshelf_items (
        shelf_id, novel_id, detail_json, added_at, sort_order
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(shelf_id, novel_id) DO UPDATE SET
        detail_json = excluded.detail_json,
        added_at = excluded.added_at
    `,
    shelfId,
    detail.id,
    JSON.stringify(detail),
    Date.now(),
    nextOrderRow?.next_order ?? 0,
  );
}

export async function removeNovelFromBookshelf(
  shelfId: number,
  novelId: number,
): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync(
    'DELETE FROM bookshelf_items WHERE shelf_id = ? AND novel_id = ?',
    shelfId,
    novelId,
  );
}

export async function moveBookshelfNovel(
  shelfId: number,
  novelId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.withTransactionAsync(async () => {
    const rows = await database.getAllAsync<{
      novel_id: number;
      sort_order: number;
    }>(
      `
        SELECT novel_id, sort_order
        FROM bookshelf_items
        WHERE shelf_id = ?
        ORDER BY sort_order ASC, added_at DESC, novel_id ASC
      `,
      shelfId,
    );
    const index = rows.findIndex((row) => row.novel_id === novelId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;

    const current = rows[index];
    const target = rows[targetIndex];
    await database.runAsync(
      `UPDATE bookshelf_items SET sort_order = ? WHERE shelf_id = ? AND novel_id = ?`,
      target.sort_order,
      shelfId,
      current.novel_id,
    );
    await database.runAsync(
      `UPDATE bookshelf_items SET sort_order = ? WHERE shelf_id = ? AND novel_id = ?`,
      current.sort_order,
      shelfId,
      target.novel_id,
    );
  });
}

export async function listBookshelfNovels(
  shelfId: number,
  limit = 300,
): Promise<BookshelfNovel[]> {
  const database = await getOrganizerDatabase();
  const rows = await database.getAllAsync<BookshelfItemRow>(
    `
      SELECT
        i.shelf_id,
        i.detail_json,
        i.added_at,
        i.sort_order,
        h.progress,
        h.scroll_offset,
        h.is_finished,
        h.last_read_at,
        CASE WHEN o.novel_id IS NULL THEN 0 ELSE 1 END AS is_offline,
        o.saved_at
      FROM bookshelf_items i
      LEFT JOIN reading_history h ON h.novel_id = i.novel_id
      LEFT JOIN offline_novels o ON o.novel_id = i.novel_id
      WHERE i.shelf_id = ?
      ORDER BY i.sort_order ASC, i.added_at DESC
      LIMIT ?
    `,
    shelfId,
    Math.max(1, Math.min(500, limit)),
  );

  const items: BookshelfNovel[] = [];
  for (const row of rows) {
    try {
      const detail = JSON.parse(row.detail_json) as PixivNovelItem;
      items.push({
        ...mapDetailToLibraryNovel(detail, row),
        shelfId: row.shelf_id,
        addedAt: row.added_at,
        sortOrder: row.sort_order,
      });
    } catch {
      // 壊れた1件だけを除外する。
    }
  }
  return items;
}

export async function createReaderMark(
  input: CreateReaderMarkInput,
): Promise<number> {
  const database = await getOrganizerDatabase();
  const now = Date.now();
  const result = await database.runAsync(
    `
      INSERT INTO reader_marks (
        novel_id, title, author_name, cover_url, block_index,
        scroll_offset, progress, excerpt, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.detail.id,
    input.detail.title,
    input.detail.user.name,
    getCoverUrl(input.detail),
    Math.max(0, Math.floor(input.blockIndex)),
    Math.max(0, input.scrollOffset),
    clampProgress(input.progress),
    input.excerpt.trim() || '本文内のしおり',
    input.note?.trim() ?? '',
    now,
    now,
  );
  return result.lastInsertRowId;
}

export async function listReaderMarks(
  novelId?: number,
): Promise<ReaderMark[]> {
  const database = await getOrganizerDatabase();
  const rows = novelId
    ? await database.getAllAsync<ReaderMarkRow>(
        `SELECT * FROM reader_marks WHERE novel_id = ? ORDER BY updated_at DESC`,
        novelId,
      )
    : await database.getAllAsync<ReaderMarkRow>(
        `SELECT * FROM reader_marks ORDER BY updated_at DESC LIMIT 500`,
      );
  return rows.map(mapReaderMark);
}

export async function updateReaderMarkNote(
  markId: number,
  note: string,
): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync(
    'UPDATE reader_marks SET note = ?, updated_at = ? WHERE id = ?',
    note.trim(),
    Date.now(),
    markId,
  );
}

export async function deleteReaderMark(markId: number): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync('DELETE FROM reader_marks WHERE id = ?', markId);
}

export async function excludeRecommendation(
  novel: PixivNovelItem,
): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync(
    `
      INSERT INTO recommendation_exclusions (
        novel_id, title, author_name, hidden_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(novel_id) DO UPDATE SET
        title = excluded.title,
        author_name = excluded.author_name,
        hidden_at = excluded.hidden_at
    `,
    novel.id,
    novel.title,
    novel.user.name,
    Date.now(),
  );
}

export async function restoreRecommendation(novelId: number): Promise<void> {
  const database = await getOrganizerDatabase();
  await database.runAsync(
    'DELETE FROM recommendation_exclusions WHERE novel_id = ?',
    novelId,
  );
}

export async function listRecommendationExclusions(): Promise<
  RecommendationExclusion[]
> {
  const database = await getOrganizerDatabase();
  const rows = await database.getAllAsync<RecommendationExclusionRow>(`
    SELECT novel_id, title, author_name, hidden_at
    FROM recommendation_exclusions
    ORDER BY hidden_at DESC
    LIMIT 500
  `);
  return rows.map((row) => ({
    novelId: row.novel_id,
    title: row.title,
    authorName: row.author_name,
    hiddenAt: row.hidden_at,
  }));
}

export async function listExcludedRecommendationIds(): Promise<Set<number>> {
  const database = await getOrganizerDatabase();
  const rows = await database.getAllAsync<{ novel_id: number }>(
    'SELECT novel_id FROM recommendation_exclusions',
  );
  return new Set(rows.map((row) => row.novel_id));
}

function normalizeShelfName(rawName: string): string {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length === 0) {
    throw new Error('本棚の名前を入力してください');
  }
  if (name.length > 40) {
    throw new Error('本棚の名前は40文字以内で入力してください');
  }
  return name;
}

function mapDetailToLibraryNovel(
  detail: PixivNovelItem,
  row: Pick<
    BookshelfItemRow,
    | 'progress'
    | 'scroll_offset'
    | 'is_finished'
    | 'last_read_at'
    | 'is_offline'
    | 'saved_at'
    | 'added_at'
  >,
): LibraryNovel {
  return {
    novelId: detail.id,
    title: detail.title,
    authorName: detail.user.name,
    coverUrl: getCoverUrl(detail),
    tags: detail.tags
      .map((tag) => tag.name.trim())
      .filter((tagName) => tagName.length > 0),
    textLength: detail.textLength,
    progress: clampProgress(row.progress ?? 0),
    scrollOffset: Math.max(0, row.scroll_offset ?? 0),
    isFinished: row.is_finished === 1,
    finishedAt:
      row.is_finished === 1 ? (row.last_read_at ?? row.added_at) : null,
    lastReadAt: row.last_read_at ?? row.added_at,
    isOffline: row.is_offline === 1,
    savedAt: row.saved_at,
  };
}

function mapReaderMark(row: ReaderMarkRow): ReaderMark {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    authorName: row.author_name,
    coverUrl: row.cover_url,
    blockIndex: row.block_index,
    scrollOffset: Math.max(0, row.scroll_offset),
    progress: clampProgress(row.progress),
    excerpt: row.excerpt,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getCoverUrl(detail: PixivNovelItem): string | null {
  return (
    detail.imageUrls.medium ||
    detail.imageUrls.squareMedium ||
    detail.imageUrls.large ||
    null
  );
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}
