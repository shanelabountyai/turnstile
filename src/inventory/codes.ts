// D-10: closed vocabularies. 10 command kinds, 13 OK codes, 41 reject codes — the same lists, in the same order, as
// tools/inventorylib.py. The order of REJECT_CODES is documentation of the precedence in docs/domain-brief.md §4–§8;
// the precedence itself is enforced by the order of checks in engine.ts.

export const KINDS = [
  'HOLD', 'RELEASE', 'PAY_START', 'PAY_SUCCEEDED', 'PAY_FAILED',
  'WAITLIST_JOIN', 'WAITLIST_LEAVE', 'REFUND_REQUEST', 'CANCEL_EVENT', 'CHECK_IN',
] as const;
export type Kind = (typeof KINDS)[number];

export const OK_CODES = [
  'HELD', 'RELEASED', 'PAYING', 'CONFIRMED', 'PAYMENT_FAILED_RELEASED',
  'PAID_AFTER_TIMEOUT', 'PAID_AFTER_CANCEL', 'PAYMENT_DUPLICATE',
  'WAITLISTED', 'WAITLIST_LEFT', 'REFUNDED', 'EVENT_CANCELLED_OK', 'CHECKED_IN',
] as const;
export type OkCode = (typeof OK_CODES)[number];

export const REJECT_CODES = [
  'KIND_UNKNOWN',
  'EVENT_CANCELLED',
  'SALES_NOT_OPEN', 'SALES_CLOSED',
  'TIER_UNKNOWN', 'TIER_NOT_ON_SALE',
  'HOLD_ID_DUPLICATE',
  'QTY_INVALID', 'QTY_OVER_LIMIT',
  'SEAT_UNKNOWN', 'SEAT_DUPLICATE', 'SEAT_TIER_MISMATCH', 'SEATS_REQUIRED', 'SEATS_NOT_ALLOWED',
  'SOLD_OUT_POOL', 'SOLD_OUT_TIER', 'SEAT_TAKEN', 'ORPHAN_SEAT',
  'HOLD_UNKNOWN', 'HOLD_NOT_YOURS', 'HOLD_EXPIRED', 'HOLD_RELEASED', 'HOLD_NOT_HELD',
  'PAYMENT_ID_DUPLICATE', 'PAYMENT_UNKNOWN',
  'WAITLIST_TARGET_UNKNOWN', 'WAITLIST_NOT_NEEDED', 'WAITLIST_DUPLICATE', 'WAITLIST_UNKNOWN', 'WAITLIST_NOT_YOURS',
  'ORDER_UNKNOWN', 'ORDER_NOT_YOURS', 'TICKET_NOT_IN_ORDER', 'TICKET_ALREADY_REFUNDED', 'TICKET_CHECKED_IN', 'REFUND_WINDOW_CLOSED',
  'TICKET_UNKNOWN', 'TICKET_REFUNDED', 'DOORS_NOT_OPEN', 'ALREADY_CHECKED_IN',
  'ALREADY_CANCELLED',
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export const HOLD_STATES = ['HELD', 'PAYING', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'PAY_FAILED', 'PAY_TIMEOUT', 'CANCELLED'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** A rejected command: one code, an optional detail string, never an exception that escapes `apply`. */
export class Reject extends Error {
  constructor(readonly rejectCode: RejectCode, readonly detail = '') {
    super(rejectCode);
    this.name = 'Reject';
  }
}
