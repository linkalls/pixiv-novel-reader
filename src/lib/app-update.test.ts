import { describe, expect, test } from 'bun:test';

import { compareVersions } from './version-utils';

describe('compareVersions', () => {
  test('新しいバージョンを判定する', () => {
    expect(compareVersions('2.5.0', '2.4.9')).toBe(1);
    expect(compareVersions('v3.0.0', '2.99.99')).toBe(1);
  });

  test('同じバージョンと古いバージョンを判定する', () => {
    expect(compareVersions('2.5', '2.5.0')).toBe(0);
    expect(compareVersions('2.4.9', '2.5.0')).toBe(-1);
  });
});
