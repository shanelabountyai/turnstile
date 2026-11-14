// Task 2.4 (D-22): two concurrent HOLDs for the last floor ticket → exactly one HELD, one SOLD_OUT_POOL. Plus the
// cast path's own contract: idempotent on cmd_id, the CommandLog row for a reject, the delta written only for what moved.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { castCommand } from '@/checkout/cast';
import { loadFixtureEvent } from '@/checkout/load';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

let orgId = '';
let eventId = '';
const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });

// The golden base event (tests/inventory/golden.test.ts): FLOOR 10 under EARLY 4 · ADV 6 · DOOR 5; BALCONY one row of 12.
const BASE = {
  event_id: 'EV-GOLD', name: 'golden', venue: 'none', timezone_label: 'America/Chicago',
  starts_at: '2027-03-20T20:00:00', doors_at: '2027-03-20T19:00:00', sales_open_at: '2026-12-01T10:00:00', sales_close_at: '2027-03-20T20:00:00',
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
const T0 = '2026-12-02T10:00:00';
const hold = (n: string, at: string, tier: string, qty: number, seats: string[] = []) =>
  castCommand(orgId, eventId, cmd({ cmd_id: `K-${n}`, at, kind: 'HOLD', customer: `C-${n}`, ref: `H-${n}`, tier_id: tier, qty, seats }));

beforeAll(async () => {
  await resetAuthTables();
  orgId = (await makeOrg('cast')).id;
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-cast-'));
  writeFileSync(join(dir, 'event.json'), JSON.stringify(BASE));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\n');
  eventId = (await loadFixtureEvent(orgId, dir)).eventId;
});

describe('cast path', () => {
  it('fills the floor to one ticket (EARLY 4 + ADV 5 of 10) and the pool is the truth', async () => {
    expect((await hold('e1', T0, 'EARLY', 4)).code).toBe('HELD');
    expect((await hold('a1', T0, 'ADV', 5)).code).toBe('HELD');
    expect(await db.hold.count({ where: { eventId, state: 'HELD' } })).toBe(2);
    expect((await hold('a2', T0, 'ADV', 2))).toMatchObject({ status: 'REJECT', code: 'SOLD_OUT_POOL', detail: 'pool=1 tier=1' });
  });

  it('two concurrent HOLDs for the last floor ticket: exactly one HELD, one SOLD_OUT_POOL (D-22)', async () => {
    const codes = (await Promise.all([hold('race-a', '2026-12-02T10:00:01', 'ADV', 1), hold('race-b', '2026-12-02T10:00:01', 'ADV', 1)])).map((r) => r.code).sort();
    expect(codes).toEqual(['HELD', 'SOLD_OUT_POOL']);
    const log = await db.commandLog.findMany({ where: { eventId, cmdId: { in: ['K-race-a', 'K-race-b'] } } });
    expect(log.map((l) => l.status).sort()).toEqual(['OK', 'REJECT']);
    expect((await db.hold.aggregate({ where: { eventId, state: 'HELD' }, _sum: { qty: true } }))._sum.qty).toBe(10);
  });

  it('is idempotent on cmd_id: a replay returns the stored result and writes nothing', async () => {
    const before = await db.commandLog.count({ where: { eventId } });
    const r = await hold('race-a', '2026-12-02T10:00:01', 'ADV', 1);
    expect(['HELD', 'SOLD_OUT_POOL']).toContain(r.code);
    expect(await db.commandLog.count({ where: { eventId } })).toBe(before);
  });

  it('refuses a command earlier than the log (the stream is ordered, D-8)', async () => {
    await expect(hold('late', '2026-12-02T09:59:59', 'ADV', 1)).rejects.toThrow('is before the log');
  });

  it('expiry runs before the command (one second early: still sold out; at the expiry second: free), and the delta carries the transitions', async () => {
    expect((await hold('early', '2026-12-02T10:09:59', 'ADV', 1)).code).toBe('SOLD_OUT_POOL');
    expect((await hold('after', '2026-12-02T10:10:00', 'ADV', 5)).code).toBe('HELD'); // the race winner's 1 still held until 10:10:01
    expect(await db.hold.count({ where: { eventId, state: 'EXPIRED' } })).toBe(2); // e1 and a1, expired by advance() inside K-after's transaction
    expect((await db.commandLog.findUniqueOrThrow({ where: { eventId_cmdId: { eventId, cmdId: 'K-early' } } })).code).toBe('SOLD_OUT_POOL');
  });

  it('writes seat transitions and records a reject in the log (orphan rule, D-14)', async () => {
    expect((await hold('seat', '2026-12-02T10:10:01', 'BALC', 0, ['A-A-01', 'A-A-02'])).code).toBe('HELD');
    expect(await db.seat.findMany({ where: { eventId, state: 'HELD' }, select: { seatId: true, holdId: true }, orderBy: { seatId: 'asc' } })).toEqual([{ seatId: 'A-A-01', holdId: 'H-seat' }, { seatId: 'A-A-02', holdId: 'H-seat' }]);
    expect(await hold('orphan', '2026-12-02T10:10:02', 'BALC', 0, ['A-A-04', 'A-A-05'])).toMatchObject({ status: 'REJECT', code: 'ORPHAN_SEAT' });
    expect((await db.commandLog.findUniqueOrThrow({ where: { eventId_cmdId: { eventId, cmdId: 'K-orphan' } } })).code).toBe('ORPHAN_SEAT');
  });

  it('pays, confirms and refunds through the cast path: order, tickets, seat SOLD then OPEN, refund row', async () => {
    const pay = await castCommand(orgId, eventId, cmd({ cmd_id: 'K-pay', at: '2026-12-02T10:11:00', kind: 'PAY_START', customer: 'C-seat', ref: 'H-seat', payment_id: 'pi_test_1' }));
    expect(pay).toMatchObject({ code: 'PAYING', detail: 'pi_test_1 12700' });
    const ok = await castCommand(orgId, eventId, cmd({ cmd_id: 'K-ok', at: '2026-12-02T10:12:00', kind: 'PAY_SUCCEEDED', payment_id: 'pi_test_1' }), { stripeEventId: 'evt_1' });
    expect(ok).toMatchObject({ code: 'CONFIRMED', detail: 'ORD-00001 T-00001 T-00002' });
    expect(await db.ticket.count({ where: { eventId, state: 'ISSUED' } })).toBe(2);
    expect((await db.seat.findUniqueOrThrow({ where: { eventId_seatId: { eventId, seatId: 'A-A-01' } } })).state).toBe('SOLD');
    const dup = await castCommand(orgId, eventId, cmd({ cmd_id: 'K-dup', at: '2026-12-02T10:12:30', kind: 'PAY_SUCCEEDED', payment_id: 'pi_test_1' }), { stripeEventId: 'evt_2' });
    expect(dup.code).toBe('PAYMENT_DUPLICATE');
    const refund = await castCommand(orgId, eventId, cmd({ cmd_id: 'K-ref', at: '2026-12-02T10:13:00', kind: 'REFUND_REQUEST', customer: 'C-seat', ref: 'ORD-00001', tickets: ['T-00001'] }));
    expect(refund).toMatchObject({ code: 'REFUNDED', detail: 'R-00001 6350 bps=10000 days=108' });
    expect((await db.seat.findUniqueOrThrow({ where: { eventId_seatId: { eventId, seatId: 'A-A-01' } } })).state).toBe('OPEN');
    expect(await db.refund.findMany({ where: { eventId } })).toMatchObject([{ refundId: 'R-00001', amountCents: 6350, stripeRefundId: null }]);
  });
});
