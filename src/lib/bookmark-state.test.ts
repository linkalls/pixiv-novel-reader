import { describe, expect, test } from 'bun:test';

import {
  parseBookmarkRouteParam,
  resolveBookmarkState,
  type BookmarkState,
} from './bookmark-state';

describe('resolveBookmarkState', () => {
  test('一覧から渡したroute状態を古いoffline状態で上書きしない', () => {
    const current: BookmarkState = { value: true, source: 'route' };

    expect(
      resolveBookmarkState(current, { value: false, source: 'offline' }),
    ).toEqual(current);
  });

  test('route状態を遅れて届いたremote状態で上書きしない', () => {
    const current: BookmarkState = { value: true, source: 'route' };

    expect(
      resolveBookmarkState(current, { value: false, source: 'remote' }),
    ).toEqual(current);
  });

  test('routeが未登録でもremoteが登録済みならtrueへ更新する', () => {
    expect(
      resolveBookmarkState(
        { value: false, source: 'route' },
        { value: true, source: 'remote' },
      ),
    ).toEqual({ value: true, source: 'remote' });
  });

  test('ユーザー操作はすべての取得結果より優先する', () => {
    const userChanged = resolveBookmarkState(
      { value: true, source: 'route' },
      { value: false, source: 'user' },
    );

    expect(userChanged).toEqual({ value: false, source: 'user' });
    expect(
      resolveBookmarkState(userChanged, { value: true, source: 'remote' }),
    ).toEqual(userChanged);
  });
});

describe('parseBookmarkRouteParam', () => {
  test('ルート文字列をbooleanへ変換する', () => {
    expect(parseBookmarkRouteParam('1')).toBe(true);
    expect(parseBookmarkRouteParam('0')).toBe(false);
    expect(parseBookmarkRouteParam(undefined)).toBeNull();
  });
});
