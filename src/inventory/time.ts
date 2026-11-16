// D-9: timestamps are fixed-width `YYYY-MM-DDTHH:MM:SS` strings on ONE named calendar axis (event.timezone_label),
// compared lexically. Turnstile adds what Quorum/Bookable never needed: arithmetic (hold TTLs, payment timeouts,
// days before the show). It is done as integer seconds on that same axis — a proleptic-Gregorian day count plus
// seconds in the day — with no JS Date, no zone and no DST anywhere (the oracle does the same with a naive
// datetime). Brand after Quorum src/tally/time.ts (task 1.3); day arithmetic after Howard Hinnant's days_from_civil.
import { InputInvalid } from './errors';

export type Timestamp = string & { readonly __timestamp: unique symbol };

export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export const isTimestamp = (s: unknown): s is Timestamp => typeof s === 'string' && TIMESTAMP_RE.test(s) && fromSeconds(toSeconds(s as Timestamp)) === s;

/** Validating constructor; `field` names the row and column in the INPUT_INVALID it throws. */
export function timestamp(s: unknown, field: string): Timestamp {
  if (typeof s !== 'string' || !TIMESTAMP_RE.test(s)) throw new InputInvalid(field, `expected YYYY-MM-DDTHH:MM:SS, got ${JSON.stringify(s)}`);
  const t = s as Timestamp;
  if (fromSeconds(toSeconds(t)) !== t) throw new InputInvalid(field, `not a calendar instant: ${s}`);
  return t;
}

const fdiv = (a: number, b: number): number => (a - (((a % b) + b) % b)) / b; // floor division on integers

/** Days since 1970-01-01 on the proleptic Gregorian calendar (integer arithmetic only). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = fdiv(yy, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = fdiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + fdiv(yoe, 4) - fdiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = fdiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100));
  const mp = fdiv(5 * doy + 2, 153);
  const d = doy - fdiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

/** Seconds on the axis since 1970-01-01T00:00:00 of that axis. Not an epoch: there is no zone here. */
export function toSeconds(t: Timestamp): number {
  const y = Number(t.slice(0, 4)), mo = Number(t.slice(5, 7)), d = Number(t.slice(8, 10));
  const h = Number(t.slice(11, 13)), mi = Number(t.slice(14, 16)), s = Number(t.slice(17, 19));
  return daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export function fromSeconds(total: number): Timestamp {
  const days = fdiv(total, 86400);
  const rem = total - days * 86400;
  const [y, m, d] = civilFromDays(days);
  const h = fdiv(rem, 3600), mi = fdiv(rem - h * 3600, 60), s = rem - h * 3600 - mi * 60;
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}` as Timestamp;
}

export const addMinutes = (t: Timestamp, minutes: number): Timestamp => fromSeconds(toSeconds(t) + minutes * 60);
export const addSeconds = (t: Timestamp, seconds: number): Timestamp => fromSeconds(toSeconds(t) + seconds);

/** Whole days from `earlier` to `later` on the axis, floored (R-3, GT-06). Negative when `later` is first. */
export const daysBefore = (later: Timestamp, earlier: Timestamp): number => fdiv(toSeconds(later) - toSeconds(earlier), 86400);

/** Lexical order is chronological order for fixed-width strings on one axis. */
export const before = (a: Timestamp, b: Timestamp): boolean => a < b;
export const notAfter = (a: Timestamp, b: Timestamp): boolean => a <= b;
