import { describe, expect, test } from 'bun:test';

import {
  buildDetailRouteParams,
  buildReaderRouteParams,
} from './reader-flow';

describe('buildReaderRouteParams', () => {
  test('詳細から続きへ進む状態を保持する', () => {
    expect(
      buildReaderRouteParams(123, {
        bookmarked: true,
        resume: true,
      }),
    ).toEqual({
      bookmarked: '1',
      id: '123',
      resume: '1',
    });
  });

  test('未知のブックマーク状態はfalseに決めつけない', () => {
    expect(buildReaderRouteParams(45, { bookmarked: null })).toEqual({
      id: '45',
    });
  });
});

describe('reader detail flow', () => {
  test('読書メニューから積む詳細Routeの状態を保持する', () => {
    expect(buildDetailRouteParams(88, false)).toEqual({
      bookmarked: '0',
      id: '88',
    });
  });
});
