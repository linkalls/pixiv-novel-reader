import type { PixivNovelItem } from '@book000/pixivts';

import { getLibraryDatabase } from './library-db';

export type ContentMuteKind = 'author' | 'tag';

export interface ContentMute {
  kind: ContentMuteKind;
  value: string;
  label: string;
  createdAt: number;
}

export interface AdvancedSearchFilters {
  minCharacters: number | null;
  maxCharacters: number | null;
  minBookmarks: number | null;
  includeR18: boolean;
  includeAi: boolean;
  seriesMode: 'all' | 'series' | 'standalone';
  hideFinished: boolean;
}

const DEFAULT_SEARCH_FILTERS: AdvancedSearchFilters = {
  minCharacters: null,
  maxCharacters: null,
  minBookmarks: null,
  includeR18: true,
  includeAi: true,
  seriesMode: 'all',
  hideFinished: false,
};

let schemaPromise: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  const database = await getLibraryDatabase();

  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS content_mutes (
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          label TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (kind, value)
        );

        CREATE TABLE IF NOT EXISTS local_preferences (
          key TEXT PRIMARY KEY NOT NULL,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS content_mutes_created_idx
          ON content_mutes(created_at DESC);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
}

export async function listContentMutes(): Promise<ContentMute[]> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<{
    kind: string;
    value: string;
    label: string;
    created_at: number;
  }>(`
    SELECT kind, value, label, created_at
    FROM content_mutes
    ORDER BY created_at DESC
  `);

  return rows
    .filter(
      (row): row is typeof row & { kind: ContentMuteKind } =>
        row.kind === 'author' || row.kind === 'tag',
    )
    .map((row) => ({
      kind: row.kind,
      value: row.value,
      label: row.label,
      createdAt: row.created_at,
    }));
}

export async function muteAuthor(
  userId: number,
  authorName: string,
): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('作者IDが不正です');
  }

  await upsertMute('author', String(userId), authorName.trim() || String(userId));
}

export async function muteTag(tagName: string): Promise<void> {
  const normalized = normalizeTag(tagName);
  if (!normalized) {
    throw new Error('タグ名が空です');
  }

  await upsertMute('tag', normalized.toLocaleLowerCase('ja-JP'), `#${normalized}`);
}

export async function removeContentMute(
  kind: ContentMuteKind,
  value: string,
): Promise<void> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  await database.runAsync(
    'DELETE FROM content_mutes WHERE kind = ? AND value = ?',
    kind,
    value,
  );
}

export async function filterMutedNovels(
  novels: readonly PixivNovelItem[],
): Promise<PixivNovelItem[]> {
  const mutes = await listContentMutes();
  const mutedAuthors = new Set(
    mutes.filter((mute) => mute.kind === 'author').map((mute) => mute.value),
  );
  const mutedTags = new Set(
    mutes.filter((mute) => mute.kind === 'tag').map((mute) => mute.value),
  );

  return novels.filter((novel) => {
    if (mutedAuthors.has(String(novel.user.id))) {
      return false;
    }

    return !novel.tags.some((tag) =>
      mutedTags.has(normalizeTag(tag.name).toLocaleLowerCase('ja-JP')),
    );
  });
}

export async function getAdvancedSearchFilters(): Promise<AdvancedSearchFilters> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{ value_json: string }>(
    'SELECT value_json FROM local_preferences WHERE key = ?',
    'advanced-search-filters',
  );

  if (!row) {
    return { ...DEFAULT_SEARCH_FILTERS };
  }

  try {
    return normalizeSearchFilters(JSON.parse(row.value_json));
  } catch {
    return { ...DEFAULT_SEARCH_FILTERS };
  }
}

export async function saveAdvancedSearchFilters(
  filters: AdvancedSearchFilters,
): Promise<void> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  const normalized = normalizeSearchFilters(filters);
  await database.runAsync(
    `
      INSERT INTO local_preferences (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    'advanced-search-filters',
    JSON.stringify(normalized),
    Date.now(),
  );
}

export function applyAdvancedSearchFilters(
  novels: readonly PixivNovelItem[],
  filters: AdvancedSearchFilters,
  finishedNovelIds: ReadonlySet<number> = new Set<number>(),
): PixivNovelItem[] {
  return novels.filter((novel) => {
    if (
      filters.minCharacters !== null &&
      novel.textLength < filters.minCharacters
    ) {
      return false;
    }
    if (
      filters.maxCharacters !== null &&
      novel.textLength > filters.maxCharacters
    ) {
      return false;
    }
    if (
      filters.minBookmarks !== null &&
      novel.totalBookmarks < filters.minBookmarks
    ) {
      return false;
    }
    if (!filters.includeR18 && novel.xRestrict > 0) {
      return false;
    }
    if (!filters.includeAi && novel.novelAiType > 0) {
      return false;
    }
    if (filters.seriesMode === 'series' && !novel.series) {
      return false;
    }
    if (filters.seriesMode === 'standalone' && novel.series) {
      return false;
    }
    if (filters.hideFinished && finishedNovelIds.has(novel.id)) {
      return false;
    }
    return true;
  });
}

async function upsertMute(
  kind: ContentMuteKind,
  value: string,
  label: string,
): Promise<void> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  await database.runAsync(
    `
      INSERT INTO content_mutes (kind, value, label, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(kind, value) DO UPDATE SET
        label = excluded.label,
        created_at = excluded.created_at
    `,
    kind,
    value,
    label,
    Date.now(),
  );
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/\s+/g, ' ');
}

function normalizeSearchFilters(value: unknown): AdvancedSearchFilters {
  const candidate = isRecord(value) ? value : {};
  return {
    minCharacters: normalizeNullableNonNegativeNumber(candidate.minCharacters),
    maxCharacters: normalizeNullableNonNegativeNumber(candidate.maxCharacters),
    minBookmarks: normalizeNullableNonNegativeNumber(candidate.minBookmarks),
    includeR18: candidate.includeR18 !== false,
    includeAi: candidate.includeAi !== false,
    seriesMode:
      candidate.seriesMode === 'series' || candidate.seriesMode === 'standalone'
        ? candidate.seriesMode
        : 'all',
    hideFinished: candidate.hideFinished === true,
  };
}

function normalizeNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
