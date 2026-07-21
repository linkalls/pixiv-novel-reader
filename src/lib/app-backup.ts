import * as DocumentPicker from 'expo-document-picker';
import {
  cacheDirectory,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
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
import { ensureContentPreferencesStorage } from './content-preferences-db';
import { ensureOfflineDownloadQueueStorage } from './offline-download-queue';
import { ensureOfflineSeriesSubscriptionStorage } from './offline-series-subscriptions';
import { getLibraryDatabase } from './library-db';
import { ensureOrganizerStorage } from './organizer-db';
import { ensureReadingStatsStorage } from './reading-stats-db';
import { ensureSearchHistoryStorage } from './search-history-db';

const READER_SETTINGS_KEY = 'pixiv-reader-settings-v1';
const THEME_MODE_KEY = 'app-theme-mode';
const AUTO_BACKUP_ENABLED_KEY = 'automatic-backup-enabled';
const AUTO_BACKUP_LAST_AT_KEY = 'automatic-backup-last-at';
const AUTO_BACKUP_DIRECTORY_NAME = 'pixiv-novel-reader/automatic-backups';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_BACKUP_KEEP_COUNT = 7;

const BACKUP_TABLES = [
  'reading_history',
  'offline_novels',
  'bookshelves',
  'bookshelf_items',
  'reading_queue',
  'reader_marks',
  'recommendation_exclusions',
  'reading_sessions',
  'search_history',
  'content_mutes',
  'local_preferences',
  'reading_goals',
  'offline_download_queue',
  'offline_download_settings',
  'offline_series_subscriptions',
] as const;

type BackupTableName = (typeof BACKUP_TABLES)[number];

const OPTIONAL_BACKUP_TABLES = new Set<BackupTableName>([
  'search_history',
  'content_mutes',
  'local_preferences',
  'reading_goals',
  'offline_download_queue',
  'offline_download_settings',
  'offline_series_subscriptions',
]);

export interface BackupExportResult {
  fileName: string;
  uri: string;
}

export interface BackupRestoreResult {
  restoredRows: number;
}

export interface BackupPreviewSelection {
  exportedAt: number;
  fileName: string;
  payload: AppBackupPayload;
  totalRows: number;
  counts: {
    history: number;
    shelves: number;
    marks: number;
    offline: number;
    sessions: number;
  };
}

export interface AutomaticBackupState {
  enabled: boolean;
  latestFileName: string | null;
  latestUri: string | null;
  latestCreatedAt: number | null;
  backupCount: number;
}

export async function exportAppBackup(): Promise<BackupExportResult> {
  if (!cacheDirectory) {
    throw new Error('バックアップ用の一時保存領域を利用できません');
  }

  const payload = await createBackupPayload();
  const fileName = makeBackupFileName(payload.exportedAt);
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

export async function createAutomaticBackup(): Promise<BackupExportResult> {
  const directory = getAutomaticBackupDirectory();
  await makeDirectoryAsync(directory, { intermediates: true });
  const payload = await createBackupPayload();
  const fileName = makeBackupFileName(payload.exportedAt, true);
  const uri = `${directory}/${fileName}`;
  await writeAsStringAsync(uri, serializeAppBackupPayload(payload));
  await SecureStore.setItemAsync(AUTO_BACKUP_LAST_AT_KEY, String(payload.exportedAt));
  await pruneAutomaticBackups(directory);
  return { fileName, uri };
}

export async function runAutomaticBackupIfDue(): Promise<BackupExportResult | null> {
  const enabled = await isAutomaticBackupEnabled();
  if (!enabled) return null;

  const rawLastAt = await SecureStore.getItemAsync(AUTO_BACKUP_LAST_AT_KEY).catch(
    () => null,
  );
  const lastAt = rawLastAt ? Number(rawLastAt) : 0;
  if (Number.isFinite(lastAt) && Date.now() - lastAt < AUTO_BACKUP_INTERVAL_MS) {
    return null;
  }
  return createAutomaticBackup();
}

export async function setAutomaticBackupEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(AUTO_BACKUP_ENABLED_KEY, enabled ? '1' : '0');
  if (enabled) {
    await runAutomaticBackupIfDue();
  }
}

export async function isAutomaticBackupEnabled(): Promise<boolean> {
  return (
    (await SecureStore.getItemAsync(AUTO_BACKUP_ENABLED_KEY).catch(() => null)) ===
    '1'
  );
}

export async function getAutomaticBackupState(): Promise<AutomaticBackupState> {
  const enabled = await isAutomaticBackupEnabled();
  const directory = getAutomaticBackupDirectory();
  const files = await listAutomaticBackupFiles(directory);
  const latest = files[0] ?? null;
  return {
    enabled,
    latestFileName: latest?.name ?? null,
    latestUri: latest?.uri ?? null,
    latestCreatedAt: latest?.createdAt ?? null,
    backupCount: files.length,
  };
}

export async function restoreLatestAutomaticBackup(): Promise<BackupRestoreResult> {
  const state = await getAutomaticBackupState();
  if (!state.latestUri) {
    throw new Error('自動バックアップがまだありません');
  }
  const raw = await readAsStringAsync(state.latestUri);
  return restoreAppBackup(parseAppBackupPayload(raw));
}

export async function shareLatestAutomaticBackup(): Promise<void> {
  const state = await getAutomaticBackupState();
  if (!state.latestUri) {
    throw new Error('自動バックアップがまだありません');
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(state.latestUri, {
      dialogTitle: '最新の自動バックアップを共有',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  }
}

export async function pickAppBackupForPreview(): Promise<BackupPreviewSelection | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const raw = await readAsStringAsync(asset.uri);
  const payload = parseAppBackupPayload(raw);
  return createBackupPreview(payload, asset.name || 'バックアップ.json');
}

export function createBackupPreview(
  payload: AppBackupPayload,
  fileName = 'バックアップ.json',
): BackupPreviewSelection {
  const rows = Object.values(payload.tables).filter(Array.isArray);
  return {
    exportedAt: payload.exportedAt,
    fileName,
    payload,
    totalRows: rows.reduce((total, table) => total + table.length, 0),
    counts: {
      history: payload.tables.reading_history?.length ?? 0,
      shelves: payload.tables.bookshelves?.length ?? 0,
      marks: payload.tables.reader_marks?.length ?? 0,
      offline: payload.tables.offline_novels?.length ?? 0,
      sessions: payload.tables.reading_sessions?.length ?? 0,
    },
  };
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
    if (OPTIONAL_BACKUP_TABLES.has(table) && payload.tables[table] === undefined) {
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
    ensureContentPreferencesStorage(),
    ensureOfflineDownloadQueueStorage(),
    ensureOfflineSeriesSubscriptionStorage(),
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
    restoredRows += await restoreRows(
      transaction,
      'content_mutes',
      payload.tables.content_mutes ?? [],
    );
    restoredRows += await restoreRows(
      transaction,
      'local_preferences',
      payload.tables.local_preferences ?? [],
    );
    restoredRows += await restoreRows(
      transaction,
      'reading_goals',
      payload.tables.reading_goals ?? [],
    );
    restoredRows += await restoreRows(
      transaction,
      'offline_download_queue',
      payload.tables.offline_download_queue ?? [],
    );
    restoredRows += await restoreRows(
      transaction,
      'offline_download_settings',
      payload.tables.offline_download_settings ?? [],
    );
    restoredRows += await restoreRows(
      transaction,
      'offline_series_subscriptions',
      payload.tables.offline_series_subscriptions ?? [],
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

async function createBackupPayload(): Promise<AppBackupPayload> {
  await Promise.all([
    ensureOrganizerStorage(),
    ensureReadingStatsStorage(),
    ensureSearchHistoryStorage(),
    ensureContentPreferencesStorage(),
    ensureOfflineDownloadQueueStorage(),
    ensureOfflineSeriesSubscriptionStorage(),
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

  return {
    app: 'pixiv-novel-reader',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    settings: {
      appThemeMode: await SecureStore.getItemAsync(THEME_MODE_KEY).catch(() => null),
      readerSettings: await SecureStore.getItemAsync(READER_SETTINGS_KEY).catch(() => null),
    },
    tables,
  };
}

function makeBackupFileName(timestamp: number, automatic = false): string {
  const date = new Date(timestamp);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `pixiv-novel-reader-${automatic ? 'auto-' : ''}backup-${stamp}.json`;
}

function getAutomaticBackupDirectory(): string {
  if (!documentDirectory) {
    throw new Error('自動バックアップの保存領域を利用できません');
  }
  return `${documentDirectory}${AUTO_BACKUP_DIRECTORY_NAME}`;
}

async function listAutomaticBackupFiles(directory: string): Promise<
  { name: string; uri: string; createdAt: number }[]
> {
  const info = await getInfoAsync(directory).catch(() => null);
  if (!info?.exists || !info.isDirectory) return [];
  const names = await readDirectoryAsync(directory).catch(() => []);
  const entries = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const match = name.match(/(\d{8})-(\d{6})/);
      const createdAt = match
        ? new Date(
            Number(match[1].slice(0, 4)),
            Number(match[1].slice(4, 6)) - 1,
            Number(match[1].slice(6, 8)),
            Number(match[2].slice(0, 2)),
            Number(match[2].slice(2, 4)),
            Number(match[2].slice(4, 6)),
          ).getTime()
        : 0;
      return { name, uri: `${directory}/${name}`, createdAt };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
  return entries;
}

async function pruneAutomaticBackups(directory: string): Promise<void> {
  const entries = await listAutomaticBackupFiles(directory);
  for (const entry of entries.slice(AUTO_BACKUP_KEEP_COUNT)) {
    await deleteAsync(entry.uri, { idempotent: true }).catch(() => {});
  }
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
    'finished_at',
    'last_read_at',
  ],
  offline_novels: ['novel_id', 'detail_json', 'content_json', 'saved_at'],
  bookshelves: ['id', 'name', 'created_at', 'sort_order'],
  bookshelf_items: [
    'shelf_id',
    'novel_id',
    'detail_json',
    'added_at',
    'sort_order',
  ],
  reading_queue: ['novel_id', 'detail_json', 'added_at', 'sort_order'],
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
  content_mutes: ['kind', 'value', 'label', 'created_at'],
  local_preferences: ['key', 'value_json', 'updated_at'],
  reading_goals: ['id', 'daily_minutes', 'weekly_minutes', 'updated_at'],
  offline_download_queue: [
    'novel_id',
    'title',
    'author_name',
    'detail_json',
    'status',
    'attempts',
    'error',
    'include_images',
    'created_at',
    'updated_at',
  ],
  offline_download_settings: [
    'id',
    'wifi_only',
    'include_images',
    'delete_finished',
    'updated_at',
  ],
  offline_series_subscriptions: [
    'series_id',
    'anchor_novel_id',
    'title',
    'known_novel_ids_json',
    'created_at',
    'updated_at',
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
