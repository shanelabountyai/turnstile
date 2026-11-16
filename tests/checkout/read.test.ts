// Task 3.2 (D-31): the read model. (1) The fixture's end state through `eventView` gives the numbers the screens will
// show (expected_summary.json and expected_inventory.csv). (2) `readEvent` reads stored rows, advances in memory and
// writes nothing; the expiry second is inclusive in the view as in the cast. The 2,662 commands through the database
// are covered by inventory:eval:db, which also checks readEvent against the recount.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { castCommand } from '@/checkout/cast';
import { loadFixtureEvent } from '@/checkout/load';
import { dollars, eventView, ledgerCsv, percent, readEvent } from '@/checkout/read';
import { parseCsv } from '@/inventory/csv';
import { Engine } from '@/inventory/engine';
import { loadCommands, loadEvent } from '@/inventory/load';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const T = (s: string) => timestamp(s, 'at');

describe('eventView on the fixture end state (seed 20261109)', () => {
  const engine = new Engine(loadEvent('fixtures'));
  const cmds = loadCommands('fixtures');
  engine.run(cmds);
  const v = eventView(engine, cmds.at(-1)!.at);
  const want = JSON.parse(readFileSync('fixtures/expected_summary.json', 'utf8')) as Record<string, number>;
  const tier = (id: string) => v.tiers.find((t) => t.tier === id)!;
  const pool = (id: string) => v.pools.find((p) => p.pool === id)!;

  it('FLOOR 800 sold of 800; DOOR 87 remaining, 0 available, pool sold out; BALCONY 204 sold, 12 available', () => {
    expect([pool('FLOOR').sold, pool('FLOOR').capacity, pool('FLOOR').remaining]).toEqual([800, 800, 0]);
    expect(tier('DOOR')).toMatchObject({ remaining: 87, poolRemaining: 0, available: 0, soldOut: 'SOLD_OUT_POOL' });
    expect(pool('BALCONY')).toMatchObject({ sold: 204, remaining: 12 });
    expect(tier('BALC')).toMatchObject({ available: 12, soldOut: null });
    expect(tier('ADV')).toMatchObject({ remaining: 0, available: 0, soldOut: 'SOLD_OUT_POOL' }); // pool before tier
  });

  it('ledger: captured 4,618,132 ¢, refunded 137,682 ¢, net 4,480,450 ¢ (= expected_summary.json)', () => {
    expect(v.ledger).toMatchObject({ capturedCents: 4618132, refundedCents: 137682, netCents: 4480450 });
    expect([v.ledger.capturedCents, v.ledger.refundedCents, v.ledger.netCents, v.ledger.refunds, v.ledger.ticketsLive, v.ledger.checkedIn])
      .toEqual([want.captured_cents, want.refunded_cents, want.net_cents, want.refunds, want.tickets_live, want.checked_in]);
    expect(v.ledger.toArrive).toBe(want.tickets_live! - want.checked_in!);
  });

  it('ledger CSV (task 3.7): columns sum to 4,618,132 / 137,682 / 4,480,450 ¢; order lines = expected_orders.csv', () => {
    const rows = parseCsv(ledgerCsv(v).replace(/\r\n/g, '\n'), 'ledger');
    const sum = (k: string) => rows.reduce((n, r) => n + Number(r[k]), 0);
    expect([sum('captured_cents'), sum('refunded_cents'), sum('net_cents')]).toEqual([4618132, 137682, 4480450]);
    expect(rows).toHaveLength(engine.summary().by_code.CONFIRMED! + rows.filter((r) => r.late).length);
    const late = rows.filter((r) => r.late);
    expect(late.map((r) => [r.order_id, r.late, r.refunded_cents === r.captured_cents])).toEqual([['', 'PAID_AFTER_TIMEOUT', true]]);
    const want = parseCsv(readFileSync('fixtures/expected_orders.csv', 'utf8'), 'expected_orders');
    expect(rows.filter((r) => r.order_id).map((r) => [r.order_id, r.payment_id, r.refunded_cents]).sort())
      .toEqual(want.map((o) => [o.order_id, o.payment_id, o.refunded_cents]).sort());
  });

  it('orders, seats and waitlists agree with the engine', () => {
    expect(v.orders).toHaveLength(want.orders!);
    // Per order, as the oracle has it (late-money refunds, PAID_AFTER_TIMEOUT, belong to no order, so this is below the ledger's total).
    const orders = parseCsv(readFileSync('fixtures/expected_orders.csv', 'utf8'), 'expected_orders');
    expect(v.orders.map((o) => [o.order, String(o.refundedCents)])).toEqual(orders.map((o) => [o.order_id, o.refunded_cents]));
    const seats = v.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
    expect([seats.length, seats.filter((s) => s.state === 'SOLD').length]).toEqual([216, 204]);
    const waiting = v.waitlists.flatMap((w) => w.waiting);
    expect(waiting).toHaveLength(engine.waitlist.filter((w) => w.state === 'WAITING').length);
    for (const w of v.waitlists) expect(w.waiting.map((x) => x.position)).toEqual(w.waiting.map((_, i) => i + 1));
  });
});

