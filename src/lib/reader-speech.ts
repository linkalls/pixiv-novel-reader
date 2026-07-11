import type { NovelBlock } from './novel-format';

export interface ReaderSpeechChunk {
  blockIndex: number;
  index: number;
  text: string;
}

const SENTENCE_BOUNDARY = /(?<=[。！？!?…])|(?<=\n)/u;

/**
 * TTSへ渡せる長さへ本文を分割する。
 * 章題は読み上げるが、改ページ・挿絵・ジャンプ記法は読み上げない。
 */
export function createReaderSpeechChunks(
  blocks: NovelBlock[],
  maxLength = 700,
): ReaderSpeechChunk[] {
  const normalizedMaxLength = Math.max(120, Math.floor(maxLength));
  const chunks: ReaderSpeechChunk[] = [];

  for (const [blockIndex, block] of blocks.entries()) {
    const rawText = getSpeakableBlockText(block);
    if (!rawText) {
      continue;
    }

    for (const part of splitSpeechText(rawText, normalizedMaxLength)) {
      chunks.push({
        blockIndex,
        index: chunks.length,
        text: part,
      });
    }
  }

  return chunks;
}

export function findSpeechChunkIndex(
  chunks: ReaderSpeechChunk[],
  blockIndex: number,
): number {
  if (chunks.length === 0) {
    return -1;
  }

  const exactIndex = chunks.findIndex((chunk) => chunk.blockIndex >= blockIndex);
  return exactIndex >= 0 ? exactIndex : chunks.length - 1;
}

export function splitSpeechText(value: string, maxLength: number): string[] {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    return [];
  }

  const parts = normalized.split(SENTENCE_BOUNDARY).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const text = buffer.trim();
    if (text) {
      chunks.push(text);
    }
    buffer = '';
  };

  for (const part of parts) {
    const text = part.trim();
    if (!text) {
      continue;
    }

    if (text.length > maxLength) {
      flush();
      for (let offset = 0; offset < text.length; offset += maxLength) {
        chunks.push(text.slice(offset, offset + maxLength).trim());
      }
      continue;
    }

    const candidate = buffer ? `${buffer}${text}` : text;
    if (candidate.length > maxLength) {
      flush();
      buffer = text;
    } else {
      buffer = candidate;
    }
  }

  flush();
  return chunks;
}

function getSpeakableBlockText(block: NovelBlock): string | null {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'chapter':
      return `章。${block.title}。`;
    case 'pagebreak':
    case 'image':
    case 'jump':
      return null;
  }
}
