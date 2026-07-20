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
  maxBookmarks: number | null;
  minViews: number | null;
  maxViews: number | null;
  minComments: number | null;
  dateRange: 'all' | 'day' | 'three_days' | 'week' | 'month' | 'three_months' | 'year';
  seriesMode: 'all' | 'series' | 'standalone';
  originalMode: 'all' | 'original' | 'fanwork';
  bookmarkState: 'all' | 'bookmarked' | 'not_bookmarked';
  ageRating: 'all' | 'general' | 'r18' | 'r18g';
  aiMode: 'all' | 'exclude' | 'partial' | 'full';
  language: 'all' | 'ja' | 'en' | 'ko' | 'zh-cn' | 'zh-tw' | 'other';
  requiredTags: string[];
  excludedTags: string[];
  hideFinished: boolean;
}

const DEFAULT_SEARCH_FILTERS: AdvancedSearchFilters = {
  minCharacters: null,
  maxCharacters: null,
  minBookmarks: null,
  maxBookmarks: null,
  minViews: null,
  maxViews: null,
  minComments: null,
  dateRange: 'all',
  seriesMode: 'all',
  originalMode: 'all',
  bookmarkState: 'all',
  ageRating: 'all',
  aiMode: 'all',
  language: 'all',
  requiredTags: [],
  excludedTags: [],
  hideFinished: false,
};

let schemaPromise: Promise<void> | null = null;

export async function ensureContentPreferencesStorage(): Promise<void> {
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
  await ensureContentPreferencesStorage();
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
  await ensureContentPreferencesStorage();
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
  await ensureContentPreferencesStorage();
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
  await ensureContentPreferencesStorage();
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
  const requiredTags = filters.requiredTags.map(normalizeTagKey).filter(Boolean);
  const excludedTags = filters.excludedTags.map(normalizeTagKey).filter(Boolean);

  return novels.filter((novel) => {
    if (filters.minCharacters !== null && novel.textLength < filters.minCharacters) return false;
    if (filters.maxCharacters !== null && novel.textLength > filters.maxCharacters) return false;
    if (filters.minBookmarks !== null && novel.totalBookmarks < filters.minBookmarks) return false;
    if (filters.maxBookmarks !== null && novel.totalBookmarks > filters.maxBookmarks) return false;
    if (filters.minViews !== null && novel.totalView < filters.minViews) return false;
    if (filters.maxViews !== null && novel.totalView > filters.maxViews) return false;
    if (filters.minComments !== null && novel.totalComments < filters.minComments) return false;

    if (filters.ageRating === 'general' && novel.xRestrict !== 0) return false;
    if (filters.ageRating === 'r18' && novel.xRestrict !== 1) return false;
    if (filters.ageRating === 'r18g' && novel.xRestrict !== 2) return false;
    if (filters.aiMode === 'exclude' && novel.novelAiType > 0) return false;
    if (filters.aiMode === 'partial' && novel.novelAiType !== 1) return false;
    if (filters.aiMode === 'full' && novel.novelAiType !== 2) return false;

    if (filters.originalMode === 'original' && !novel.isOriginal) return false;
    if (filters.originalMode === 'fanwork' && novel.isOriginal) return false;
    if (filters.bookmarkState === 'bookmarked' && !novel.isBookmarked) return false;
    if (filters.bookmarkState === 'not_bookmarked' && novel.isBookmarked) return false;

    if (filters.dateRange !== 'all') {
      const ageMs = Date.now() - new Date(novel.createDate).getTime();
      const maximumAgeMs = {
        day: 86_400_000,
        three_days: 3 * 86_400_000,
        week: 7 * 86_400_000,
        month: 31 * 86_400_000,
        three_months: 93 * 86_400_000,
        year: 366 * 86_400_000,
      }[filters.dateRange];
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumAgeMs) return false;
    }
    const hasSeries = Object.keys(novel.series).length > 0;
    if (filters.seriesMode === 'series' && !hasSeries) return false;
    if (filters.seriesMode === 'standalone' && hasSeries) return false;
    if (filters.hideFinished && finishedNovelIds.has(novel.id)) return false;

    const novelTags = new Set(novel.tags.map((tag) => normalizeTagKey(tag.name)));
    if (requiredTags.some((tag) => !novelTags.has(tag))) return false;
    if (excludedTags.some((tag) => novelTags.has(tag))) return false;
    return true;
  });
}

export function normalizeAdvancedSearchFilters(value: unknown): AdvancedSearchFilters {
  return normalizeSearchFilters(value);
}


async function upsertMute(
  kind: ContentMuteKind,
  value: string,
  label: string,
): Promise<void> {
  await ensureContentPreferencesStorage();
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
  const legacyAgeRating = candidate.includeR18 === false ? 'general' : 'all';
  const legacyAiMode = candidate.includeAi === false ? 'exclude' : 'all';
  return {
    minCharacters: normalizeNullableNonNegativeNumber(candidate.minCharacters),
    maxCharacters: normalizeNullableNonNegativeNumber(candidate.maxCharacters),
    minBookmarks: normalizeNullableNonNegativeNumber(candidate.minBookmarks),
    maxBookmarks: normalizeNullableNonNegativeNumber(candidate.maxBookmarks),
    minViews: normalizeNullableNonNegativeNumber(candidate.minViews),
    maxViews: normalizeNullableNonNegativeNumber(candidate.maxViews),
    minComments: normalizeNullableNonNegativeNumber(candidate.minComments),
    dateRange:
      candidate.dateRange === 'day' || candidate.dateRange === 'three_days' ||
      candidate.dateRange === 'week' || candidate.dateRange === 'month' ||
      candidate.dateRange === 'three_months' || candidate.dateRange === 'year'
        ? candidate.dateRange : 'all',
    seriesMode:
      candidate.seriesMode === 'series' || candidate.seriesMode === 'standalone'
        ? candidate.seriesMode : 'all',
    originalMode:
      candidate.originalMode === 'original' || candidate.originalMode === 'fanwork'
        ? candidate.originalMode : 'all',
    bookmarkState:
      candidate.bookmarkState === 'bookmarked' || candidate.bookmarkState === 'not_bookmarked'
        ? candidate.bookmarkState : 'all',
    ageRating:
      candidate.ageRating === 'general' || candidate.ageRating === 'r18' || candidate.ageRating === 'r18g'
        ? candidate.ageRating : legacyAgeRating,
    aiMode:
      candidate.aiMode === 'exclude' || candidate.aiMode === 'partial' || candidate.aiMode === 'full'
        ? candidate.aiMode : legacyAiMode,
    language:
      candidate.language === 'ja' || candidate.language === 'en' ||
      candidate.language === 'ko' || candidate.language === 'zh-cn' ||
      candidate.language === 'zh-tw' || candidate.language === 'other'
        ? candidate.language
        : candidate.language === 'japanese'
          ? 'ja'
          : candidate.language === 'english'
            ? 'en'
            : candidate.language === 'korean'
              ? 'ko'
              : candidate.language === 'chinese'
                ? 'zh-cn'
                : 'all',
    requiredTags: normalizeTagList(candidate.requiredTags),
    excludedTags: normalizeTagList(candidate.excludedTags),
    hideFinished: candidate.hideFinished === true,
  };
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeTag(String(item))).filter(Boolean))].slice(0, 20);
}

function normalizeTagKey(value: string): string {
  return normalizeTag(value).toLocaleLowerCase('ja-JP');
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
