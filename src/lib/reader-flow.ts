export interface ReaderRouteOptions {
  bookmarked?: boolean | null;
  resume?: boolean;
  scrollOffset?: number;
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

  if (options.resume) {
    params.resume = '1';
  }

  if (
    options.scrollOffset !== undefined &&
    Number.isFinite(options.scrollOffset) &&
    options.scrollOffset >= 0
  ) {
    params.scrollOffset = String(options.scrollOffset);
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
