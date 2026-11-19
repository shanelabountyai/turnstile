// Design pass (D-37): an engine code in plain words, for the screens. The code itself is still shown next to the
// sentence (principle 1: a claim travels with its rule). Words only; nothing here decides anything.
import type { PillKind } from '@/components/pill';

const SAY: Record<string, string> = {
  HELD: 'Held for you. Pay before the timer runs out, or the tickets go back on sale.',
  RELEASED: 'Released. The tickets are back on sale.',
  PAYING: 'Payment started. The tickets are issued when the payment is confirmed.',
  WAITLISTED: 'You are on the waitlist.',
  WAITLIST_LEFT: 'You left the waitlist.',
  REFUNDED: 'Refunded.',
  SOLD_OUT_POOL: 'Pool sold out. This tier still has allotment, but the room it sells from is full.',
  SOLD_OUT_TIER: 'Tier sold out. This tier has used its allotment; another tier may still have room.',
  TIER_NOT_ON_SALE: 'This tier is not on sale at this time.',
  SALES_NOT_OPEN: 'Sales have not opened yet.',
  SALES_CLOSED: 'Sales have closed.',
  QTY_INVALID: 'Choose at least one ticket.',
  QTY_OVER_LIMIT: 'That is more tickets than one order allows.',
  SEATS_REQUIRED: 'Pick the seats you want first.',
  SEATS_NOT_ALLOWED: 'General admission has no seat numbers; choose a quantity instead.',
  SEAT_TAKEN: 'One of those seats was taken a moment ago. Pick again.',
  SEAT_UNKNOWN: 'One of those seats does not exist.',
  SEAT_DUPLICATE: 'The same seat was picked twice.',
  SEAT_TIER_MISMATCH: 'Those seats are not in this tier.',
  ORPHAN_SEAT: 'That pick would leave a single open seat stranded between two taken ones. Shift the pick by one seat or take the single too.',
  HOLD_EXPIRED: 'The hold ran out before payment started. The seats are back on sale.',
  HOLD_RELEASED: 'That hold was already released.',
  HOLD_NOT_HELD: 'That hold is no longer waiting for payment.',
  HOLD_NOT_YOURS: 'That hold belongs to another customer.',
  HOLD_UNKNOWN: 'No such hold.',
  HOLD_ID_DUPLICATE: 'That hold id is already used; try again.',
  WAITLIST_NOT_NEEDED: 'No need to wait: this can be bought now.',
  WAITLIST_DUPLICATE: 'You are already waiting for this.',
  WAITLIST_NOT_YOURS: 'That waitlist place belongs to another customer.',
  WAITLIST_UNKNOWN: 'No such waitlist place.',
  WAITLIST_TARGET_UNKNOWN: 'There is no waitlist for that.',
  REFUND_WINDOW_CLOSED: 'Refund window closed: it is too close to the show for a refund.',
  TICKET_CHECKED_IN: 'That ticket was already used at the door, so it cannot be refunded.',
  TICKET_ALREADY_REFUNDED: 'That ticket was already refunded.',
  TICKET_NOT_IN_ORDER: 'That ticket is not in this order.',
  ORDER_UNKNOWN: 'No such order.',
  ORDER_NOT_YOURS: 'That order belongs to another customer.',
  EVENT_CANCELLED: 'The event is cancelled; nothing more can be sold.',
};

/** The sentence for a code, or null when the screen should show the engine's detail as it is. */
export const sayCode = (code: string): string | null => SAY[code] ?? null;

/** Accepted is good, a hold or a wait is hold, a refusal is risk. */
export const codeKind = (status: string, code: string): PillKind =>
  status !== 'OK' ? 'risk' : code === 'HELD' || code === 'PAYING' || code === 'WAITLISTED' ? 'hold' : 'good';
