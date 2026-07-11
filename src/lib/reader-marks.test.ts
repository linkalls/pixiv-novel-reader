import { describe, expect, test } from 'bun:test';
import type { NovelBlock } from './novel-format';

import {
  createReaderMarkExcerpt,
  findReaderBlockAtOffset,
} from './reader-marks';

describe('findReaderBlockAtOffset', () => {
  test('現在位置より手前の最も近いブロックを返す', () => {
    expect(
      findReaderBlockAtOffset({ 0: 0, 1: 300, 2: 650 }, 100, 500),
    ).toBe(1);
  });

  test('座標がなければ先頭を返す', () => {
    expect(findReaderBlockAtOffset({}, 0, 500)).toBe(0);
  });
});

describe('createReaderMarkExcerpt', () => {
  const blocks: NovelBlock[] = [
    { type: 'pagebreak' },
    { type: 'chapter', title: '第一章' },
    { type: 'text', text: 'これは本文の抜粋です。' },
  ];

  test('章題を抜粋に使う', () => {
    expect(createReaderMarkExcerpt(blocks, 1)).toBe('第一章');
  });

  test('非テキストなら近くの本文を使う', () => {
    expect(createReaderMarkExcerpt(blocks, 0)).toBe('第一章');
  });

  test('長文を省略する', () => {
    expect(
      createReaderMarkExcerpt([{ type: 'text', text: 'abcdefghij' }], 0, 6),
    ).toBe('abcde…');
  });
});
