import type { NovelBlock } from './novel-format';

export interface ReaderTocEntry {
  blockIndex: number;
  label: string;
  type: 'start' | 'chapter' | 'page';
}

export interface ReaderSearchMatch {
  blockIndex: number;
  matchIndex: number;
  preview: string;
}

/** 本文ブロックから、作品冒頭・章・改ページのジャンプ先を生成する。 */
export function buildReaderToc(blocks: NovelBlock[]): ReaderTocEntry[] {
  const entries: ReaderTocEntry[] = [
    { blockIndex: 0, label: '作品冒頭', type: 'start' },
  ];
  let pageNumber = 1;

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'chapter' && block.title.trim().length > 0) {
      entries.push({
        blockIndex,
        label: block.title.trim(),
        type: 'chapter',
      });
      return;
    }

    if (block.type === 'pagebreak') {
      pageNumber += 1;
      entries.push({
        blockIndex,
        label: `${pageNumber}ページ目`,
        type: 'page',
      });
    }
  });

  return entries;
}

/** 本文・章題・ジャンプ見出しを検索し、表示用の短い文脈を返す。 */
export function searchReaderBlocks(
  blocks: NovelBlock[],
  rawQuery: string,
  limit = 100,
): ReaderSearchMatch[] {
  const query = normalizeSearchText(rawQuery);

  if (query.length === 0 || limit <= 0) {
    return [];
  }

  const matches: ReaderSearchMatch[] = [];

  blocks.forEach((block, blockIndex) => {
    if (matches.length >= limit) {
      return;
    }

    const originalText = getSearchableBlockText(block);
    const normalizedText = normalizeSearchText(originalText);

    if (normalizedText.length === 0) {
      return;
    }

    let cursor = 0;

    while (cursor < normalizedText.length && matches.length < limit) {
      const matchIndex = normalizedText.indexOf(query, cursor);

      if (matchIndex < 0) {
        break;
      }

      matches.push({
        blockIndex,
        matchIndex,
        preview: createSearchPreview(originalText, matchIndex, query.length),
      });
      cursor = matchIndex + Math.max(1, query.length);
    }
  });

  return matches;
}

export function getSearchableBlockText(block: NovelBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'chapter':
      return block.title;
    case 'jump':
      return block.label;
    case 'image':
    case 'pagebreak':
      return '';
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP');
}

function createSearchPreview(
  originalText: string,
  matchIndex: number,
  matchLength: number,
): string {
  const compact = originalText.replace(/\s+/g, ' ').trim();

  if (compact.length === 0) {
    return '';
  }

  // NFKC前後で文字数が変わるケースは稀なので、表示用文脈では概算位置を使う。
  const start = Math.max(0, matchIndex - 22);
  const end = Math.min(compact.length, matchIndex + matchLength + 36);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${
    end < compact.length ? '…' : ''
  }`;
}
