/**
 * WebViewの遷移先からPixiv OAuthのauthorization codeを抜き出す。
 */
export function extractPixivAuthorizationCode(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const code = parsedUrl.searchParams.get('code');

    if (!code) {
      return null;
    }

    const isPixivScheme = parsedUrl.protocol === 'pixiv:';
    const isPixivRedirect =
      parsedUrl.hostname === 'accounts.pixiv.net' ||
      parsedUrl.hostname === 'app-api.pixiv.net';

    return isPixivScheme || isPixivRedirect ? code : null;
  } catch {
    const match = url.match(/[?&]code=([^&#]+)/);

    if (!match?.[1]) {
      return null;
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}
