import { describe, expect, test } from 'bun:test';

import type { NovelBlock } from './novel-format';
import {
  createReaderSpeechChunks,
  findSpeechChunkIndex,
  splitSpeechText,
} from './reader-speech';

describe('splitSpeechText', () => {
  test('文末記号を保ったまま上限以内へ分割する', () => {
    expect(splitSpeechText('一文目です。二文目です。三文目です。', 8)).toEqual([
      '一文目です。',
      '二文目です。',
      '三文目です。',
    ]);
  });

  test('上限を超える単一文を固定長で分割する', () => {
    expect(splitSpeechText('abcdefghijklmnop', 6)).toEqual([
      'abcdef',
      'ghijkl',
      'mnop',
    ]);
  });
});

describe('createReaderSpeechChunks', () => {
  const blocks: NovelBlock[] = [
    { type: 'chapter', title: '第一章' },
    { type: 'text', text: '本文です。続きです。' },
    { type: 'image', id: '1' },
    { type: 'pagebreak' },
    { type: 'text', text: '次の本文です。' },
  ];

  test('章題と本文だけを読み上げ対象にする', () => {
    const chunks = createReaderSpeechChunks(blocks, 120);
    expect(chunks.map((chunk) => chunk.blockIndex)).toEqual([0, 1, 4]);
    expect(chunks[0]?.text).toContain('第一章');
  });

  test('現在ブロック以降の最初のチャンクを返す', () => {
    const chunks = createReaderSpeechChunks(blocks, 120);
    expect(findSpeechChunkIndex(chunks, 1)).toBe(1);
    expect(findSpeechChunkIndex(chunks, 3)).toBe(2);
  });
});
