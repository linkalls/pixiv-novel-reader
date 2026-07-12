import * as DocumentPicker from 'expo-document-picker';
import {
  cacheDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BACKUP_FORMAT_VERSION,
  parseAppBackupPayload,
  serializeAppBackupPayload,
  type AppBackupPayload,
} from './app-backup-format';
import { getLibraryDatabase } from './library-db';
import { ensureOrganizerStorage } from './organizer-db';
import { ensureReadingStatsStorage } from './reading-stats-db';
import { ensureSearchHistoryStorage } from './search-history-db';

const READER_SETTINGS_KEY = 'pixiv-reader-settings-v1';
const THEME_MODE_KEY = 'app-theme-mode';

const BACKUP_TABLES = [
  'reading_history',
  'offline_novels',
  'bookshelves',
  'bookshelf_items',
  'reader_marks',
  'recommendation_exclusions',
  'reading_sessions',
  'search_history',
] as const;

type BackupTableName = (typeof BACKUP_TABLES)[number];

export interface BackupExportResult {
  fileName: string;
  uri: string;
}

export interface BackupRestoreResult {
  restoredRows: number;
}

export async function exportAppBackup(): Promise<BackupExportResult> {
  if (!cacheDirectory) {
    throw new Error('バックアップ用の一時保存領域を利用できません');
  }

  await Promise.all([
    ensureOrganizerStorage(),
    ensureReadingStatsStorage(),
    ensureSearchHistoryStorage(),
  ]);
  const database = await getLibraryDatabase();
  const tables: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table}`,
    );
    tables[table] =
      table === 'offline_novels' ? rows.map(makeOfflineRowPortable) : rows;
  }

  const payload: AppBackupPayload = {
    app: 'pixiv-novel-reader',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    settings: {
      appThemeMode: await SecureStore.getItemAsync(THEME_MODE_KEY).catch(
        () => null,
      ),
      readerSettings: await SecureStore.getItemAsync(READER_SETTINGS_KEY).catch(
        () => null,
      ),
    },
    tables,
  };

  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  const fileName = `pixiv-novel-reader-backup-${stamp}.json`;
  const uri = `${cacheDirectory}${fileName}`;
  await writeAsStringAsync(uri, serializeAppBackupPayload(payload));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      dialogTitle: '読書データのバックアップを保存',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  }

  return { fileName, uri };
}

export async function pickAndRestoreAppBackup(): Promise<BackupRestoreResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) {
    return null;
  }

  const raw = await readAsStringAsync(result.assets[0].uri);
  return restoreAppBackup(parseAppBackupPayload(raw));
}

export async function restoreAppBackup(
  payload: AppBackupPayload,
): Promise<BackupRestoreResult> {
  for (const table of BACKUP_TABLES) {
    if (table === 'search_history' && payload.tables[table] === undefined) {
      continue;
    }
    if (!Array.isArray(payload.tables[table])) {
      throw new Error(`バックアップに${table}が含まれていません`);
    }
  }

  await Promise.all([
    ensureOrganizerStorage(),
    ensureReadingStatsStorage(),
    ensureSearchHistoryStorage(),
  ]);
  const database = await getLibraryDatabase();
  let restoredRows = 0;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('PRAGMA defer_foreign_keys = ON;');

    // 子テーブルから削除し、バックアップ時点へ置き換える。
    for (const table of [...BACKUP_TABLES].reverse()) {
      await transaction.runAsync(`DELETE FROM ${table}`);
    }

    restoredRows += await restoreRows(transaction, 'reading_history', payload.tables.reading_history);
    restoredRows += await restoreRows(transaction, 'offline_novels', payload.tables.offline_novels);
    restoredRows += await restoreRows(transaction, 'bookshelves', payload.tables.bookshelves);
    restoredRows += await restoreRows(transaction, 'bookshelf_items', payload.tables.bookshelf_items);
    restoredRows += await restoreRows(transaction, 'reader_marks', payload.tables.reader_marks);
    restoredRows += await restoreRows(
      transaction,
      'recommendation_exclusions',
      payload.tables.recommendation_exclusions,
    );
    restoredRows += await restoreRows(transaction, 'reading_sessions', payload.tables.reading_sessions);
    restoredRows += await restoreRows(
      transaction,
      'search_history',
      payload.tables.search_history ?? [],
    );
  });

  await database.execAsync(`
    INSERT OR IGNORE INTO bookshelves (name, created_at, sort_order)
    VALUES
      ('あとで読む', ${Date.now()}, 0),
      ('お気に入り', ${Date.now() + 1}, 1),
      ('読み返したい', ${Date.now() + 2}, 2);
  `);

  if (payload.settings.appThemeMode) {
    await SecureStore.setItemAsync(
      THEME_MODE_KEY,
      payload.settings.appThemeMode,
    ).catch(() => {});
  }
  if (payload.settings.readerSettings) {
    await SecureStore.setItemAsync(
      READER_SETTINGS_KEY,
      payload.settings.readerSettings,
    ).catch(() => {});
  }

  return { restoredRows };
}

async function restoreRows(
  database: SQLiteDatabase,
  table: BackupTableName,
  rows: unknown[] | undefined,
): Promise<number> {
  if (!rows || rows.length === 0) {
    return 0;
  }

  let count = 0;
  for (const rawRow of rows) {
    if (!isRecord(rawRow)) {
      continue;
    }

    const normalizedRow = normalizeBackupRow(table, rawRow);
    const columns = Object.keys(normalizedRow).filter((column) =>
      TABLE_COLUMNS[table].includes(column),
    );
    if (columns.length === 0) {
      continue;
    }

    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((column) =>
      normalizeSqlValue(normalizedRow[column]),
    );
    await database.runAsync(
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      ...values,
    );
    count += 1;
  }
  return count;
}

function normalizeBackupRow(
  table: BackupTableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (table !== 'reading_sessions') {
    return row;
  }

  const trackingVersion = Number(row.tracking_version);
  if (Number.isFinite(trackingVersion) && trackingVersion >= 2) {
    return row;
  }

  return {
    ...row,
    duration_ms: 0,
    tracking_version: 1,
  };
}

const TABLE_COLUMNS: Record<BackupTableName, string[]> = {
  reading_history: [
    'novel_id',
    'title',
    'author_name',
    'cover_url',
    'tags_json',
    'text_length',
    'progress',
    'scroll_offset',
    'is_finished',
    'last_read_at',
  ],
  offline_novels: ['novel_id', 'detail_json', 'content_json', 'saved_at'],
  bookshelves: ['id', 'name', 'created_at', 'sort_order'],
  bookshelf_items: ['shelf_id', 'novel_id', 'detail_json', 'added_at'],
  reader_marks: [
    'id',
    'novel_id',
    'title',
    'author_name',
    'cover_url',
    'block_index',
    'scroll_offset',
    'progress',
    'excerpt',
    'note',
    'created_at',
    'updated_at',
  ],
  recommendation_exclusions: [
    'novel_id',
    'title',
    'author_name',
    'hidden_at',
  ],
  reading_sessions: [
    'id',
    'novel_id',
    'title',
    'author_name',
    'text_length',
    'started_at',
    'ended_at',
    'duration_ms',
    'start_progress',
    'end_progress',
    'characters_read',
    'tracking_version',
  ],
  search_history: [
    'word',
    'sort',
    'target',
    'searched_at',
    'use_count',
    'is_pinned',
  ],
};

function makeOfflineRowPortable(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof row.content_json !== 'string') {
    return row;
  }

  try {
    const content = JSON.parse(row.content_json) as {
      embeddedImages?: Record<string, string>;
    };
    const portableImages = Object.fromEntries(
      Object.entries(content.embeddedImages ?? {}).filter(
        ([, uri]) => !uri.startsWith('file:'),
      ),
    );
    return {
      ...row,
      content_json: JSON.stringify({ ...content, embeddedImages: portableImages }),
    };
  } catch {
    return row;
  }
}

function normalizeSqlValue(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
