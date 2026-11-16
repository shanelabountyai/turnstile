// The seven expected tables as flat string rows, in the oracle's column order (tools/reference_alloc.py
// `expected_tables`). Shared by the fixture-agreement test, the shuffle test and scripts/inventory-eval.ts.
// Still pure: it reads the engine, never a file.
import { compareStrings } from './canonical';
import type { Engine } from './engine';
import type { Summary } from './types';

export type Row = Record<string, string>;
const s = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

export const COLUMNS = {
  expected_commands: ['cmd_id', 'at', 'kind', 'customer', 'status', 'code', 'detail'],
  expected_inventory: ['scope', 'id', 'pool', 'capacity', 'sold', 'held', 'refunded', 'remaining', 'available'],
  expected_orders: ['order_id', 'customer', 'tier', 'qty', 'seats', 'gross_cents', 'fees_cents', 'refunded_cents', 'payment_id', 'confirmed_at', 'via_offer', 'tickets'],
  expected_tickets: ['ticket_id', 'order_id', 'tier', 'seat', 'price_cents', 'fee_cents', 'state', 'refunded_cents', 'checked_in_at', 'code'],
  expected_waitlist: ['entry_id', 'customer', 'target', 'qty', 'joined_at', 'state', 'offer_id', 'offered_at', 'ended_at', 'order_id'],
  expected_refunds: ['refund_id', 'order_id', 'ticket_id', 'payment_id', 'amount_cents', 'reason', 'at'],
} as const;
export type TableName = keyof typeof COLUMNS;

export interface Tables { expected_commands: Row[]; expected_inventory: Row[]; expected_orders: Row[]; expected_tickets: Row[]; expected_waitlist: Row[]; expected_refunds: Row[]; summary: Summary }

export function tables(e: Engine): Tables {
  const expected_commands = e.results.map((r) => ({ cmd_id: r.cmd_id, at: r.at, kind: r.kind, customer: r.customer, status: r.status, code: r.code, detail: r.detail }));
  const expected_inventory = e.inventoryRows().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, s(v)])));
  const expected_orders = [...e.orders.values()].sort((a, b) => compareStrings(a.order_id, b.order_id)).map((o) => ({
    order_id: o.order_id, customer: o.customer, tier: o.tier, qty: s(o.qty), seats: o.seats.join(' '), gross_cents: s(o.gross_cents), fees_cents: s(o.fees_cents),
    refunded_cents: s(o.tickets.reduce((acc, t) => acc + e.tickets.get(t)!.refunded_cents, 0)), payment_id: o.payment_id, confirmed_at: o.confirmed_at,
    via_offer: s(o.via_offer), tickets: o.tickets.join(' '),
  }));
  const expected_tickets = [...e.tickets.values()].sort((a, b) => compareStrings(a.ticket_id, b.ticket_id)).map((t) => ({
    ticket_id: t.ticket_id, order_id: t.order_id, tier: t.tier, seat: t.seat, price_cents: s(t.price_cents), fee_cents: s(t.fee_cents), state: t.state,
    refunded_cents: s(t.refunded_cents), checked_in_at: s(t.checked_in_at), code: t.code,
  }));
  const expected_waitlist = e.waitlist.map((w) => ({
    entry_id: w.entry_id, customer: w.customer, target: w.target, qty: s(w.qty), joined_at: w.joined_at, state: w.state, offer_id: s(w.offer_id),
    offered_at: s(w.offered_at), ended_at: s(w.ended_at), order_id: s(w.order_id),
  }));
  const expected_refunds = e.refunds.map((r) => ({ refund_id: r.refund_id, order_id: r.order_id, ticket_id: r.ticket_id, payment_id: r.payment_id, amount_cents: s(r.amount_cents), reason: r.reason, at: r.at }));
  return { expected_commands, expected_inventory, expected_orders, expected_tickets, expected_waitlist, expected_refunds, summary: e.summary() };
}

/** First difference between two row lists, as a one-line description, or null when equal. */
export function firstDiff(name: string, got: Row[], want: Row[], columns: readonly string[]): string | null {
  if (got.length !== want.length) return `${name}: ${got.length} rows, expected ${want.length}`;
  for (let i = 0; i < got.length; i++) {
    for (const c of columns) {
      if ((got[i]![c] ?? '') !== (want[i]![c] ?? '')) return `${name} row ${i + 2} (${want[i]![columns[0]!] ?? ''}) column ${c}: got ${JSON.stringify(got[i]![c] ?? '')}, expected ${JSON.stringify(want[i]![c] ?? '')}`;
    }
  }
  return null;
}
