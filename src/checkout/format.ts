// Display formatting for the design pass (D-37). Pure string and integer work on the one axis (non-negotiable 8):
// a `YYYY-MM-DDTHH:MM:SS` string is sliced, never parsed by `Date`; no zone conversion, no float. Screens call these
// so that components hold no arithmetic (the inventory:lint screen grep).
import type { Rules } from '@/inventory/event';
import type { PillKind } from '@/components/pill';
import { compareStrings } from '@/inventory/canonical';
import { toSeconds, type Timestamp } from '@/inventory/time';
import { percent, type EventView } from './read';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (t: string) => ({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)), d: Number(t.slice(8, 10)), h: Number(t.slice(11, 13)), mi: t.slice(14, 16) });

/** Day of the week for a civil date, by integer arithmetic (days from 1970-01-01, Hinnant's algorithm). */
export function weekday(y: number, m: number, d: number): string {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  return DAYS[(((days + 4) % 7) + 7) % 7]!;
}

/** "Mar 20, 2027" */
export function date(t: string): string {
  const p = parts(t);
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** "Sat, Mar 20, 2027" */
export function day(t: string): string {
  const p = parts(t);
  return `${weekday(p.y, p.m, p.d)}, ${date(t)}`;
}

/** "7:00 PM" (seconds dropped; the full stamp is still shown where a rule turns on it). */
export function time(t: string): string {
  const { h, mi } = parts(t);
  return `${h % 12 === 0 ? 12 : h % 12}:${mi} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Mar 20, 2027 · 7:00 PM" */
export const stamp = (t: string) => `${date(t)} · ${time(t)}`;

/** The raw axis string with a space: what a rule compares, for the places that must show the second. */
export const axis = (t: string) => t.replace('T', ' ');

/** 4618132 → "4,618,132" */
export const count = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');

/** Whole minutes as words: 10 → "10 min", 1440 → "24 h", 90 → "1 h 30 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The difference of two whole minutes counts, for copy like "31 minutes after checkout started". */
export const minutesBetween = (fromSeconds: number, toSeconds: number) => Math.floor((toSeconds - fromSeconds) / 60);

/** What a refund window gives, in words. */
export function refundWords(bps: number, feeRefunded: boolean): string {
  if (bps === 0) return 'no refund';
  const share = bps === 10000 ? 'full refund' : bps === 5000 ? 'half the ticket price' : `${percent(bps)} of the ticket price`;
  return `${share}, fee ${feeRefunded ? 'included' : 'kept'}`;
}

/**
 * The refund policy as one line per window, from the rows as data (sorted descending, ending at 0 days, GT-13):
 * "30+ days before: full refund, fee included", "7–29 days: half the ticket price, fee kept", "Under 7 days: no refund".
 */
export function refundWindows(policy: Rules['refund_policy']): string[] {
  return policy.map((row, i) => {
    const above = i === 0 ? null : policy[i - 1]!.min_days_before - 1;
    const span = above === null ? (row.min_days_before === 0 ? 'Any time before the start' : `${row.min_days_before}+ days before`)
      : row.min_days_before === 0 ? `Under ${above + 1} days` : `${row.min_days_before}–${above} days`;
    const words = refundWords(row.refund_bps, row.fee_refunded);
    return `${span}: ${words}`;
  });
}

/** Where the event's sales stand on its clock, as a pill: cancelled, not open yet, on sale, or closed. */
export function saleState(v: EventView): [PillKind, string] {
  if (v.event.cancelledAt) return ['risk', `Cancelled ${axis(v.event.cancelledAt)}`];
  if (compareStrings(v.asOf, v.event.salesOpenAt) < 0) return ['info', `Sales open ${stamp(v.event.salesOpenAt)}`];
  if (compareStrings(v.asOf, v.event.salesCloseAt) < 0) return ['info', 'On sale'];
  return ['done', 'Sales closed'];
}

type TierLike = Pick<EventView['tiers'][number], 'onSale' | 'onSaleAt' | 'offSaleAt' | 'soldOut' | 'remaining' | 'allotment' | 'available'>;

/** A tier's state as a pill and its count line, with the pool checked before the tier (non-negotiable 2). */
export function tierState(t: TierLike, asOf: string): { k: PillKind; word: string; line: string } {
  if (!t.onSale) {
    return compareStrings(asOf, t.onSaleAt) < 0
      ? { k: 'info', word: `On sale from ${stamp(t.onSaleAt)}`, line: `${count(t.allotment)} allotment` }
      : { k: 'done', word: `Off sale since ${date(t.offSaleAt)}`, line: `${count(t.remaining)} of ${count(t.allotment)} unsold` };
  }
  if (t.soldOut === 'SOLD_OUT_POOL') return { k: 'risk', word: 'Pool sold out', line: `${count(t.remaining)} remaining · ${count(t.available)} available` };
  if (t.soldOut === 'SOLD_OUT_TIER') return { k: 'risk', word: 'Tier sold out', line: `${count(t.remaining)} of ${count(t.allotment)} left` };
  return { k: 'good', word: 'Available', line: `${count(t.available)} available` };
}

/** Whole minutes from one axis timestamp to a later one ("31 minutes after checkout started"). */
export const minutesFrom = (from: Timestamp, to: Timestamp) => minutesBetween(toSeconds(from), toSeconds(to));

/** One page of a long list, for the ledger (design pass): 1-based `page`, clamped; `size` rows a page. */
export function pageOf<T>(items: T[], page: number, size: number): { rows: T[]; page: number; pages: number; from: number; to: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), pages);
  const start = (p - 1) * size;
  const rows = items.slice(start, start + size);
  return { rows, page: p, pages, from: rows.length ? start + 1 : 0, to: start + rows.length, total: items.length };
}

/** Days before the show, in words; a negative count means the show has started (R-3 keeps the integer). */
export const daysWords = (days: number) => (days < 0 ? 'after the show started' : days === 1 ? '1 day before the show' : `${days} days before the show`);
