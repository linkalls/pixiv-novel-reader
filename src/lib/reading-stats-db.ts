import type { PixivNovelItem } from '@book000/pixivts';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getLibraryDatabase } from './library-db';
import {
  estimateCharactersRead,
  fillReadingDayBuckets,
  type ReadingDayBucket,
} from './reading-stats';

export interface ReadingStatistics {
  charactersRead: number;
  daily: ReadingDayBucket[];
  finishedNovels: number;
  last7DaysDurationMs: number;
  sessionCount: number;
  todayDurationMs: number;
  topNovels: ReadingTopNovel[];
  totalDurationMs: number;
  uniqueNovels: number;
}

export interface ReadingTopNovel {
  authorName: string;
  charactersRead: number;
  durationMs: number;
  novelId: number;
  sessions: number;
  title: string;
}

interface ReadingSessionRow {
  author_name: string;
  characters_read: number;
  duration_ms: number;
  ended_at: number;
  id: number;
  novel_id: number;
  start_progress: number;
  started_at: number;
  text_length: number;
  title: string;
}

let schemaPromise: Promise<void> | null = null;

async function getStatsDatabase(): Promise<SQLiteDatabase> {
  const database = await getLibraryDatabase();
  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS reading_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          novel_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          text_length INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          ended_at INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          start_progress REAL NOT NULL DEFAULT 0,
          end_progress REAL NOT NULL DEFAULT 0,
          characters_read INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS reading_sessions_ended_at_idx
          ON reading_sessions(ended_at DESC);
        CREATE INDEX IF NOT EXISTS reading_sessions_novel_idx
          ON reading_sessions(novel_id, ended_at DESC);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
  return database;
}

export async function ensureReadingStatsStorage(): Promise<void> {
  await getStatsDatabase();
}

export async function startReadingSession(
  detail: PixivNovelItem,
  startProgress: number,
): Promise<number> {
  const database = await getStatsDatabase();
  const now = Date.now();
  const result = await database.runAsync(
    `
      INSERT INTO reading_sessions (
        novel_id, title, author_name, text_length,
        started_at, ended_at, duration_ms,
        start_progress, end_progress, characters_read
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
    `,
    detail.id,
    detail.title,
    detail.user.name,
    Math.max(0, detail.textLength),
    now,
    now,
    clampProgress(startProgress),
    clampProgress(startProgress),
  );
  return result.lastInsertRowId;
}

export async function finishReadingSession(
  sessionId: number,
  endProgress: number,
): Promise<void> {
  await persistReadingSession(sessionId, endProgress, true);
}

/** 読書中の進捗を定期保存し、強制終了時にも統計を残せるようにする。 */
export async function updateReadingSession(
  sessionId: number,
  endProgress: number,
): Promise<void> {
  await persistReadingSession(sessionId, endProgress, false);
}

async function persistReadingSession(
  sessionId: number,
  endProgress: number,
  finalize: boolean,
): Promise<void> {
  const database = await getStatsDatabase();
  const row = await database.getFirstAsync<ReadingSessionRow>(
    `SELECT * FROM reading_sessions WHERE id = ?`,
    sessionId,
  );
  if (!row) {
    return;
  }

  const endedAt = Date.now();
  const durationMs = Math.max(
    0,
    Math.min(8 * 60 * 60 * 1000, endedAt - row.started_at),
  );

  if (durationMs < 5_000) {
    if (finalize) {
      await database.runAsync('DELETE FROM reading_sessions WHERE id = ?', sessionId);
    }
    return;
  }

  const normalizedEndProgress = clampProgress(endProgress);
  const charactersRead = estimateCharactersRead(
    row.text_length,
    row.start_progress,
    normalizedEndProgress,
  );

  await database.runAsync(
    `
      UPDATE reading_sessions
      SET ended_at = ?, duration_ms = ?, end_progress = ?, characters_read = ?
      WHERE id = ?
    `,
    endedAt,
    durationMs,
    normalizedEndProgress,
    charactersRead,
    sessionId,
  );
}

