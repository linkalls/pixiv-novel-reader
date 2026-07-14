import type { PixivNovelItem } from '@book000/pixivts';

import { getLibraryDatabase } from './library-db';

export type ReaderHighlightColor = 'yellow' | 'blue' | 'pink' | 'green';

export interface ReaderHighlight {
  id: number;
  novelId: number;
  title: string;
  authorName: string;
  blockIndex: number;
  excerpt: string;
  note: string;
  color: ReaderHighlightColor;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReaderHighlightInput {
  detail: PixivNovelItem;
  blockIndex: number;
  excerpt: string;
  note?: string;
  color: ReaderHighlightColor;
}

let schemaPromise: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  const database = await getLibraryDatabase();

  if (!schemaPromise) {
    schemaPromise = database
      .execAsync(`
        CREATE TABLE IF NOT EXISTS reader_highlights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          novel_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          block_index INTEGER NOT NULL,
          excerpt TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'yellow',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(novel_id, block_index, excerpt)
        );

        CREATE INDEX IF NOT EXISTS reader_highlights_novel_idx
          ON reader_highlights(novel_id, block_index ASC);
        CREATE INDEX IF NOT EXISTS reader_highlights_updated_idx
          ON reader_highlights(updated_at DESC);
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
}

export async function createReaderHighlight(
  input: CreateReaderHighlightInput,
): Promise<ReaderHighlight> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  const now = Date.now();
  const excerpt = normalizeExcerpt(input.excerpt);
  const note = input.note?.trim() ?? '';

  if (!excerpt) {
    throw new Error('ハイライトする本文がありません');
  }

  await database.runAsync(
    `
      INSERT INTO reader_highlights (
        novel_id, title, author_name, block_index, excerpt,
        note, color, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id, block_index, excerpt) DO UPDATE SET
        note = excluded.note,
        color = excluded.color,
        updated_at = excluded.updated_at
    `,
    input.detail.id,
    input.detail.title,
    input.detail.user.name,
    Math.max(0, Math.floor(input.blockIndex)),
    excerpt,
    note,
    input.color,
    now,
    now,
  );

  const row = await database.getFirstAsync<HighlightRow>(
    `
      SELECT * FROM reader_highlights
      WHERE novel_id = ? AND block_index = ? AND excerpt = ?
    `,
    input.detail.id,
    Math.max(0, Math.floor(input.blockIndex)),
    excerpt,
  );

  if (!row) {
    throw new Error('ハイライトを保存できませんでした');
  }

  return mapHighlight(row);
}

export async function listReaderHighlights(
  novelId?: number,
): Promise<ReaderHighlight[]> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  const rows = novelId
    ? await database.getAllAsync<HighlightRow>(
        `
          SELECT * FROM reader_highlights
          WHERE novel_id = ?
          ORDER BY block_index ASC, created_at ASC
        `,
        novelId,
      )
    : await database.getAllAsync<HighlightRow>(`
        SELECT * FROM reader_highlights
        ORDER BY updated_at DESC, id DESC
      `);

  return rows.map(mapHighlight);
}

export async function deleteReaderHighlight(id: number): Promise<void> {
  await ensureSchema();
  const database = await getLibraryDatabase();
  await database.runAsync('DELETE FROM reader_highlights WHERE id = ?', id);
}

interface HighlightRow {
  id: number;
  novel_id: number;
  title: string;
  author_name: string;
  block_index: number;
  excerpt: string;
  note: string;
  color: string;
  created_at: number;
  updated_at: number;
}

function mapHighlight(row: HighlightRow): ReaderHighlight {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    authorName: row.author_name,
    blockIndex: row.block_index,
    excerpt: row.excerpt,
    note: row.note,
    color: isHighlightColor(row.color) ? row.color : 'yellow',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isHighlightColor(value: string): value is ReaderHighlightColor {
  return value === 'yellow' || value === 'blue' || value === 'pink' || value === 'green';
}

function normalizeExcerpt(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 1000);
}
