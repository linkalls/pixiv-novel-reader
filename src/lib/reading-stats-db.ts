import type { PixivNovelItem } from '@book000/pixivts';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getLibraryDatabase } from './library-db';
import {
  estimateCharactersRead,
  fillReadingDayBuckets,
  type ReadingDayBucket,
} from './reading-stats';

const CURRENT_TRACKING_VERSION = 2;
const MAX_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export interface ReadingStatistics {
  charactersRead: number;
  currentStreakDays: number;
  daily: ReadingDayBucket[];
  dailyGoalMinutes: number;
  finishedNovels: number;
  longestStreakDays: number;
  last7DaysDurationMs: number;
  sessionCount: number;
  todayDurationMs: number;
  topAuthors: ReadingTopAuthor[];
  topNovels: ReadingTopNovel[];
  topTags: ReadingTopTag[];
  totalDurationMs: number;
  uniqueNovels: number;
  weeklyGoalMinutes: number;
}

export interface ReadingGoals {
  dailyMinutes: number;
  weeklyMinutes: number;
}

export interface ReadingTopNovel {
  authorName: string;
  charactersRead: number;
  durationMs: number;
  novelId: number;
  sessions: number;
  title: string;
}

export interface ReadingTopAuthor {
  authorName: string;
  finishedWorks: number;
  latestReadAt: number;
  works: number;
}

export interface ReadingTopTag {
  tagName: string;
  works: number;
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
    schemaPromise = initializeReadingStatsSchema(database).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return database;
}

async function initializeReadingStatsSchema(
  database: SQLiteDatabase,
): Promise<void> {
  await database.execAsync(`
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
      characters_read INTEGER NOT NULL DEFAULT 0,
      tracking_version INTEGER NOT NULL DEFAULT ${CURRENT_TRACKING_VERSION}
    );

    CREATE INDEX IF NOT EXISTS reading_sessions_ended_at_idx
      ON reading_sessions(ended_at DESC);
    CREATE INDEX IF NOT EXISTS reading_sessions_novel_idx
      ON reading_sessions(novel_id, ended_at DESC);

    CREATE TABLE IF NOT EXISTS reading_goals (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_minutes INTEGER NOT NULL DEFAULT 20,
      weekly_minutes INTEGER NOT NULL DEFAULT 120,
      updated_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO reading_goals (
      id, daily_minutes, weekly_minutes, updated_at
    ) VALUES (1, 20, 120, ${Date.now()});
  `);

  const columns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(reading_sessions)',
  );
  if (!columns.some((column) => column.name === 'tracking_version')) {
    await database.execAsync(`
      ALTER TABLE reading_sessions
      ADD COLUMN tracking_version INTEGER NOT NULL DEFAULT 1;
    `);
  }

  // v1は画面を離れた時間やバックグラウンド滞在まで含む壁時計計測だった。
  // 正確な実読書時間へ復元できないため、壊れた時間だけ破棄して作品数・文字数は残す。
  await database.runAsync(
    `
      UPDATE reading_sessions
      SET duration_ms = 0
      WHERE tracking_version < ? AND duration_ms <> 0
    `,
    CURRENT_TRACKING_VERSION,
  );
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
        start_progress, end_progress, characters_read,
        tracking_version
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)
    `,
    detail.id,
    detail.title,
    detail.user.name,
    Math.max(0, detail.textLength),
    now,
    now,
    clampProgress(startProgress),
    clampProgress(startProgress),
    CURRENT_TRACKING_VERSION,
  );
  return result.lastInsertRowId;
}

export async function finishReadingSession(
  sessionId: number,
  endProgress: number,
  activeDurationMs: number,
): Promise<void> {
  await persistReadingSession(
    sessionId,
    endProgress,
    activeDurationMs,
    true,
  );
}

/** 読書中の進捗と実読書時間を定期保存し、強制終了時にも統計を残す。 */
export async function updateReadingSession(
  sessionId: number,
  endProgress: number,
  activeDurationMs: number,
): Promise<void> {
  await persistReadingSession(
    sessionId,
    endProgress,
    activeDurationMs,
    false,
  );
}

async function persistReadingSession(
  sessionId: number,
  endProgress: number,
  activeDurationMs: number,
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
  const durationMs = sanitizeDuration(activeDurationMs);

  if (durationMs < 5_000) {
    if (finalize) {
      await database.runAsync(
        'DELETE FROM reading_sessions WHERE id = ?',
        sessionId,
      );
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
      SET
        ended_at = MAX(ended_at, ?),
        duration_ms = MAX(duration_ms, ?),
        end_progress = MAX(end_progress, ?),
        characters_read = MAX(characters_read, ?),
        tracking_version = ?
      WHERE id = ?
    `,
    endedAt,
    durationMs,
    normalizedEndProgress,
    charactersRead,
    CURRENT_TRACKING_VERSION,
    sessionId,
  );
}

export async function getReadingGoals(): Promise<ReadingGoals> {
  const database = await getStatsDatabase();
  const row = await database.getFirstAsync<{
    daily_minutes: number;
    weekly_minutes: number;
  }>('SELECT daily_minutes, weekly_minutes FROM reading_goals WHERE id = 1');
  return {
    dailyMinutes: clampGoalMinutes(row?.daily_minutes, 20),
    weeklyMinutes: clampGoalMinutes(row?.weekly_minutes, 120),
  };
}

