// GT-01..GT-18 (docs/domain-brief.md §9): the same scenarios and exact values as tools/golden_answers.py. If a value
// here ever disagrees with the oracle, the oracle wins and the owner sees both derivations (non-negotiable 10).
import { describe, expect, it } from 'vitest';
import { Engine } from '@/inventory/engine';
import { canonicalJson, sha256Hex } from '@/inventory/canonical';
import { RulesInvalid } from '@/inventory/errors';
import { addMinutes, daysBefore, timestamp, type Timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';

const BASE = {
  event_id: 'EV-GOLD', name: 'golden', venue: 'none', timezone_label: 'America/Chicago',
  starts_at: '2027-03-20T20:00:00', doors_at: '2027-03-20T19:00:00',
  sales_open_at: '2026-12-01T10:00:00', sales_close_at: '2027-03-20T20:00:00',
  currency: 'USD', ticket_salt: 'gold',
  pools: [{ pool_id: 'FLOOR', kind: 'GA', capacity: 10 }, { pool_id: 'BALCONY', kind: 'RESERVED', capacity: 12 }],
  tiers: [
    { tier_id: 'EARLY', pool_id: 'FLOOR', allotment: 4, price_cents: 2500, on_sale_at: '2026-12-01T10:00:00', off_sale_at: '2027-01-16T00:00:00' },
    { tier_id: 'ADV', pool_id: 'FLOOR', allotment: 6, price_cents: 3499, on_sale_at: '2026-12-01T10:00:00', off_sale_at: '2027-03-20T17:00:00' },
    { tier_id: 'DOOR', pool_id: 'FLOOR', allotment: 5, price_cents: 4500, on_sale_at: '2027-03-20T17:00:00', off_sale_at: '2027-03-20T20:00:00' },
    { tier_id: 'BALC', pool_id: 'BALCONY', allotment: 12, price_cents: 6000, on_sale_at: '2026-12-01T10:00:00', off_sale_at: '2027-03-20T20:00:00' },
  ],
  sections: [{ section_id: 'A', pool_id: 'BALCONY', rows: ['A'], seats_per_row: 12 }],
  rules: {
    hold_ttl_minutes: 10, offer_ttl_minutes: 60, payment_timeout_minutes: 30, max_tickets_per_order: 8,
    prevent_orphan_seats: true, waitlist_rule: 'HEAD_BLOCKS', offer_expired_rule: 'DROP', service_fee_cents: 350,
    refund_policy: [
      { min_days_before: 30, refund_bps: 10000, fee_refunded: true },
      { min_days_before: 7, refund_bps: 5000, fee_refunded: false },
      { min_days_before: 0, refund_bps: 0, fee_refunded: false },
    ],
    cancellation_refund_bps: 10000,
  },
};

let n = 0;
const T = (s: string): Timestamp => timestamp(s, 'test');
function cmd(at: string, kind: string, customer = '', f: Partial<Command> = {}): Command {
  n++;
  return { cmd_id: `G-${String(n).padStart(4, '0')}`, at: T(at), kind, customer, ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...f };
}
function engine(over: Record<string, unknown> = {}): Engine {
  const ev = structuredClone(BASE) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (k === 'rules') ev.rules = { ...(ev.rules as object), ...(v as object) };
    else ev[k] = v;
  }
  return new Engine(ev);
}
/** HOLD → PAY_START → PAY_SUCCEEDED one minute apart; returns the order id. */
function buy(e: Engine, at: string, customer: string, tier: string, qty = 0, seats: string[] = [], hid?: string, pid?: string): string {
  hid = hid ?? `H-${customer}-${at.slice(-8).replaceAll(':', '')}`;
  pid = pid ?? `pi-${hid}`;
  const r = e.apply(cmd(at, 'HOLD', customer, { ref: hid, tier_id: tier, qty, seats }));
  expect(r.code).toBe('HELD');
  e.apply(cmd(addMinutes(T(at), 1), 'PAY_START', customer, { ref: hid, payment_id: pid }));
  const c = e.apply(cmd(addMinutes(T(at), 2), 'PAY_SUCCEEDED', '', { payment_id: pid }));
  expect(c.code).toBe('CONFIRMED');
  return e.holds.get(hid)!.order_id!;
}

