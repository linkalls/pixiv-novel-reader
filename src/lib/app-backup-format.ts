export const BACKUP_FORMAT_VERSION = 1;

export interface AppBackupPayload {
  app: 'pixiv-novel-reader';
  exportedAt: number;
  formatVersion: number;
  settings: {
    appThemeMode: string | null;
    readerSettings: string | null;
  };
  tables: Record<string, unknown[]>;
}

export function parseAppBackupPayload(raw: string): AppBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('バックアップファイルは有効なJSONではありません');
  }

  if (!isRecord(parsed)) {
    throw new Error('バックアップ形式を確認できませんでした');
  }
  if (parsed.app !== 'pixiv-novel-reader') {
    throw new Error('Pixiv Novel Readerのバックアップではありません');
  }
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('このバックアップ形式には対応していません');
  }
  if (!isRecord(parsed.settings) || !isRecord(parsed.tables)) {
    throw new Error('バックアップデータが不足しています');
  }

  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(parsed.tables)) {
    if (!Array.isArray(rows)) {
      throw new Error(`バックアップ内の${name}が不正です`);
    }
    tables[name] = rows;
  }

  return {
    app: 'pixiv-novel-reader',
    exportedAt:
      typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
    formatVersion: BACKUP_FORMAT_VERSION,
    settings: {
      appThemeMode:
        typeof parsed.settings.appThemeMode === 'string'
          ? parsed.settings.appThemeMode
          : null,
      readerSettings:
        typeof parsed.settings.readerSettings === 'string'
          ? parsed.settings.readerSettings
          : null,
    },
    tables,
  };
}

export function serializeAppBackupPayload(payload: AppBackupPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
