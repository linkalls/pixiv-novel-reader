import type { PixivNovelItem } from '@book000/pixivts';

export type NovelLanguage = 'japanese' | 'english' | 'chinese' | 'korean' | 'other';

export function detectNovelLanguage(novel: PixivNovelItem): NovelLanguage {
  const text = [
    novel.title,
    stripHtml(novel.caption),
    ...novel.tags.map((tag) => tag.name),
  ].join(' ');
  return detectTextLanguage(text);
}

export function detectTextLanguage(text: string): NovelLanguage {
  const compact = text.normalize('NFKC').replace(/[\s\p{P}\p{S}\d_]+/gu, '');
  if (!compact) return 'other';

  const hangul = countMatches(compact, /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/gu);
  const kana = countMatches(compact, /[\u3040-\u30ff\u31f0-\u31ff]/gu);
  const han = countMatches(compact, /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu);
  const latin = countMatches(compact, /[A-Za-z]/g);
  const total = Math.max(1, hangul + kana + han + latin);

  if (hangul / total >= 0.18 || hangul >= 4) return 'korean';
  if (kana / total >= 0.08 || kana >= 2) return 'japanese';
  if (han / total >= 0.35 && kana === 0) return 'chinese';
  if (latin / total >= 0.55) return 'english';
  if (han > 0 && kana > 0) return 'japanese';
  return 'other';
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}
