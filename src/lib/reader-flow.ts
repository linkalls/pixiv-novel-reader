export interface ReaderRouteOptions {
  bookmarked?: boolean | null;
  fromDetail?: boolean;
  resume?: boolean;
}

/** 読書Routeへ渡すパラメータを一か所で組み立てる。 */
export function buildReaderRouteParams(
  novelId: number,
  options: ReaderRouteOptions = {},
): Record<string, string> {
  const params: Record<string, string> = {
    id: String(novelId),
  };

  if (options.bookmarked !== null && options.bookmarked !== undefined) {
    params.bookmarked = options.bookmarked ? '1' : '0';
  }

  if (options.fromDetail) {
    params.fromDetail = '1';
  }

  if (options.resume) {
    params.resume = '1';
  }

  return params;
}

export function buildDetailRouteParams(
  novelId: number,
  bookmarked?: boolean | null,
): Record<string, string> {
  const params: Record<string, string> = {
    id: String(novelId),
  };

  if (bookmarked !== null && bookmarked !== undefined) {
    params.bookmarked = bookmarked ? '1' : '0';
  }

  return params;
}

/**
 * 詳細から読書を開いた場合は既存詳細へ戻し、履歴などから直接開いた場合は
 * 詳細Routeを新しく積む。
 */
export function resolveReaderDetailAction(
  openedFromDetail: boolean,
): 'back' | 'push' {
  return openedFromDetail ? 'back' : 'push';
}