export async function getReadingStatistics(days = 30): Promise<ReadingStatistics> {
  const database = await getStatsDatabase();
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const totals = await database.getFirstAsync<{
    characters_read: number | null;
    duration_ms: number | null;
    session_count: number;
    unique_novels: number;
  }>(
    `
      SELECT
        COALESCE(SUM(characters_read), 0) AS characters_read,
        COALESCE(SUM(duration_ms), 0) AS duration_ms,
        COUNT(*) AS session_count,
        COUNT(DISTINCT novel_id) AS unique_novels
      FROM reading_sessions
      WHERE ended_at >= ? AND duration_ms > 0
    `,
    cutoff,
  );

  const today = await database.getFirstAsync<{ duration_ms: number | null }>(`
    SELECT COALESCE(SUM(duration_ms), 0) AS duration_ms
    FROM reading_sessions
    WHERE duration_ms > 0
      AND date(ended_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')
  `);

  const last7Days = await database.getFirstAsync<{ duration_ms: number | null }>(
    `
      SELECT COALESCE(SUM(duration_ms), 0) AS duration_ms
      FROM reading_sessions
      WHERE ended_at >= ? AND duration_ms > 0
    `,
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  );

  const finished = await database.getFirstAsync<{ count: number }>(`
    SELECT COUNT(*) AS count FROM reading_history WHERE is_finished = 1
  `);

  const dailyRows = await database.getAllAsync<{
    characters_read: number;
    date: string;
    duration_ms: number;
    sessions: number;
  }>(
    `
      SELECT
        date(ended_at / 1000, 'unixepoch', 'localtime') AS date,
        COALESCE(SUM(duration_ms), 0) AS duration_ms,
        COALESCE(SUM(characters_read), 0) AS characters_read,
        COUNT(*) AS sessions
      FROM reading_sessions
      WHERE ended_at >= ? AND duration_ms > 0
      GROUP BY date
      ORDER BY date ASC
    `,
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  );

  const topRows = await database.getAllAsync<{
    author_name: string;
    characters_read: number;
    duration_ms: number;
    novel_id: number;
    sessions: number;
    title: string;
  }>(
    `
      SELECT
        novel_id,
        MAX(title) AS title,
        MAX(author_name) AS author_name,
        COALESCE(SUM(duration_ms), 0) AS duration_ms,
        COALESCE(SUM(characters_read), 0) AS characters_read,
        COUNT(*) AS sessions
      FROM reading_sessions
      WHERE ended_at >= ? AND duration_ms > 0
      GROUP BY novel_id
      ORDER BY duration_ms DESC, characters_read DESC
      LIMIT 5
    `,
    cutoff,
  );

  return {
    totalDurationMs: totals?.duration_ms ?? 0,
    todayDurationMs: today?.duration_ms ?? 0,
    last7DaysDurationMs: last7Days?.duration_ms ?? 0,
    charactersRead: totals?.characters_read ?? 0,
    sessionCount: totals?.session_count ?? 0,
    uniqueNovels: totals?.unique_novels ?? 0,
    finishedNovels: finished?.count ?? 0,
    daily: fillReadingDayBuckets(
      dailyRows.map((row) => ({
        date: row.date,
        durationMs: row.duration_ms,
        charactersRead: row.characters_read,
        sessions: row.sessions,
      })),
      7,
    ),
    topNovels: topRows.map((row) => ({
      novelId: row.novel_id,
      title: row.title,
      authorName: row.author_name,
      durationMs: row.duration_ms,
      charactersRead: row.characters_read,
      sessions: row.sessions,
    })),
  };
}

export async function clearReadingStatistics(): Promise<void> {
  const database = await getStatsDatabase();
  await database.runAsync('DELETE FROM reading_sessions');
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}
