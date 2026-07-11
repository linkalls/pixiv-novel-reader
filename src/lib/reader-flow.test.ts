import { describe, expect, test } from 'bun:test';

import {
  buildDetailRouteParams,
  buildReaderRouteParams,
  resolveReaderDetailAction,
} from './reader-flow';

describe('buildReaderRouteParams', () => {
  test('詳細から続きへ進む状態を保持する', () => {
    expect(
      buildReaderRouteParams(123, {
        bookmarked: true,
        fromDetail: true,
        resume: true,
      }),
    ).toEqual({
      bookmarked: '1',
      fromDetail: '1',
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
  test('詳細から読書へ来た場合は既存詳細へ戻る', () => {
    expect(resolveReaderDetailAction(true)).toBe('back');
  });

  test('履歴から直接読書へ来た場合は詳細を新しく開く', () => {
    expect(resolveReaderDetailAction(false)).toBe('push');
    expect(buildDetailRouteParams(88, false)).toEqual({
      bookmarked: '0',
      id: '88',
    });
  });
});
