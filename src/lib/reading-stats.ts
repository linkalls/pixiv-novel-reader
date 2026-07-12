export interface ReadingDayBucket {
  charactersRead: number;
  date: string;
  durationMs: number;
  sessions: number;
}

export function estimateCharactersRead(
  textLength: number,
  startProgress: number,
  endProgress: number,
): number {
  const safeLength = Math.max(0, Math.floor(Number.isFinite(textLength) ? textLength : 0));
  const start = clampProgress(startProgress);
  const end = clampProgress(endProgress);
  return Math.max(0, Math.round(safeLength * Math.max(0, end - start)));
}

export function formatReadingDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0分';
  }

  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 1) {
    return '1分未満';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}分`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

export function createRecentDateKeys(days: number, now = new Date()): string[] {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  const keys: string[] = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    keys.push(toLocalDateKey(date));
  }

  return keys;
}

export function fillReadingDayBuckets(
  rows: ReadingDayBucket[],
  days: number,
  now = new Date(),
): ReadingDayBucket[] {
  const map = new Map(rows.map((row) => [row.date, row]));
  return createRecentDateKeys(days, now).map(
    (date): ReadingDayBucket =>
      map.get(date) ?? {
        date,
        durationMs: 0,
        charactersRead: 0,
        sessions: 0,
      },
  );
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