// The golden base event (as in cast.test.ts): FLOOR 10 under EARLY 4 · ADV 6 · DOOR 5; BALCONY one row of 12.
const BASE = {
  event_id: 'EV-READ', name: 'read', venue: 'none', timezone_label: 'America/Chicago',
  starts_at: '2027-03-20T20:00:00', doors_at: '2027-03-20T19:00:00', sales_open_at: '2026-12-01T10:00:00', sales_close_at: '2027-03-20T20:00:00',
  currency: 'USD', ticket_salt: 'read',
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
    refund_policy: [{ min_days_before: 0, refund_bps: 10000, fee_refunded: true }],
    cancellation_refund_bps: 10000,
  },
};

describe('readEvent (database)', () => {
  let orgId = '';
  let eventId = '';
  const cast = (n: string, at: string, c: Partial<Command>) =>
    castCommand(orgId, eventId, { cmd_id: `K-${n}`, customer: `C-${n}`, ref: `H-${n}`, tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', kind: 'HOLD', ...c, at: T(at) });

  beforeAll(async () => {
    await resetAuthTables();
    orgId = (await makeOrg('read')).id;
    const dir = mkdtempSync(join(tmpdir(), 'turnstile-read-'));
    writeFileSync(join(dir, 'event.json'), JSON.stringify(BASE));
    writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\n');
    eventId = (await loadFixtureEvent(orgId, dir)).eventId;
    expect((await cast('e', '2026-12-02T10:00:00', { tier_id: 'EARLY', qty: 4 })).code).toBe('HELD');
    expect((await cast('a', '2026-12-02T10:00:00', { tier_id: 'ADV', qty: 6 })).code).toBe('HELD');
    expect((await cast('w', '2026-12-02T10:00:01', { kind: 'WAITLIST_JOIN', ref: 'W-w', target: 'ADV', qty: 2 })).code).toBe('WAITLISTED');
  });

  it('before expiry: the pool is full, ADV is pool-limited, the waitlist head is position 1', async () => {
    const v = await readEvent(orgId, eventId, T('2026-12-02T10:09:59'));
    expect(v.tiers.find((t) => t.tier === 'ADV')).toMatchObject({ held: 6, available: 0, soldOut: 'SOLD_OUT_POOL' });
    expect(v.tiers.find((t) => t.tier === 'BALC')).toMatchObject({ available: 12, soldOut: null });
    expect(v.waitlists).toEqual([{ target: 'ADV', waiting: [{ entry: expect.any(String), customer: 'C-w', qty: 2, joinedAt: '2026-12-02T10:00:01', position: 1 }], offered: [] }]);
  });

  it('at the expiry second the view frees the holds and offers the head, and writes nothing (D-31)', async () => {
    const v = await readEvent(orgId, eventId, T('2026-12-02T10:10:00'));
    expect(v.tiers.find((t) => t.tier === 'EARLY')).toMatchObject({ held: 0, available: 4 });
    expect(v.tiers.find((t) => t.tier === 'ADV')).toMatchObject({ held: 2, available: 4 }); // the head's 2 are an offer hold now
    expect(v.waitlists[0]).toMatchObject({ waiting: [], offered: [{ customer: 'C-w', qty: 2, expiresAt: '2026-12-02T11:10:00' }] });
    expect(await db.hold.count({ where: { eventId, state: 'HELD' } })).toBe(2);
    expect(await db.hold.count({ where: { eventId, kind: 'OFFER' } })).toBe(0);
  });

  it('an `at` before the log reads as of the last command', async () => {
    expect((await readEvent(orgId, eventId, T('2026-12-01T00:00:00'))).asOf).toBe('2026-12-02T10:00:01');
  });
});

describe('display formatters (no float path)', () => {
  it('cents and bps format by string slicing', () => {
    expect([dollars(4618132), dollars(350), dollars(5), dollars(0), dollars(-137682)]).toEqual(['$46,181.32', '$3.50', '$0.05', '$0.00', '-$1,376.82']);
    expect([percent(10000), percent(5000), percent(125), percent(0)]).toEqual(['100%', '50%', '1.25%', '0%']);
  });
});
