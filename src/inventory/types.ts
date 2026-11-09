// Engine state records (brief §2). Timestamps are Timestamp strings; money is Cents; everything else is closed vocabulary.
import type { Kind, HoldState } from './codes';
import type { Timestamp } from './time';

export interface Command {
  cmd_id: string; at: Timestamp; kind: Kind | string; customer: string; ref: string; tier_id: string;
  qty: number; seats: string[]; payment_id: string; target: string; tickets: string[]; note: string;
}

export interface Result { cmd_id: string; at: Timestamp; kind: string; customer: string; status: 'OK' | 'REJECT'; code: string; detail: string }

export interface Hold {
  hold_id: string; kind: 'HOLD' | 'OFFER'; customer: string; tier: string; qty: number; seats: string[];
  state: HoldState; created_at: Timestamp; expires_at: Timestamp; price_cents: number; fee_cents: number;
  payment_id: string | null; pay_started_at: Timestamp | null; pay_timeout_at: Timestamp | null;
  entry_id: string | null; order_id: string | null; ended_at: Timestamp | null;
}

export type PaymentState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SUCCEEDED_LATE';
export interface Payment { payment_id: string; hold_id: string; amount_cents: number; state: PaymentState; started_at: Timestamp; ended_at: Timestamp | null }

export interface Order {
  order_id: string; customer: string; tier: string; qty: number; seats: string[]; gross_cents: number; fees_cents: number;
  payment_id: string; confirmed_at: Timestamp; tickets: string[]; hold_id: string; via_offer: boolean;
}

export type TicketState = 'ISSUED' | 'CHECKED_IN' | 'REFUNDED';
export interface Ticket {
  ticket_id: string; order_id: string; tier: string; seat: string; price_cents: number; fee_cents: number;
  state: TicketState; issued_at: Timestamp; checked_in_at: Timestamp | null; refunded_cents: number; refunded_at?: Timestamp; code: string;
}

export type EntryState = 'WAITING' | 'OFFERED' | 'FULFILLED' | 'LEFT' | 'CLOSED' | 'CLOSED_OFF_SALE' | 'OFFER_EXPIRED' | 'OFFER_DECLINED' | 'OFFER_PAY_FAILED';
export interface WaitlistEntry {
  entry_id: string; customer: string; target: string; qty: number; joined_at: Timestamp; state: EntryState;
  offer_id: string | null; offered_at: Timestamp | null; ended_at: Timestamp | null; order_id: string | null;
}

export interface Refund { refund_id: string; order_id: string; ticket_id: string; payment_id: string; amount_cents: number; reason: string; at: Timestamp }

export interface InventoryRow { scope: 'tier' | 'pool'; id: string; pool: string; capacity: number; sold: number; held: number; refunded: number; remaining: number; available: number }

export interface Summary {
  commands: number; ok: number; rejected: number; by_code: Record<string, number>; orders: number;
  tickets_issued: number; tickets_live: number; tickets_refunded: number; checked_in: number;
  captured_cents: number; refunded_cents: number; net_cents: number; refunds: number;
  holds: Record<string, number>; waitlist: Record<string, number>; offers_made: number; commitment: string;
}