describe('golden cases GT-01..GT-18', () => {
  it('GT-01 canonical JSON and SHA-256 are fixed', () => {
    expect(canonicalJson({ b: [2, 1], a: 'x' })).toBe('{"a":"x","b":[2,1]}');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('GT-02 ticket code = sha256(event_id|ticket_id|salt)[:20]', () => {
    expect(sha256Hex('EV-SYNTH-001|T-00001|fixture-salt-20261109').slice(0, 20)).toBe('0624bed1c5bafa86566d');
  });

  it('GT-03 the pool is the truth', () => {
    const e = engine();
    buy(e, '2026-12-02T10:00:00', 'c1', 'EARLY', 4);
    buy(e, '2026-12-02T11:00:00', 'c2', 'ADV', 6);
    expect([e.tierRemaining('DOOR'), e.poolRemaining('FLOOR'), e.available('DOOR')]).toEqual([5, 0, 0]);
    expect(e.apply(cmd('2027-03-20T17:00:00', 'HOLD', 'c3', { ref: 'h', tier_id: 'DOOR', qty: 1 })).code).toBe('SOLD_OUT_POOL');
    const e2 = engine();
    const o1 = buy(e2, '2026-12-02T10:00:00', 'c1', 'EARLY', 4);
    buy(e2, '2026-12-02T11:00:00', 'c2', 'ADV', 6);
    const r = e2.apply(cmd('2027-01-04T12:00:00', 'REFUND_REQUEST', 'c1', { ref: o1, tickets: [e2.orders.get(o1)!.tickets[0]!] }));
    expect([r.code, e2.refunds.at(-1)!.amount_cents]).toEqual(['REFUNDED', 2850]);
    const r2 = e2.apply(cmd('2027-03-20T17:00:00', 'HOLD', 'c3', { ref: 'h', tier_id: 'DOOR', qty: 1 }));
    expect([r2.code, e2.tierRemaining('EARLY'), e2.available('EARLY')]).toEqual(['HELD', 1, 0]);
  });

  it('GT-04 hold TTL boundary is inclusive', () => {
    const e = engine();
    e.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 6 }));
    expect(e.apply(cmd('2026-12-02T10:09:59', 'HOLD', 'c2', { ref: 'h2', tier_id: 'ADV', qty: 1 })).code).toBe('SOLD_OUT_TIER');
    const r = e.apply(cmd('2026-12-02T10:10:00', 'HOLD', 'c2', { ref: 'h3', tier_id: 'ADV', qty: 1 }));
    expect([r.code, e.holds.get('h1')!.state]).toEqual(['HELD', 'EXPIRED']);
  });

  it('GT-05 orphan rule', () => {
    const e = engine();
    e.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'BALC', seats: ['A-A-01', 'A-A-02'] }));
    expect(e.apply(cmd('2026-12-02T10:01:00', 'HOLD', 'c2', { ref: 'h2', tier_id: 'BALC', seats: ['A-A-04', 'A-A-05'] })).code).toBe('ORPHAN_SEAT');
    expect(e.apply(cmd('2026-12-02T10:02:00', 'HOLD', 'c2', { ref: 'h3', tier_id: 'BALC', seats: ['A-A-03', 'A-A-04'] })).code).toBe('HELD');
    const r = e.apply(cmd('2026-12-02T10:03:00', 'HOLD', 'c3', { ref: 'h4', tier_id: 'BALC', seats: ['A-A-05', 'A-A-06', 'A-A-07', 'A-A-08', 'A-A-09', 'A-A-10', 'A-A-11'] }));
    expect([r.code, e.seats.get('A-A-12')!.state]).toEqual(['HELD', 'OPEN']);
    expect(e.apply(cmd('2026-12-02T10:04:00', 'HOLD', 'c4', { ref: 'h5', tier_id: 'BALC', seats: ['A-A-12'] })).code).toBe('HELD');
    const off = engine({ rules: { prevent_orphan_seats: false } });
    off.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'BALC', seats: ['A-A-01', 'A-A-02'] }));
    expect(off.apply(cmd('2026-12-02T10:01:00', 'HOLD', 'c2', { ref: 'h2', tier_id: 'BALC', seats: ['A-A-04', 'A-A-05'] })).code).toBe('HELD');
  });

  it('GT-06 refund window is whole days before start on the one axis', () => {
    const e = engine();
    expect(e.refundTerms(T('2027-02-18T19:00:00'))[0]).toBe(30);
    expect(e.refundTerms(T('2027-02-18T21:00:00'))[0]).toBe(29);
    expect(e.refundTerms(T('2027-03-13T20:00:00'))[0]).toBe(7);
    expect(e.refundTerms(T('2027-03-13T20:00:01'))[0]).toBe(6);
    expect(['2027-02-18T19:00:00', '2027-02-18T21:00:00', '2027-03-13T20:00:00', '2027-03-13T20:00:01'].map((t) => e.refundTerms(T(t))[1].refund_bps)).toEqual([10000, 5000, 5000, 0]);
    expect(daysBefore(T('2027-03-20T20:00:00'), T('2027-03-20T20:00:01'))).toBe(-1);
  });

  it('GT-07 half refund floors 3499 → 1749; fee kept; full refund adds the fee', () => {
    const e = engine();
    const o = buy(e, '2026-12-02T10:00:00', 'c1', 'ADV', 2);
    const t = e.orders.get(o)!.tickets;
    const r = e.apply(cmd('2027-03-01T12:00:00', 'REFUND_REQUEST', 'c1', { ref: o, tickets: [t[0]!] }));
    expect([r.code, e.refunds.at(-1)!.amount_cents]).toEqual(['REFUNDED', 1749]);
    expect(e.apply(cmd('2027-03-15T12:00:00', 'REFUND_REQUEST', 'c1', { ref: o, tickets: [t[1]!] })).code).toBe('REFUND_WINDOW_CLOSED');
    const e2 = engine();
    const o2 = buy(e2, '2026-12-02T10:00:00', 'c1', 'ADV', 1);
    e2.apply(cmd('2027-01-04T12:00:00', 'REFUND_REQUEST', 'c1', { ref: o2, tickets: e2.orders.get(o2)!.tickets }));
    expect(e2.refunds.at(-1)!.amount_cents).toBe(3849);
  });

  it('GT-08 payment timeout boundary and the cart TTL being off while paying', () => {
    const e = engine();
    e.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 2 }));
    e.apply(cmd('2026-12-02T10:01:00', 'PAY_START', 'c1', { ref: 'h1', payment_id: 'p1' }));
    const r = e.apply(cmd('2026-12-02T10:31:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }));
    expect([r.code, e.refunds.at(-1)!.amount_cents, e.tickets.size, e.poolRemaining('FLOOR')]).toEqual(['PAID_AFTER_TIMEOUT', 7698, 0, 10]);
    const e2 = engine();
    e2.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 2 }));
    e2.apply(cmd('2026-12-02T10:01:00', 'PAY_START', 'c1', { ref: 'h1', payment_id: 'p1' }));
    const r2 = e2.apply(cmd('2026-12-02T10:30:59', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }));
    expect([r2.code, e2.tickets.size]).toEqual(['CONFIRMED', 2]);
    const e3 = engine();
    e3.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 2 }));
    e3.apply(cmd('2026-12-02T10:09:00', 'PAY_START', 'c1', { ref: 'h1', payment_id: 'p1' }));
    expect(e3.apply(cmd('2026-12-02T10:25:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' })).code).toBe('CONFIRMED');
  });

  it('GT-09 HEAD_BLOCKS', () => {
    const e = engine();
    const o1 = buy(e, '2026-12-02T10:00:00', 'c1', 'ADV', 6);
    buy(e, '2026-12-02T10:10:00', 'c2', 'EARLY', 4);
    e.apply(cmd('2026-12-02T11:00:00', 'WAITLIST_JOIN', 'w1', { target: 'ADV', qty: 4 }));
    e.apply(cmd('2026-12-02T11:01:00', 'WAITLIST_JOIN', 'w2', { target: 'ADV', qty: 2 }));
    const t = e.orders.get(o1)!.tickets;
    e.apply(cmd('2026-12-03T10:00:00', 'REFUND_REQUEST', 'c1', { ref: o1, tickets: t.slice(0, 2) }));
    expect(e.waitlist.map((x) => x.state)).toEqual(['WAITING', 'WAITING']);
    e.apply(cmd('2026-12-03T10:05:00', 'REFUND_REQUEST', 'c1', { ref: o1, tickets: t.slice(2) }));
    expect(e.waitlist.map((x) => [x.state, x.offer_id])).toEqual([['OFFERED', 'O-0001'], ['OFFERED', 'O-0002']]);
    expect([e.available('ADV'), e.holds.get('O-0001')!.qty, e.holds.get('O-0002')!.qty]).toEqual([0, 4, 2]);
    expect(e.apply(cmd('2026-12-03T10:06:00', 'PAY_START', 'w2', { ref: 'O-0001', payment_id: 'p9' })).code).toBe('HOLD_NOT_YOURS');
    e.apply(cmd('2026-12-03T10:07:00', 'PAY_START', 'w1', { ref: 'O-0001', payment_id: 'p1' }));
    const r = e.apply(cmd('2026-12-03T10:08:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }));
    expect([r.code, e.waitlist[0]!.state, e.orders.get(e.waitlist[0]!.order_id!)!.via_offer]).toEqual(['CONFIRMED', 'FULFILLED', true]);
  });

  it('GT-10 DROP: an ignored offer expires, the entry is dropped, the next head is offered in the same tick', () => {
    const e = engine();
    buy(e, '2026-12-02T10:00:00', 'c1', 'ADV', 6);
    buy(e, '2026-12-02T10:10:00', 'c2', 'EARLY', 4);
    e.apply(cmd('2026-12-02T11:00:00', 'WAITLIST_JOIN', 'w1', { target: 'ADV', qty: 2 }));
    e.apply(cmd('2026-12-02T11:01:00', 'WAITLIST_JOIN', 'w2', { target: 'ADV', qty: 2 }));
    const o1 = e.orders.get('ORD-00001')!;
    e.apply(cmd('2026-12-03T10:00:00', 'REFUND_REQUEST', 'c1', { ref: 'ORD-00001', tickets: o1.tickets.slice(0, 2) }));
    expect(e.waitlist.map((x) => [x.state, x.offer_id])).toEqual([['OFFERED', 'O-0001'], ['WAITING', null]]);
    const r = e.apply(cmd('2026-12-03T11:00:00', 'PAY_START', 'w1', { ref: 'O-0001', payment_id: 'p1' }));
    expect([r.code, e.waitlist[0]!.state, e.waitlist[1]!.state, e.waitlist[1]!.offer_id]).toEqual(['HOLD_EXPIRED', 'OFFER_EXPIRED', 'OFFERED', 'O-0002']);
    expect(e.holds.get('O-0002')!.expires_at).toBe('2026-12-03T12:00:00');
  });

  it('GT-11 cancellation refunds everything, then closes the event', () => {
    const e = engine({ doors_at: '2026-12-10T19:00:00' });
    const o = buy(e, '2026-12-02T10:00:00', 'c1', 'BALC', 0, ['A-A-01', 'A-A-02']);
    e.apply(cmd('2026-12-10T19:05:00', 'CHECK_IN', '', { ref: e.orders.get(o)!.tickets[0]! }));
    e.apply(cmd('2026-12-10T19:07:00', 'HOLD', 'c2', { ref: 'h2', tier_id: 'ADV', qty: 1 }));
    e.apply(cmd('2026-12-10T19:08:00', 'PAY_START', 'c2', { ref: 'h2', payment_id: 'p2' }));
    const r = e.apply(cmd('2026-12-10T19:10:00', 'CANCEL_EVENT'));
    expect([r.code, r.detail]).toEqual(['EVENT_CANCELLED_OK', 'tickets=2 refunded_cents=12700']);
    expect([e.holds.get('h2')!.state, e.seats.get('A-A-01')!.state]).toEqual(['CANCELLED', 'OPEN']);
    const late = e.apply(cmd('2026-12-10T19:11:00', 'PAY_SUCCEEDED', '', { payment_id: 'p2' }));
    expect([late.code, e.refunds.at(-1)!.amount_cents]).toEqual(['PAID_AFTER_CANCEL', 3849]);
    expect(e.apply(cmd('2026-12-10T19:12:00', 'HOLD', 'c3', { ref: 'h3', tier_id: 'ADV', qty: 1 })).code).toBe('EVENT_CANCELLED');
    expect(e.apply(cmd('2026-12-10T19:13:00', 'CANCEL_EVENT')).code).toBe('ALREADY_CANCELLED');
    expect(e.summary().net_cents).toBe(0);
  });

  it('GT-12 webhooks are idempotent', () => {
    const e = engine();
    e.apply(cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 1 }));
    e.apply(cmd('2026-12-02T10:01:00', 'PAY_START', 'c1', { ref: 'h1', payment_id: 'p1' }));
    e.apply(cmd('2026-12-02T10:02:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }));
    const r1 = e.apply(cmd('2026-12-02T10:03:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }));
    const r2 = e.apply(cmd('2026-12-02T10:04:00', 'PAY_FAILED', '', { payment_id: 'p1' }));
    expect([r1.code, r2.code, e.tickets.size, e.tickets.get('T-00001')!.state]).toEqual(['PAYMENT_DUPLICATE', 'PAYMENT_DUPLICATE', 1, 'ISSUED']);
  });

  it('GT-13 RULES_INVALID outside the closed schema', () => {
    const bad: Record<string, unknown>[] = [
      { rules: { waitlist_rule: 'SKIP_TO_FIT' } },
      { rules: { offer_expired_rule: 'REQUEUE' } },
      { rules: { refund_policy: [{ min_days_before: 7, refund_bps: 5000, fee_refunded: false }] } },
      { rules: { refund_policy: [{ min_days_before: 7, refund_bps: 5000, fee_refunded: false }, { min_days_before: 30, refund_bps: 10000, fee_refunded: true }, { min_days_before: 0, refund_bps: 0, fee_refunded: false }] } },
      { pools: [{ pool_id: 'FLOOR', kind: 'GA', capacity: 10 }, { pool_id: 'BALCONY', kind: 'RESERVED', capacity: 13 }] },
    ];
    for (const over of bad) expect(() => engine(over)).toThrow(RulesInvalid);
    expect(() => engine({ rules: { waitlist_rule: 'SKIP_TO_FIT' } })).toThrow(/rules\.waitlist_rule/);
  });

  it('GT-14 order independence; same-second ties by cmd_id', () => {
    const cmds = [
      cmd('2026-12-02T10:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 2 }),
      cmd('2026-12-02T10:00:00', 'HOLD', 'c2', { ref: 'h2', tier_id: 'ADV', qty: 5 }),
      cmd('2026-12-02T10:01:00', 'PAY_START', 'c1', { ref: 'h1', payment_id: 'p1' }),
      cmd('2026-12-02T10:02:00', 'PAY_SUCCEEDED', '', { payment_id: 'p1' }),
      cmd('2026-12-02T10:11:00', 'HOLD', 'c2', { ref: 'h3', tier_id: 'ADV', qty: 4 }),
    ];
    const a = engine(); a.run(cmds);
    const b = engine(); b.run([...cmds].reverse());
    expect(a.results.map((r) => r.code)).toEqual(['HELD', 'SOLD_OUT_TIER', 'PAYING', 'CONFIRMED', 'HELD']);
    expect(b.results.map((r) => r.code)).toEqual(a.results.map((r) => r.code));
    expect(b.summary().commitment).toBe(a.summary().commitment);
    expect(a.results[0]!.cmd_id < a.results[1]!.cmd_id).toBe(true);
  });

  it('GT-15 one HOLD, one code, by precedence', () => {
    const e = engine();
    expect(e.apply(cmd('2026-11-30T09:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'NOPE', qty: 99 })).code).toBe('SALES_NOT_OPEN');
    expect(e.apply(cmd('2026-12-02T09:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'NOPE', qty: 99 })).code).toBe('TIER_UNKNOWN');
    expect(e.apply(cmd('2026-12-02T09:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'DOOR', qty: 99 })).code).toBe('TIER_NOT_ON_SALE');
    expect(e.apply(cmd('2026-12-02T09:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'ADV', qty: 99 })).code).toBe('QTY_OVER_LIMIT');
    expect(e.apply(cmd('2026-12-02T09:00:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'BALC', qty: 2, seats: ['A-A-01', 'A-A-01'] })).code).toBe('SEAT_DUPLICATE');
  });

  it('GT-16 check-in', () => {
    const e = engine();
    const o = buy(e, '2026-12-02T10:00:00', 'c1', 'ADV', 2);
    const t = e.orders.get(o)!.tickets;
    expect(e.apply(cmd('2027-03-20T18:59:59', 'CHECK_IN', '', { ref: t[0]! })).code).toBe('DOORS_NOT_OPEN');
    expect(e.apply(cmd('2027-03-20T19:00:00', 'CHECK_IN', '', { ref: t[0]! })).code).toBe('CHECKED_IN');
    const r = e.apply(cmd('2027-03-20T19:00:01', 'CHECK_IN', '', { ref: t[0]! }));
    expect([r.code, r.detail]).toEqual(['ALREADY_CHECKED_IN', '2027-03-20T19:00:00']);
    expect(e.apply(cmd('2027-03-20T19:01:00', 'REFUND_REQUEST', 'c1', { ref: o, tickets: [t[0]!] })).code).toBe('TICKET_CHECKED_IN');
  });

  it('GT-17 the sales window is half-open', () => {
    const e = engine();
    expect(e.apply(cmd('2027-03-20T19:59:59', 'HOLD', 'c1', { ref: 'h1', tier_id: 'DOOR', qty: 1 })).code).toBe('HELD');
    expect(e.apply(cmd('2027-03-20T20:00:00', 'HOLD', 'c2', { ref: 'h2', tier_id: 'DOOR', qty: 1 })).code).toBe('SALES_CLOSED');
  });

  it('GT-18 waitlist is for people who cannot be served now; reserved "served" means a block fits', () => {
    const e = engine({ rules: { prevent_orphan_seats: false } });
    const r = e.apply(cmd('2026-12-02T10:00:00', 'WAITLIST_JOIN', 'w1', { target: 'ADV', qty: 2 }));
    expect([r.code, r.detail]).toEqual(['WAITLIST_NOT_NEEDED', 'available=6']);
    e.apply(cmd('2026-12-02T10:01:00', 'HOLD', 'c1', { ref: 'h1', tier_id: 'BALC', seats: ['A-A-02', 'A-A-03', 'A-A-05', 'A-A-06', 'A-A-08', 'A-A-09', 'A-A-11'] }));
    expect([e.tierRemaining('BALC'), e.sectionCanServe('A', 1), e.sectionCanServe('A', 2)]).toEqual([5, true, false]);
    expect(e.apply(cmd('2026-12-02T10:02:00', 'WAITLIST_JOIN', 'w2', { target: 'A', qty: 2 })).code).toBe('WAITLISTED');
    expect(e.apply(cmd('2026-12-02T10:03:00', 'WAITLIST_JOIN', 'w3', { target: 'A', qty: 1 })).code).toBe('WAITLIST_NOT_NEEDED');
  });
});
