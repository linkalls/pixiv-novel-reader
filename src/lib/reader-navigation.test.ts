import { describe, expect, test } from 'bun:test';

import type { NovelBlock } from './novel-format';
import { buildReaderToc, searchReaderBlocks } from './reader-navigation';

const BLOCKS: NovelBlock[] = [
  { type: 'text', text: '冒頭の文章です。猫が歩いています。' },
  { type: 'chapter', title: '第一章　出会い' },
  { type: 'text', text: '雨の日に猫と出会った。猫は二度鳴いた。' },
  { type: 'pagebreak' },
  { type: 'chapter', title: '第二章' },
  { type: 'text', text: '翌朝、旅が始まった。' },
];

describe('buildReaderToc', () => {
  test('冒頭・章・改ページを順番に生成する', () => {
    expect(buildReaderToc(BLOCKS)).toEqual([
      { blockIndex: 0, label: '作品冒頭', type: 'start' },
      { blockIndex: 1, label: '第一章　出会い', type: 'chapter' },
      { blockIndex: 3, label: '2ページ目', type: 'page' },
      { blockIndex: 4, label: '第二章', type: 'chapter' },
    ]);
  });
});

describe('searchReaderBlocks', () => {
  test('同じブロック内の複数一致を返す', () => {
    const matches = searchReaderBlocks(BLOCKS, '猫');
    expect(matches.map((match) => match.blockIndex)).toEqual([0, 2, 2]);
    expect(matches[0]?.preview).toContain('猫');
  });

  test('全角半角と英字大小を正規化する', () => {
    const blocks: NovelBlock[] = [{ type: 'text', text: 'ＡＢＣ test' }];
    expect(searchReaderBlocks(blocks, 'abc')).toHaveLength(1);
    expect(searchReaderBlocks(blocks, 'TEST')).toHaveLength(1);
  });

  test('空検索では何も返さない', () => {
    expect(searchReaderBlocks(BLOCKS, '   ')).toEqual([]);
  });
});
