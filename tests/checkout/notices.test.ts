// Task 3.8 (D-33): an order confirmation and an offer notice are queued in the cast transaction, and the outbox drain
// never sends them.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db';
import { castCommand } from '@/checkout/cast';
import { loadFixtureEvent } from '@/checkout/load';
import { HELD_NOTE } from '@/checkout/notices';
import { drainOutbox, MAX_ATTEMPTS } from '@/modules/notifications/outbox';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/core/email/transport', async (orig) => ({ ...(await orig<object>()), sendEmail }));

let orgId = '';
let eventId = '';
const cast = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }) =>
  castCommand(orgId, eventId, { customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });

// One GA pool of 2 under one tier: C-a holds both, C-b waits, C-a releases → C-b is offered in the same tick.
const EVENT = {
  event_id: 'EV-NOTE', name: 'notices', venue: 'none', timezone_label: 'America/Chicago',
  starts_at: '2027-03-20T20:00:00', doors_at: '2027-03-20T19:00:00', sales_open_at: '2026-12-01T10:00:00', sales_close_at: '2027-03-20T20:00:00',
  currency: 'USD', ticket_salt: 'note',
  pools: [{ pool_id: 'FLOOR', kind: 'GA', capacity: 2 }],
  tiers: [{ tier_id: 'ADV', pool_id: 'FLOOR', allotment: 2, price_cents: 3499, on_sale_at: '2026-12-01T10:00:00', off_sale_at: '2027-03-20T17:00:00' }],
  sections: [],
  rules: {
    hold_ttl_minutes: 10, offer_ttl_minutes: 60, payment_timeout_minutes: 30, max_tickets_per_order: 8,
    prevent_orphan_seats: true, waitlist_rule: 'HEAD_BLOCKS', offer_expired_rule: 'DROP', service_fee_cents: 350,
    refund_policy: [{ min_days_before: 0, refund_bps: 10000, fee_refunded: true }], cancellation_refund_bps: 10000,
  },
};

beforeAll(async () => {
  await resetAuthTables();
  orgId = (await makeOrg('notices')).id;
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-notices-'));
  writeFileSync(join(dir, 'event.json'), JSON.stringify(EVENT));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\nC-a,Ada Example,a@example.test\nC-b,Bo Example,b@example.test\n');
  eventId = (await loadFixtureEvent(orgId, dir)).eventId;
});

describe('notices (D-33)', () => {
  it('queues one confirmation per order and one notice per offer, and the drain sends neither', async () => {
    expect((await cast({ cmd_id: 'K-1', at: '2026-12-02T10:00:00', kind: 'HOLD', customer: 'C-a', ref: 'H-1', tier_id: 'ADV', qty: 1 })).code).toBe('HELD');
    expect((await cast({ cmd_id: 'K-2', at: '2026-12-02T10:01:00', kind: 'PAY_START', customer: 'C-a', ref: 'H-1', payment_id: 'pi_n1' })).code).toBe('PAYING');
    expect((await cast({ cmd_id: 'K-3', at: '2026-12-02T10:02:00', kind: 'PAY_SUCCEEDED', payment_id: 'pi_n1' })).code).toBe('CONFIRMED');
    expect((await cast({ cmd_id: 'K-4', at: '2026-12-02T10:03:00', kind: 'HOLD', customer: 'C-a', ref: 'H-2', tier_id: 'ADV', qty: 1 })).code).toBe('HELD');
    expect((await cast({ cmd_id: 'K-5', at: '2026-12-02T10:04:00', kind: 'WAITLIST_JOIN', customer: 'C-b', target: 'ADV', qty: 1 })).status).toBe('OK');
    expect(await db.outbox.count()).toBe(1); // a hold and a join notify no one
    expect((await cast({ cmd_id: 'K-6', at: '2026-12-02T10:05:00', kind: 'RELEASE', customer: 'C-a', ref: 'H-2' })).code).toBe('RELEASED');

    const rows = await db.outbox.findMany({ orderBy: { template: 'asc' } });
    expect(rows.map((r) => [r.template, r.to, r.attempts, r.sentAt, r.lastError])).toEqual([
      ['turnstile.offer', 'b@example.test', MAX_ATTEMPTS, null, HELD_NOTE],
      ['turnstile.order_confirmed', 'a@example.test', MAX_ATTEMPTS, null, HELD_NOTE],
    ]);
    expect(rows[1]!.data).toMatchObject({ qty: '1', tier: 'ADV', total: '$38.49', name: 'Ada Example' });
    expect(rows[0]!.data).toMatchObject({ target: 'ADV', expires_at: '2026-12-02T11:05:00' });

    expect(await drainOutbox()).toEqual({ sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await db.outbox.count({ where: { sentAt: { not: null } } })).toBe(0);
  });

  it('a replayed cmd_id queues nothing twice', async () => {
    await cast({ cmd_id: 'K-3', at: '2026-12-02T10:02:00', kind: 'PAY_SUCCEEDED', payment_id: 'pi_n1' });
    expect(await db.outbox.count()).toBe(2);
  });
});
