import { describe, expect, test } from 'bun:test';

import { formatNovelText, parseNovelBlocks } from './novel-format';

describe('parseNovelBlocks', () => {
  test('章・改ページ・挿絵を別ブロックへ分解する', () => {
    const blocks = parseNovelBlocks(
      '冒頭\n[chapter:第一章]\n本文[newpage][uploadedimage:42]終わり',
    );

    expect(blocks).toEqual([
      { type: 'text', text: '冒頭' },
      { type: 'chapter', title: '第一章' },
      { type: 'text', text: '本文' },
      { type: 'pagebreak' },
      { type: 'image', id: '42' },
      { type: 'text', text: '終わり' },
    ]);
  });

  test('ルビを読みやすい括弧表記へ変換する', () => {
    expect(formatNovelText('[[rb:早稲田 > わせだ]]へ行く')).toBe(
      '早稲田（わせだ）へ行く',
    );
  });

  test('段落先頭の全角空白を維持する', () => {
    const blocks = parseNovelBlocks('　字下げした段落');

    expect(blocks).toEqual([{ type: 'text', text: '　字下げした段落' }]);
  });
});
