import {
  PixivClient,
  type PixivError,
  type PixivNovelItem,
} from '@book000/pixivts';

export interface PixivConnectionResult {
  userId: number;
  refreshToken: string;
  novels: PixivNovelItem[];
}

/**
 * refresh tokenでPixivへ接続し、小説デイリーランキングの先頭ページを取得する。
 *
 * 最初の疎通確認用なので、ここではクライアントを永続化せず、
 * 認証とランキング取得がExpo上で完走するかだけを確かめる。
 */
export async function connectAndFetchNovelRanking(
  refreshToken: string,
): Promise<PixivConnectionResult> {
  const normalizedToken = refreshToken.trim();

  if (normalizedToken.length === 0) {
    throw new Error('refresh tokenを入力してね');
  }

  const client = await PixivClient.of(normalizedToken, {
    retry: {
      maxRetries: 1,
      waitMs: 2_000,
    },
  });

  const rankingResult = await client.novels.ranking({
    mode: 'day',
  });

  if (rankingResult.isErr) {
    throw new Error(formatPixivError(rankingResult.error));
  }

  return {
    userId: client.userId,
    // Pixiv側でrefresh tokenがローテーションした場合に備えて最新値を返す。
    refreshToken: client.getRefreshToken(),
    novels: rankingResult.value.novels,
  };
}

function formatPixivError(error: PixivError): string {
  switch (error.type) {
    case 'rate_limit':
      return `Pixiv APIのレート制限に当たったよ。${Math.ceil(error.retryAfter / 1_000)}秒ほど空けて再試行してね`;
    case 'auth_failed':
      return `Pixiv認証に失敗したよ（HTTP ${error.status}）。refresh tokenを確認してね`;
    case 'api_error':
      return `Pixiv APIがエラーを返したよ（HTTP ${error.status}）`;
    case 'network':
      return 'Pixivへの通信に失敗したよ。ネットワーク接続を確認してね';
  }
}
