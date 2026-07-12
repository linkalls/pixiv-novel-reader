export const READING_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface ReadingActivityClockOptions {
  appActive?: boolean;
  idleTimeoutMs?: number;
  now?: number;
  screenFocused?: boolean;
}

/**
 * 読書画面が前面にあり、直近に操作があった時間だけを積算する。
 * バックグラウンド滞在や別画面を開いている時間は加算しない。
 */
export class ReadingActivityClock {
  private activeDurationMs = 0;
  private appActive: boolean;
  private readonly idleTimeoutMs: number;
  private lastInteractionAt: number;
  private lastObservedAt: number;
  private screenFocused: boolean;

  constructor(options: ReadingActivityClockOptions = {}) {
    const now = normalizeTimestamp(options.now ?? Date.now());
    this.appActive = options.appActive ?? true;
    this.idleTimeoutMs = Math.max(
      1_000,
      Math.floor(options.idleTimeoutMs ?? READING_IDLE_TIMEOUT_MS),
    );
    this.lastInteractionAt = now;
    this.lastObservedAt = now;
    this.screenFocused = options.screenFocused ?? true;
  }

  getDuration(now = Date.now()): number {
    this.accumulate(now);
    return Math.max(0, Math.round(this.activeDurationMs));
  }

  markInteraction(now = Date.now()): void {
    this.accumulate(now);
    this.lastInteractionAt = this.lastObservedAt;
  }

  setAppActive(active: boolean, now = Date.now()): void {
    this.accumulate(now);
    this.appActive = active;
  }

  setScreenFocused(focused: boolean, now = Date.now()): void {
    this.accumulate(now);
    this.screenFocused = focused;
  }

  private accumulate(now: number): void {
    const nextObservedAt = Math.max(
      this.lastObservedAt,
      normalizeTimestamp(now),
    );

    if (this.appActive && this.screenFocused) {
      const activeUntil = Math.min(
        nextObservedAt,
        this.lastInteractionAt + this.idleTimeoutMs,
      );
      if (activeUntil > this.lastObservedAt) {
        this.activeDurationMs += activeUntil - this.lastObservedAt;
      }
    }

    this.lastObservedAt = nextObservedAt;
  }
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
