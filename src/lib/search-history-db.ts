import type { SQLiteDatabase } from 'expo-sqlite';

import type { NovelSearchSort, NovelSearchTarget } from './pixiv';
import { getLibraryDatabase } from './library-db';

export interface SearchHistoryItem {
  word: string;
  sort: NovelSearchSort;
  target: NovelSearchTarget;
  searchedAt: number;
  useCount: number;
  isPinned: boolean;
}

interface SearchHistoryRow {
  word: string;
  sort: string;
  target: string;
  searched_at: number;
  use_count: number;
  is_pinned: number;
}

let schemaPromise: Promise<void> | null = null;

async function getSearchHistoryDatabase(): Promise<SQLiteDatabase> {
  const database = await getLibraryDatabase();

  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS search_history (
          word TEXT NOT NULL,
          sort TEXT NOT NULL,
          target TEXT NOT NULL,
          searched_at INTEGER NOT NULL,
          use_count INTEGER NOT NULL DEFAULT 1,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (word, sort, target)
        );

        CREATE INDEX IF NOT EXISTS search_history_recent_idx
          ON search_history(is_pinned DESC, searched_at DESC);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
  return database;
}

/** バックアップ処理などから検索履歴テーブルを確実に作る。 */
export async function ensureSearchHistoryStorage(): Promise<void> {
  await getSearchHistoryDatabase();
}

export async function recordSearchHistory(
  rawWord: string,
  sort: NovelSearchSort,
  target: NovelSearchTarget,
): Promise<void> {
  const database = await getSearchHistoryDatabase();
  const word = normalizeSearchHistoryWord(rawWord);

  if (word.length === 0) {
    return;
  }

  await database.runAsync(
    `
      INSERT INTO search_history (
        word,
        sort,
        target,
        searched_at,
        use_count,
        is_pinned
      ) VALUES (?, ?, ?, ?, 1, 0)
      ON CONFLICT(word, sort, target) DO UPDATE SET
        searched_at = excluded.searched_at,
        use_count = search_history.use_count + 1
    `,
    word,
    sort,
    target,
    Date.now(),
  );

  // ピン留めされていない古い項目だけを削り、DBが際限なく増えないようにする。
  await database.runAsync(`
    DELETE FROM search_history
    WHERE is_pinned = 0
      AND rowid NOT IN (
        SELECT rowid
        FROM search_history
        WHERE is_pinned = 0
        ORDER BY searched_at DESC
        LIMIT 30
      )
  `);
}

export async function listSearchHistory(limit = 30): Promise<SearchHistoryItem[]> {
  const database = await getSearchHistoryDatabase();
  const rows = await database.getAllAsync<SearchHistoryRow>(
    `
      SELECT word, sort, target, searched_at, use_count, is_pinned
      FROM search_history
      ORDER BY is_pinned DESC, searched_at DESC
      LIMIT ?
    `,
    Math.max(1, Math.min(100, Math.floor(limit))),
  );

  return rows.flatMap((row) => {
    const sort = parseSearchSort(row.sort);
    const target = parseSearchTarget(row.target);

    if (!sort || !target) {
      return [];
    }

    return [
      {
        word: row.word,
        sort,
        target,
        searchedAt: row.searched_at,
        useCount: Math.max(1, row.use_count),
        isPinned: row.is_pinned === 1,
      },
    ];
  });
}

export async function setSearchHistoryPinned(
  item: Pick<SearchHistoryItem, 'word' | 'sort' | 'target'>,
  isPinned: boolean,
): Promise<void> {
  const database = await getSearchHistoryDatabase();
  await database.runAsync(
    `
      UPDATE search_history
      SET is_pinned = ?, searched_at = ?
      WHERE word = ? AND sort = ? AND target = ?
    `,
    isPinned ? 1 : 0,
    Date.now(),
    normalizeSearchHistoryWord(item.word),
    item.sort,
    item.target,
  );
}

export async function deleteSearchHistoryItem(
  item: Pick<SearchHistoryItem, 'word' | 'sort' | 'target'>,
): Promise<void> {
  const database = await getSearchHistoryDatabase();
  await database.runAsync(
    `
      DELETE FROM search_history
      WHERE word = ? AND sort = ? AND target = ?
    `,
    normalizeSearchHistoryWord(item.word),
    item.sort,
    item.target,
  );
}

/** ピン留めした検索は残し、通常の検索履歴だけを消す。 */
export async function clearRecentSearchHistory(): Promise<void> {
  const database = await getSearchHistoryDatabase();
  await database.runAsync('DELETE FROM search_history WHERE is_pinned = 0');
}

export function normalizeSearchHistoryWord(rawWord: string): string {
  return rawWord.trim().replace(/\s+/g, ' ').slice(0, 200);
}

function parseSearchSort(value: string): NovelSearchSort | null {
  switch (value) {
    case 'date_desc':
    case 'date_asc':
    case 'popular_desc':
      return value;
    default:
      return null;
  }
}

function parseSearchTarget(value: string): NovelSearchTarget | null {
  switch (value) {
    case 'keyword':
    case 'partial_match_for_tags':
    case 'exact_match_for_tags':
    case 'title_and_caption':
      return value;
    default:
      return null;
  }
}
