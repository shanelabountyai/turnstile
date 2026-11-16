// D-16, non-negotiable 8: money is integer cents, proportions are basis points, and `price × bps / 10000` floors
// with the remainder staying with the venue. LoanBook's money module (the donor named in docs/portfolio-overlap.md)
// was not readable from the cloud session, so this is written fresh (decisions D-27) to that one rule. The division is
// done in BigInt so no float ever touches a cent; the lint bans `/ 10000` on numbers and decimal literals under src/.
import { InputInvalid } from './errors';

export type Cents = number; // a safe non-negative integer
export type Bps = number; // 0..10000

export function cents(n: unknown, field: string): Cents {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new InputInvalid(field, `expected non-negative integer cents, got ${String(n)}`);
  return n;
}

export function bps(n: unknown, field: string): Bps {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 10000) throw new InputInvalid(field, `expected basis points 0..10000, got ${String(n)}`);
  return n;
}

/** floor(amount × bps / 10000); the remainder is the venue's (GT-07: 3499 × 5000 → 1749). */
export function applyBps(amount: Cents, b: Bps): Cents {
  return Number((BigInt(amount) * BigInt(b)) / 10000n);
}
