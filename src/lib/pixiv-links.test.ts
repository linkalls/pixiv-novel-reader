import { describe, expect, test } from 'bun:test';

import { buildPixivUserUrl } from './pixiv-links';

describe('buildPixivUserUrl', () => {
  test('ユーザーIDからPixivプロフィールURLを作る', () => {
    expect(buildPixivUserUrl(123456)).toBe(
      'https://www.pixiv.net/users/123456',
    );
  });

  test('不正なユーザーIDを拒否する', () => {
    expect(() => buildPixivUserUrl(0)).toThrow();
    expect(() => buildPixivUserUrl(-1)).toThrow();
    expect(() => buildPixivUserUrl(1.5)).toThrow();
  });
});
