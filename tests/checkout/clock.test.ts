import { describe, expect, it } from 'vitest';
import { eventNow, stampAfter } from '@/checkout/clock';
import type { Timestamp } from '@/inventory/time';

// D-35: the event clock and the stamp that keeps the CommandLog in (at, cmd_id) order. Pure; no database.
const T = (s: string) => s as Timestamp;

describe('eventNow', () => {
  it('is the wall clock on the event axis plus the offset, carried across midnight', () => {
    const wall = new Date('2026-11-10T18:00:00Z'); // 12:00:00 in America/Chicago (CST)
    expect(eventNow(wall, { timezoneLabel: 'America/Chicago', clockOffsetSeconds: 0 })).toBe('2026-11-10T12:00:00');
    expect(eventNow(wall, { timezoneLabel: 'America/Chicago', clockOffsetSeconds: 12 * 3600 + 5 })).toBe('2026-11-11T00:00:05');
  });
});

describe('stampAfter', () => {
  const last = { at: T('2026-12-01T10:05:00'), cmdId: 'U-b' };
  it('takes the clock when it is past the log', () => expect(stampAfter(T('2026-12-01T10:05:01'), 'U-a', last)).toBe('2026-12-01T10:05:01'));
  it('takes the clock on an empty log', () => expect(stampAfter(T('2026-11-10T12:00:00'), 'U-a', null)).toBe('2026-11-10T12:00:00'));
  it('shares the last second only when cmd_id sorts after it', () => {
    expect(stampAfter(T('2026-12-01T10:05:00'), 'U-c', last)).toBe('2026-12-01T10:05:00');
    expect(stampAfter(T('2026-12-01T10:05:00'), 'U-a', last)).toBe('2026-12-01T10:05:01');
  });
  it('never stamps before the log, however far behind the clock is', () => {
    expect(stampAfter(T('2026-11-10T12:00:00'), 'U-a', last)).toBe('2026-12-01T10:05:01');
    expect(stampAfter(T('2026-11-10T12:00:00'), 'evt_1', last)).toBe('2026-12-01T10:05:00'); // 'evt_' sorts after 'U-'
  });
});
