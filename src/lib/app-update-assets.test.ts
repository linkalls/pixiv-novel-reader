import { describe, expect, test } from 'bun:test';

import { selectAndroidApkAsset } from './app-update-assets';

describe('selectAndroidApkAsset', () => {
  test('同じバージョンのarm64 APKを優先する', () => {
    const asset = selectAndroidApkAsset(
      [
        {
          name: 'pixiv-novel-reader-v2.5.2-arm64.apk.sha256',
          browser_download_url: 'https://example.com/checksum',
          size: 100,
        },
        {
          name: 'pixiv-novel-reader-v2.5.1-arm64.apk',
          browser_download_url: 'https://example.com/old.apk',
          content_type: 'application/vnd.android.package-archive',
          size: 200,
        },
        {
          name: 'pixiv-novel-reader-v2.5.2-arm64.apk',
          browser_download_url: 'https://example.com/latest.apk',
          content_type: 'application/vnd.android.package-archive',
          size: 300,
        },
      ],
      '2.5.2',
    );

    expect(asset).toEqual({
      contentType: 'application/vnd.android.package-archive',
      downloadUrl: 'https://example.com/latest.apk',
      name: 'pixiv-novel-reader-v2.5.2-arm64.apk',
      size: 300,
    });
  });

  test('APKがなければnullを返す', () => {
    expect(
      selectAndroidApkAsset(
        [
          {
            name: 'source.zip',
            browser_download_url: 'https://example.com/source.zip',
          },
        ],
        '2.5.2',
      ),
    ).toBeNull();
  });
});
