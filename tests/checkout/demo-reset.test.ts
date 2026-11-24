// D-60: the nightly reset of the demo orgs, run from the clone cron (src/app/cron-jobs.ts) and only in demo mode.
// It truncates the Turnstile tables (the one written exception to D-21's append-only rule, scoped to DEMO_MODE),
// re-loads the fixture event into both demo orgs with the event clock at sales open whatever the wall date, and
// cancels open PaymentIntents through the gateway first.
//
// What these tests prove, as the brief asks: (1) without demo mode it does nothing; (2) it touches only the Turnstile
// tables; (3) it leaves exactly the state a fresh seed leaves. Plus the two refusals that keep money safe: it does not
// wipe while a PaymentIntent could not be cancelled, or while a refund is still unconfirmed by Stripe.
// Stripe is StripeRecorded (D-30). Nothing here reaches Stripe, and nothing here ran on Vercel or Neon.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { castCommand } from '@/checkout/cast';
import { payStart } from '@/checkout/checkout';
import { eventNow } from '@/checkout/clock';
import { DEMO_ORGS } from '@/checkout/demo';
import { resetDemo, TURNSTILE_TABLES } from '@/checkout/demo-reset';
import { loadFixtureEvent } from '@/checkout/load';
import { StripeNotConfigured, StripeProviderError, StripeRecorded } from '@/checkout/stripe';
import { dbSystem as db } from '@/core/db/system'; // fixtures and snapshots run as the owner role
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { seedHosted } from '../../scripts/seed-hosted';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const WALL = new Date('2026-11-24T12:00:00Z'); // before sales open (2026-12-01T10:00:00 in the event's zone)
const AFTER_OPEN = new Date('2027-01-15T18:00:00Z'); // the wall clock is inside the sales window
const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });

const tables = async () => (await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).map((t) => t.tablename);
/** A content fingerprint per table: row count and a hash of every row. */
async function fingerprint(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const [r] = await db.$queryRawUnsafe<{ n: bigint; h: string }[]>(`SELECT count(*) AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${n}" t`);
    out[n] = `${r!.n}:${r!.h}`;
  }
  return out;
}
/**
 * Everything in the Turnstile tables, with what a reload legitimately changes taken out: the event's new UUID (and so
 * every eventId) and createdAt. Orgs are named by slug. Two databases in the same demo state give the same snapshot.
 */
async function turnstileState(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const n of TURNSTILE_TABLES) {
    out[n] = (await db.$queryRawUnsafe<{ row: unknown }[]>(
      `SELECT (to_jsonb(t) - 'id' - 'eventId' - 'createdAt' - 'orgId') || jsonb_build_object('org', o.slug) AS row FROM "${n}" t JOIN "Org" o ON o.id = t."orgId" ORDER BY 1`,
    )).map((r) => r.row);
  }
  return out;
}
const events = () => db.event.findMany({ orderBy: { org: { slug: 'asc' } }, select: { id: true, orgId: true, timezoneLabel: true, salesOpenAt: true, clockOffsetSeconds: true, org: { select: { slug: true } } } });
const acme = async () => (await events()).find((e) => e.org.slug === 'acme')!;

/** A sale, a refund Stripe confirmed, a hold left PAYING, a clock moved to show night and a door scan: a used demo org. */
async function useUp(orgId: string, eventId: string, stripe: StripeRecorded) {
  const c = (x: Parameters<typeof cmd>[0]) => castCommand(orgId, eventId, cmd(x));
  expect((await c({ cmd_id: 'D-1', at: '2026-12-01T10:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-D1', tier_id: 'ADV', qty: 2 })).code).toBe('HELD');
  expect((await payStart(orgId, eventId, cmd({ cmd_id: 'D-2', at: '2026-12-01T10:01:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-D1' }), stripe)).code).toBe('PAYING');
  const paid = await c({ cmd_id: 'D-3', at: '2026-12-01T10:02:00', kind: 'PAY_SUCCEEDED', payment_id: 'pi_rec_H-D1' });
  expect(paid.code).toBe('CONFIRMED');
  expect((await c({ cmd_id: 'D-4', at: '2026-12-01T10:03:00', kind: 'HOLD', customer: 'C-0002', ref: 'H-D2', tier_id: 'ADV', qty: 1 })).code).toBe('HELD');
  expect((await payStart(orgId, eventId, cmd({ cmd_id: 'D-5', at: '2026-12-01T10:04:00', kind: 'PAY_START', customer: 'C-0002', ref: 'H-D2' }), stripe)).code).toBe('PAYING'); // left open
  await db.event.update({ where: { id: eventId }, data: { clockOffsetSeconds: 9_999_999 } });
  return paid.detail.split(' ');
}

beforeAll(async () => {
  await resetAuthTables();
});

