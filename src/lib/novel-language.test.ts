import { describe, expect, test } from 'bun:test';

import { detectTextLanguage } from './novel-language';

describe('detectTextLanguage', () => {
  test('日本語を判定する', () => {
    expect(detectTextLanguage('異世界で嫁になりました 恋愛 小説')).toBe('japanese');
  });

  test('英語を判定する', () => {
    expect(detectTextLanguage('A quiet romance in another world')).toBe('english');
  });

  test('中国語を判定する', () => {
    expect(detectTextLanguage('異世界的新娘 浪漫小說')).toBe('chinese');
  });

  test('韓国語を判定する', () => {
    expect(detectTextLanguage('이세계에서 신부가 되었습니다')).toBe('korean');
  });
});
