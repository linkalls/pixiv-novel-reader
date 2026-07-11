import { describe, expect, test } from 'bun:test';

import {
  BACKUP_FORMAT_VERSION,
  parseAppBackupPayload,
  serializeAppBackupPayload,
  type AppBackupPayload,
} from './app-backup-format';

const payload: AppBackupPayload = {
  app: 'pixiv-novel-reader',
  exportedAt: 1,
  formatVersion: BACKUP_FORMAT_VERSION,
  settings: { appThemeMode: 'dark', readerSettings: '{}' },
  tables: { reading_history: [{ novel_id: 1 }] },
};

describe('app backup format', () => {
  test('シリアライズしたバックアップを復元できる', () => {
    expect(parseAppBackupPayload(serializeAppBackupPayload(payload))).toEqual(payload);
  });

  test('別アプリのJSONを拒否する', () => {
    expect(() =>
      parseAppBackupPayload(
        JSON.stringify({ ...payload, app: 'different-application' }),
      ),
    ).toThrow('Pixiv Novel Reader');
  });

  test('テーブルが配列でない場合を拒否する', () => {
    expect(() =>
      parseAppBackupPayload(
        JSON.stringify({ ...payload, tables: { reading_history: {} } }),
      ),
    ).toThrow('reading_history');
  });
});
