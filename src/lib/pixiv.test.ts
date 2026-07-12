import { describe, expect, test } from 'bun:test';

import {
  parseNovelAjaxResponse,
  parseNovelSearchNextUrl,
  parseNovelWebviewHtml,
} from './pixiv';

describe('parseNovelSearchNextUrl', () => {
  test('検索ページの全カーソル条件を保持する', () => {
    const cursor = parseNovelSearchNextUrl(
      'https://app-api.pixiv.net/v1/search/novel?word=%E6%81%8B%E6%84%9B&search_target=exact_match_for_tags&sort=date_asc&duration=within_last_week&start_date=2026-07-01&end_date=2026-07-07&search_ai_type=0&offset=30',
    );

    expect(cursor).toEqual({
      word: '恋愛',
      searchTarget: 'exact_match_for_tags',
      sort: 'date_asc',
      duration: 'within_last_week',
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      searchAiType: 0,
      offset: 30,
    });
  });

  test('不正なカーソル値は引き継がない', () => {
    const cursor = parseNovelSearchNextUrl(
      '/v1/search/novel?word=%20&search_target=broken&sort=broken&duration=broken&search_ai_type=2&offset=not-a-number',
    );

    expect(cursor).toEqual({});
  });
});

describe('parseNovelAjaxResponse', () => {
  test('Ajax内部APIの本文と埋め込み画像を読み取る', () => {
    const content = parseNovelAjaxResponse(
      JSON.stringify({
        error: false,
        message: '',
        body: {
          id: '12345',
          title: 'テスト小説',
          content: '一行目\n二行目',
          seriesNavData: {
            title: 'テストシリーズ',
          },
          textEmbeddedImages: {
            image1: {
              urls: {
                original: 'https://i.pximg.net/example.jpg',
              },
            },
          },
        },
      }),
    );

    expect(content).toEqual({
      id: '12345',
      title: 'テスト小説',
      seriesTitle: 'テストシリーズ',
      text: '一行目\n二行目',
      embeddedImages: {
        image1: 'https://i.pximg.net/example.jpg',
      },
    });
  });

  test('Webログインcookieが使えないレスポンスをエラーにする', () => {
    expect(() =>
      parseNovelAjaxResponse(
        JSON.stringify({
          error: true,
          message: '',
          body: [],
        }),
      ),
    ).toThrow('PixivのWebログインcookieを利用できませんでした');
  });
});

describe('parseNovelWebviewHtml', () => {
  test('本文中の波括弧と引用符があっても埋め込みJSONを切り出せる', () => {
    const payload = {
      id: '9876',
      title: 'フォールバック小説',
      seriesTitle: null,
      text: '本文に { 波括弧 } と "引用符" がある。',
      images: [],
      illusts: [],
    };
    const html = `<html><script>window.__DATA__ = { novel: ${JSON.stringify(payload)}, isOwnWork: false };</script></html>`;
    const content = parseNovelWebviewHtml(html);

    expect(content.id).toBe('9876');
    expect(content.title).toBe('フォールバック小説');
    expect(content.text).toBe(payload.text);
  });
});
