import { describe, expect, test } from 'bun:test';

import { ReadingActivityClock } from './reading-activity';

describe('ReadingActivityClock', () => {
  test('前面かつ読書画面が表示中の時間だけを加算する', () => {
    const clock = new ReadingActivityClock({
      appActive: true,
      idleTimeoutMs: 60_000,
      now: 0,
      screenFocused: true,
    });

    expect(clock.getDuration(20_000)).toBe(20_000);

    clock.setAppActive(false, 30_000);
    expect(clock.getDuration(90_000)).toBe(30_000);

    clock.setAppActive(true, 90_000);
    clock.markInteraction(90_000);
    expect(clock.getDuration(110_000)).toBe(50_000);

    clock.setScreenFocused(false, 120_000);
    expect(clock.getDuration(180_000)).toBe(60_000);
  });

  test('無操作時間はタイムアウトまでしか加算しない', () => {
    const clock = new ReadingActivityClock({
      idleTimeoutMs: 60_000,
      now: 0,
    });

    expect(clock.getDuration(120_000)).toBe(60_000);

    clock.markInteraction(120_000);
    expect(clock.getDuration(150_000)).toBe(90_000);
  });

  test('時計が巻き戻っても読書時間を減らさない', () => {
    const clock = new ReadingActivityClock({ now: 10_000 });

    expect(clock.getDuration(20_000)).toBe(10_000);
    expect(clock.getDuration(15_000)).toBe(10_000);
  });
});