describe('the table list is the D-60 exception, no more and no less', () => {
  it('is exactly the models of prisma/schema/turnstile.prisma', () => {
    const models = [...readFileSync('prisma/schema/turnstile.prisma', 'utf8').matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
    expect([...TURNSTILE_TABLES].sort()).toEqual(models.sort());
    expect(models).toContain('CommandLog'); // the append-only three D-60 names are in it
    expect(models).toContain('Order');
    expect(models).toContain('Refund');
  });
  it('names no table of the template (core, notifications, sso, apikeys)', () => {
    const others = ['core', 'notifications', 'sso', 'apikeys'].flatMap((f) => [...readFileSync(`prisma/schema/${f}.prisma`, 'utf8').matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!));
    expect(others.length).toBeGreaterThan(10);
    expect(TURNSTILE_TABLES.filter((t) => others.includes(t))).toEqual([]);
  });
});

describe('resetDemo (D-60)', () => {
  let fresh: Record<string, unknown[]> = {};

  it('a fresh seed is the reference state: both demo orgs, nothing sold, the event clock at sales open', async () => {
    await seedHosted('fixtures', WALL);
    fresh = await turnstileState();
    expect(fresh.Event).toHaveLength(2);
    expect(fresh.Seat).toHaveLength(2 * 216);
    expect(fresh.Customer).toHaveLength(2 * 700);
    expect(fresh.CommandLog).toEqual([]);
    for (const e of await events()) expect(eventNow(WALL, e)).toBe(e.salesOpenAt);
  });

  it('without demo mode it does nothing: no table changes, the gateway is never built', async () => {
    const stripe = new StripeRecorded();
    const e = await acme();
    await useUp(e.orgId, e.id, stripe);
    const all = await tables();
    const before = await fingerprint(all);
    const built = vi.fn(() => stripe);
    const calls = stripe.calls.length;
    expect(await resetDemo({ demoMode: false, gateway: built, wall: WALL })).toEqual({ ran: false, why: 'DEMO_MODE is not 1' });
    expect(await fingerprint(all)).toEqual(before);
    expect(built).not.toHaveBeenCalled();
    expect(stripe.calls.length).toBe(calls);
  });

  it('cronJobs runs it with the real setting: this test run is not in demo mode, so the cron leaves everything alone', async () => {
    expect(process.env.DEMO_MODE).toBeUndefined();
    const all = await tables();
    const before = await fingerprint(TURNSTILE_TABLES.slice());
    const { cronJobs } = await import('@/app/cron-jobs');
    expect((await cronJobs()).demoReset).toEqual({ ran: false, why: 'DEMO_MODE is not 1' });
    expect(await fingerprint(TURNSTILE_TABLES.slice())).toEqual(before);
    expect(all).toEqual(expect.arrayContaining([...TURNSTILE_TABLES]));
  });

  it('does not wipe while an open PaymentIntent could not be cancelled, and says so', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = await fingerprint(TURNSTILE_TABLES.slice());
    const refusing = Object.assign(new StripeRecorded(), { cancelPaymentIntent: async () => { throw new StripeProviderError('Stripe StripeAPIError status=500 on cancel'); } });
    expect(await resetDemo({ demoMode: true, gateway: () => refusing, wall: WALL })).toEqual({ ran: false, why: 'open PaymentIntents could not be cancelled', open: 1, cancelled: 0 });
    expect(await resetDemo({ demoMode: true, gateway: () => { throw new StripeNotConfigured(); }, wall: WALL })).toEqual({ ran: false, why: 'open PaymentIntents could not be cancelled', open: 1, cancelled: 0 });
    expect(await fingerprint(TURNSTILE_TABLES.slice())).toEqual(before);
    expect(errors.mock.calls.flat().join('\n')).toContain('pi_rec_H-D2');
    errors.mockRestore();
  });

  it('does not wipe while a refund is unconfirmed by Stripe: the row is the only record that money is owed', async () => {
    const e = await acme();
    const [order, ticket] = (await db.order.findFirstOrThrow({ where: { eventId: e.id }, select: { orderId: true, tickets: true } }).then((o) => [o.orderId, o.tickets[0]!]));
    expect((await castCommand(e.orgId, e.id, cmd({ cmd_id: 'D-6', at: '2026-12-01T10:05:00', kind: 'REFUND_REQUEST', customer: 'C-0001', ref: order!, tickets: [ticket!] }))).code).toBe('REFUNDED'); // cast, not sent
    const before = await fingerprint(TURNSTILE_TABLES.slice());
    const stripe = new StripeRecorded();
    expect(await resetDemo({ demoMode: true, gateway: () => stripe, wall: WALL })).toEqual({ ran: false, why: 'refunds not confirmed by Stripe', unsettled: 1 });
    expect(stripe.calls).toEqual([]); // refused before anything is cancelled
    expect(await fingerprint(TURNSTILE_TABLES.slice())).toEqual(before);
    await db.refund.updateMany({ where: { eventId: e.id, stripeRefundId: null }, data: { stripeRefundId: 're_rec_test' } }); // as the retry job would, once Stripe confirms
  });

  it('in demo mode: cancels the open PaymentIntent, touches only the Turnstile tables, and leaves the same state as a fresh seed', async () => {
    const old = await acme();
    const all = await tables();
    const others = all.filter((t) => !(TURNSTILE_TABLES as readonly string[]).includes(t));
    expect(others.length).toBeGreaterThan(20);
    const before = await fingerprint(others);
    expect(await turnstileState()).not.toEqual(fresh); // it really is used: orders, a refund, a PAYING hold, a moved clock

    const stripe = new StripeRecorded();
    expect(await resetDemo({ demoMode: true, gateway: () => stripe, wall: WALL })).toEqual({ ran: true, cancelled: 1, orgs: [...DEMO_ORGS] });
    expect(stripe.calls).toEqual([{ kind: 'cancel', eventId: old.id, paymentIntentId: 'pi_rec_H-D2' }]); // the paid one (SUCCEEDED) is not touched

    expect(await fingerprint(others)).toEqual(before); // (2) every other table, row for row
    expect(await turnstileState()).toEqual(fresh); // (3) the same state as a fresh seed
    const now = await events();
    expect(now.map((e) => e.org.slug)).toEqual([...DEMO_ORGS]);
    expect(now.map((e) => e.id)).not.toContain(old.id); // new event rows: an old PaymentIntent's metadata points nowhere
    for (const e of now) expect(eventNow(WALL, e)).toBe(e.salesOpenAt);
  });

  it('a second reset of an untouched demo cancels nothing and leaves the same state again', async () => {
    const stripe = new StripeRecorded();
    expect(await resetDemo({ demoMode: true, gateway: () => { stripe.calls.length = 0; return stripe; }, wall: WALL })).toEqual({ ran: true, cancelled: 0, orgs: [...DEMO_ORGS] });
    expect(stripe.calls).toEqual([]);
    expect(await turnstileState()).toEqual(fresh);
  });

  it('whatever the wall date, the event clock is at sales open after a reset (D-60 item 2)', async () => {
    expect(await resetDemo({ demoMode: true, gateway: () => new StripeRecorded(), wall: AFTER_OPEN })).toMatchObject({ ran: true });
    for (const e of await events()) {
      expect(eventNow(AFTER_OPEN, e)).toBe(e.salesOpenAt);
      expect(e.clockOffsetSeconds).toBeLessThan(0); // the wall clock is past sales open, so the offset points back to it
    }
  });

  it('with a demo org missing it does nothing (the seed has not run)', async () => {
    const before = await fingerprint(TURNSTILE_TABLES.slice());
    await db.org.update({ where: { slug: 'globex' }, data: { slug: 'globex-renamed' } });
    expect(await resetDemo({ demoMode: true, gateway: () => new StripeRecorded(), wall: WALL })).toEqual({ ran: false, why: 'an event exists outside the demo orgs' });
    await db.org.update({ where: { slug: 'globex-renamed' }, data: { slug: 'globex' } });
    expect(await fingerprint(TURNSTILE_TABLES.slice())).toEqual(before);
  });

  it('does not wipe a database that holds an event outside the two demo orgs', async () => {
    const other = await makeOrg('not-a-demo-org');
    await loadFixtureEvent(other.id);
    const before = await fingerprint(TURNSTILE_TABLES.slice());
    const stripe = new StripeRecorded();
    expect(await resetDemo({ demoMode: true, gateway: () => stripe, wall: WALL })).toEqual({ ran: false, why: 'an event exists outside the demo orgs' });
    expect(stripe.calls).toEqual([]);
    expect(await fingerprint(TURNSTILE_TABLES.slice())).toEqual(before);
    // no clean-up: Seat rows are never deleted (D-21), so this stays the last test of the block; the next block starts from empty tables
  });
});

describe('the build seed (scripts/seed-hosted.ts) after D-60', () => {
  it('a fresh load while sales are open on the wall clock also starts the event clock at sales open', async () => {
    await resetAuthTables();
    const lines = await seedHosted('fixtures', AFTER_OPEN);
    for (const e of await events()) expect(eventNow(AFTER_OPEN, e)).toBe(e.salesOpenAt);
    expect(lines.filter((l) => l.includes('set to the moment sales open'))).toHaveLength(2);
  });
});

describe('the cron function carries what the reset reads, and nothing it must not (next.config.ts)', () => {
  it('names fixtures/event.json and fixtures/customers.csv for /api/cron, and keeps the answer key and expected_* files out', async () => {
    const cfg = (await import('../../next.config')).default;
    expect(cfg.outputFileTracingIncludes).toEqual({ '/api/cron': ['./fixtures/event.json', './fixtures/customers.csv'] });
    const out = cfg.outputFileTracingExcludes!['/api/cron']!;
    expect(out).toContain('./fixtures/expected_*');
    expect(out).toContain('./fixtures/answer_key.csv');
  });
});
