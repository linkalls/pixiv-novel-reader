import type { NovelBlock } from './novel-format';
import { getSearchableBlockText } from './reader-navigation';

/** 現在の絶対スクロール位置から、画面上端に最も近い本文ブロックを求める。 */
export function findReaderBlockAtOffset(
  blockOffsets: Record<number, number>,
  novelBodyOffset: number,
  scrollOffset: number,
): number {
  const relativeOffset = Math.max(0, scrollOffset - novelBodyOffset + 64);
  const entries = Object.entries(blockOffsets)
    .map(([index, offset]) => ({ index: Number(index), offset }))
    .filter(
      (entry) =>
        Number.isInteger(entry.index) && Number.isFinite(entry.offset),
    )
    .sort((left, right) => left.offset - right.offset);

  if (entries.length === 0) {
    return 0;
  }

  let currentIndex = entries[0]?.index ?? 0;
  for (const entry of entries) {
    if (entry.offset > relativeOffset) {
      break;
    }
    currentIndex = entry.index;
  }

  return currentIndex;
}

/** しおり一覧で内容が分かるよう、該当ブロック周辺を短い抜粋へする。 */
export function createReaderMarkExcerpt(
  blocks: NovelBlock[],
  blockIndex: number,
  maxLength = 120,
): string {
  const candidates = [
    blocks[blockIndex],
    blocks[blockIndex + 1],
    blocks[blockIndex - 1],
  ];

  for (const block of candidates) {
    if (!block) {
      continue;
    }

    const text = getSearchableBlockText(block).replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      return text.length > maxLength
        ? `${text.slice(0, Math.max(1, maxLength - 1))}…`
        : text;
    }
  }

  return '本文内のしおり';
}
