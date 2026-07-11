export type BookmarkStateSource = 'offline' | 'remote' | 'route' | 'user';

export interface BookmarkState {
  value: boolean | null;
  source: BookmarkStateSource | null;
}

const SOURCE_PRIORITY: Record<BookmarkStateSource, number> = {
  offline: 0,
  remote: 1,
  route: 2,
  user: 3,
};

/**
 * 複数経路から届くブックマーク状態を、鮮度の優先順位付きで統合する。
 *
 * 作品一覧・詳細から直接渡されたroute状態は、古いオフライン保存や
 * 詳細APIの遅延レスポンスより優先する。ユーザー操作は常に最優先。
 */
export function resolveBookmarkState(
  current: BookmarkState,
  incoming: {
    value: boolean;
    source: BookmarkStateSource;
  },
): BookmarkState {
  // 一覧側が未登録でも、詳細APIが登録済みと返した場合はtrueへ更新する。
  // 逆方向はAPIキャッシュや保存済みデータの遅延で起きやすいため許可しない。
  if (
    current.source === 'route' &&
    current.value === false &&
    incoming.source === 'remote' &&
    incoming.value === true
  ) {
    return incoming;
  }

  if (
    current.source !== null &&
    SOURCE_PRIORITY[incoming.source] < SOURCE_PRIORITY[current.source]
  ) {
    return current;
  }

  return incoming;
}

export function parseBookmarkRouteParam(
  value: string | string[] | undefined,
): boolean | null {
  const normalizedValue = Array.isArray(value) ? value[0] : value;

  if (normalizedValue === '1' || normalizedValue === 'true') {
    return true;
  }

  if (normalizedValue === '0' || normalizedValue === 'false') {
    return false;
  }

  return null;
}
