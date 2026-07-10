import * as Crypto from 'expo-crypto';

const PIXIV_LOGIN_URL = 'https://app-api.pixiv.net/web/v1/login';
const PIXIV_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
const PIXIV_CALLBACK_URL =
  'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';

// Pixiv公式アプリで使われているOAuthクライアント情報。
// @book000/pixivtsにも同じ値が含まれている。
const PIXIV_CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
const PIXIV_CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';

export const PIXIV_WEBVIEW_USER_AGENT =
  'PixivIOSApp/7.16.9 (iOS 16.4.1; iPad13,4)';

export interface PixivOAuthSession {
  loginUrl: string;
  codeVerifier: string;
}

export interface PixivOAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId?: string;
}

interface RawPixivTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
  };
  error?: string;
  error_description?: string;
  errors?: {
    system?: {
      message?: string;
    };
  };
}

/**
 * Pixivログイン用のPKCEセッションを生成する。
 */
export async function createPixivOAuthSession(): Promise<PixivOAuthSession> {
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const codeVerifier = bytesToBase64Url(randomBytes);
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    {
      encoding: Crypto.CryptoEncoding.BASE64,
    },
  );
  const codeChallenge = base64ToBase64Url(digest);

  const params = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    client: 'pixiv-android',
  });

  return {
    loginUrl: `${PIXIV_LOGIN_URL}?${params.toString()}`,
    codeVerifier,
  };
}

/**
 * authorization codeをPixiv API用のaccess token / refresh tokenへ交換する。
 */
export async function exchangePixivAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<PixivOAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: PIXIV_CLIENT_ID,
    client_secret: PIXIV_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    include_policy: 'true',
    redirect_uri: PIXIV_CALLBACK_URL,
  });

  const response = await fetch(PIXIV_TOKEN_URL, {
    method: 'POST',
    headers: {
      'app-os': 'ios',
      'app-os-version': '16.4.1',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': PIXIV_WEBVIEW_USER_AGENT,
    },
    body: body.toString(),
  });

  const payload = (await response.json()) as RawPixivTokenResponse;

  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    const detail =
      payload.error_description ??
      payload.errors?.system?.message ??
      payload.error ??
      `HTTP ${response.status}`;

    throw new Error(`Pixivのtoken交換に失敗したよ: ${detail}`);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in ?? 0,
    userId: payload.user?.id,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64Alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined =
      (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += base64Alphabet[(combined >> 18) & 0x3f];
    output += base64Alphabet[(combined >> 12) & 0x3f];
    output += second === undefined
      ? '='
      : base64Alphabet[(combined >> 6) & 0x3f];
    output += third === undefined ? '=' : base64Alphabet[combined & 0x3f];
  }

  return base64ToBase64Url(output);
}

function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
