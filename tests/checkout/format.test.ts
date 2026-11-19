// Design pass (D-37): display formatting on the one axis. No Date, no zone, no float.
import { describe, expect, it } from 'vitest';
import { count, date, day, duration, refundWindows, refundWords, stamp, time, weekday } from '@/checkout/format';

describe('format', () => {
  it('weekdays by integer arithmetic', () => {
    expect(weekday(2027, 3, 20)).toBe('Sat');
    expect(weekday(2026, 12, 1)).toBe('Tue');
    expect(weekday(1970, 1, 1)).toBe('Thu');
    expect(weekday(2000, 2, 29)).toBe('Tue');
    expect(weekday(1969, 12, 31)).toBe('Wed');
  });
  it('dates and times are sliced from the axis string', () => {
    expect(day('2027-03-20T19:00:00')).toBe('Sat, Mar 20, 2027');
    expect(date('2026-12-01T10:00:00')).toBe('Dec 1, 2026');
    expect([time('2027-03-20T19:00:00'), time('2027-03-20T00:05:00'), time('2027-03-20T12:30:59'), time('2027-03-20T09:00:00')]).toEqual(['7:00 PM', '12:05 AM', '12:30 PM', '9:00 AM']);
    expect(stamp('2026-12-10T10:32:00')).toBe('Dec 10, 2026 · 10:32 AM');
  });
  it('counts and durations', () => {
    expect([count(4618132), count(800), count(0), count(1051)]).toEqual(['4,618,132', '800', '0', '1,051']);
    expect([duration(10), duration(30), duration(1440), duration(90)]).toEqual(['10 min', '30 min', '24 h', '1 h 30 min']);
  });
  it('refund windows read from the policy rows', () => {
    const policy = [
      { min_days_before: 30, refund_bps: 10000, fee_refunded: true },
      { min_days_before: 7, refund_bps: 5000, fee_refunded: false },
      { min_days_before: 0, refund_bps: 0, fee_refunded: false },
    ];
    expect(refundWindows(policy)).toEqual(['30+ days before: full refund, fee included', '7–29 days: half the ticket price, fee kept', 'Under 7 days: no refund']);
    expect(refundWindows([{ min_days_before: 0, refund_bps: 10000, fee_refunded: true }])).toEqual(['Any time before the start: full refund, fee included']);
    expect(refundWords(2500, false)).toBe('25% of the ticket price, fee kept');
  });
});

describe('format: paging and day words (design pass, review fixes)', () => {
  it('pages clamp and count from 1', async () => {
    const { pageOf, daysWords } = await import('@/checkout/format');
    const xs = Array.from({ length: 452 }, (_, i) => i);
    expect(pageOf(xs, 1, 50)).toMatchObject({ page: 1, pages: 10, from: 1, to: 50, total: 452 });
    expect(pageOf(xs, 10, 50)).toMatchObject({ page: 10, from: 451, to: 452 });
    expect(pageOf(xs, 99, 50).page).toBe(10);
    expect(pageOf(xs, Number.NaN, 50).page).toBe(1);
    expect(pageOf([], 1, 50)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
    expect([daysWords(-1), daysWords(0), daysWords(1), daysWords(24)]).toEqual(['after the show started', '0 days before the show', '1 day before the show', '24 days before the show']);
  });
});