export async function setReadingGoals(goals: ReadingGoals): Promise<void> {
  const database = await getStatsDatabase();
  await database.runAsync(
    `
      INSERT INTO reading_goals (
        id, daily_minutes, weekly_minutes, updated_at
      ) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        daily_minutes = excluded.daily_minutes,
        weekly_minutes = excluded.weekly_minutes,
        updated_at = excluded.updated_at
    `,
    clampGoalMinutes(goals.dailyMinutes, 20),
    clampGoalMinutes(goals.weeklyMinutes, 120),
    Date.now(),
  );
}

export async function getReadingStatistics(days = 30): Promise<ReadingStatistics> {
  const database = await getStatsDatabase();
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const goals = await getReadingGoals();
  const activeDateRows = await database.getAllAsync<{ date: string }>(`
    SELECT DISTINCT date(ended_at / 1000, 'unixepoch', 'localtime') AS date
    FROM reading_sessions
    WHERE duration_ms >= 5000
    ORDER BY date ASC
  `);
  const streaks = calculateReadingStreaks(
    activeDateRows.map((row) => row.date),
  );

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
        COALESCE(SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END), 0)
          AS session_count,
        COUNT(DISTINCT novel_id) AS unique_novels
      FROM reading_sessions
      WHERE ended_at >= ?
        AND (duration_ms > 0 OR characters_read > 0)
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
        COALESCE(SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END), 0)
          AS sessions
      FROM reading_sessions
      WHERE ended_at >= ?
        AND (duration_ms > 0 OR characters_read > 0)
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
        COALESCE(SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END), 0)
          AS sessions
      FROM reading_sessions
      WHERE ended_at >= ?
        AND (duration_ms > 0 OR characters_read > 0)
      GROUP BY novel_id
      ORDER BY duration_ms DESC, characters_read DESC
      LIMIT 5
    `,
    cutoff,
  );

  const authorRows = await database.getAllAsync<{
    author_name: string;
    finished_works: number;
    latest_read_at: number;
    works: number;
  }>(`
    SELECT
      author_name,
      COUNT(*) AS works,
      SUM(CASE WHEN is_finished = 1 THEN 1 ELSE 0 END) AS finished_works,
      MAX(last_read_at) AS latest_read_at
    FROM reading_history
    GROUP BY author_name
    ORDER BY works DESC, latest_read_at DESC
    LIMIT 8
  `);

  const tagRows = await database.getAllAsync<{ tags_json: string }>(
    'SELECT tags_json FROM reading_history',
  );
  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    try {
      const tags = JSON.parse(row.tags_json) as unknown;
      if (!Array.isArray(tags)) continue;
      const uniqueTags = new Set(
        tags.filter(
          (tag): tag is string =>
            typeof tag === 'string' && tag.trim().length > 0,
        ),
      );
      for (const tag of uniqueTags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    } catch {
      // 壊れたタグJSONは集計対象から外す。
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0], 'ja'),
    )
    .slice(0, 12)
    .map(([tagName, works]) => ({ tagName, works }));

  return {
    totalDurationMs: totals?.duration_ms ?? 0,
    todayDurationMs: today?.duration_ms ?? 0,
    last7DaysDurationMs: last7Days?.duration_ms ?? 0,
    charactersRead: totals?.characters_read ?? 0,
    currentStreakDays: streaks.current,
    dailyGoalMinutes: goals.dailyMinutes,
    sessionCount: totals?.session_count ?? 0,
    uniqueNovels: totals?.unique_novels ?? 0,
    finishedNovels: finished?.count ?? 0,
    longestStreakDays: streaks.longest,
    daily: fillReadingDayBuckets(
      dailyRows.map((row) => ({
        date: row.date,
        durationMs: row.duration_ms,
        charactersRead: row.characters_read,
        sessions: row.sessions,
      })),
      7,
    ),
    weeklyGoalMinutes: goals.weeklyMinutes,
    topAuthors: authorRows.map((row) => ({
      authorName: row.author_name,
      finishedWorks: row.finished_works,
      latestReadAt: row.latest_read_at,
      works: row.works,
    })),
    topTags,
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

function calculateReadingStreaks(dates: readonly string[]): {
  current: number;
  longest: number;
} {
  const uniqueDates = Array.from(new Set(dates)).sort();
  if (uniqueDates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let running = 1;
  for (let index = 1; index < uniqueDates.length; index += 1) {
    const previous = parseLocalDate(uniqueDates[index - 1]);
    const current = parseLocalDate(uniqueDates[index]);
    const differenceDays = Math.round(
      (current.getTime() - previous.getTime()) / 86_400_000,
    );
    running = differenceDays === 1 ? running + 1 : 1;
    longest = Math.max(longest, running);
  }

  const dateSet = new Set(uniqueDates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let cursor = dateSet.has(formatLocalDate(today)) ? today : yesterday;
  if (!dateSet.has(formatLocalDate(cursor))) {
    return { current: 0, longest };
  }

  let currentStreak = 0;
  while (dateSet.has(formatLocalDate(cursor))) {
    currentStreak += 1;
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current: currentStreak, longest };
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function clampGoalMinutes(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(5, Math.min(1440, Math.round(parsed)))
    : fallback;
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}

function sanitizeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(MAX_SESSION_DURATION_MS, Math.round(durationMs)),
  );
}
