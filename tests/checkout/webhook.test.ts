// Task 2.5 (D-5, D-23, D-30): the signature scheme against the fixture secret (valid, tampered body, stale t,
// malformed, replayed event.id), PAY_START only after Stripe returns, PAID_AFTER_TIMEOUT issuing the refund call,
// REFUND_REQUEST → refunds.create with the refund id as idempotency key, PENDING_PROVIDER retried, and the route.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db';
import { castCommand } from '@/checkout/cast';
import { applyWebhook, payStart, requestRefund, settleRefunds } from '@/checkout/checkout';
import { axisNow } from '@/checkout/clock';
import { loadFixtureEvent } from '@/checkout/load';
import { StripeProviderError, StripeRecorded } from '@/checkout/stripe';
import { SIGNATURE_TOLERANCE_SECONDS, signStripePayload, verifyStripeSignature, webhookCommand } from '@/checkout/webhook';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const FX = JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string; events: Record<string, { id: string; type: string; data: { object: { id: string; metadata: Record<string, string> } } }> };
const SECRET = FX.secret;
const NOW = 1764604900; // seconds; the fixture events are created at 1764604860 / 1764604920

let orgId = '';
let eventId = '';
const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });
const BASE = JSON.parse(readFileSync('fixtures/event.json', 'utf8')) as Record<string, unknown>;
const body = (name: 'succeeded' | 'failed', over: { id?: string; pi?: string } = {}) => {
  const ev = structuredClone(FX.events[name]!);
  if (over.id) ev.id = over.id;
  if (over.pi) ev.data.object.id = over.pi;
  ev.data.object.metadata = { ...ev.data.object.metadata, org_id: orgId, event_id: eventId };
  return JSON.stringify(ev);
};
const hook = (rawBody: string, at: string, stripe: StripeRecorded, header = signStripePayload(rawBody, SECRET, NOW), nowSeconds = NOW) =>
  applyWebhook({ orgId, eventId, rawBody, header, secret: SECRET, nowSeconds, at: timestamp(at, 'at'), stripe });

beforeAll(async () => {
  await resetAuthTables();
  orgId = (await makeOrg('hook')).id;
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-hook-'));
  // the fixture event with a 10-seat floor so the money stays small; same rules (hold 10 min, pay timeout 30 min, fee 350)
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ ...BASE, pools: [{ pool_id: 'FLOOR', kind: 'GA', capacity: 10 }, { pool_id: 'BALCONY', kind: 'RESERVED', capacity: 216 }] }));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\n');
  eventId = (await loadFixtureEvent(orgId, dir)).eventId;
});

describe('verifyStripeSignature (pure, nowSeconds is a parameter)', () => {
  const raw = '{"id":"evt_x","type":"payment_intent.succeeded","data":{"object":{"id":"pi_x"}}}';
  it('accepts a valid header, any of several v1 values', () => {
    const h = signStripePayload(raw, SECRET, NOW);
    expect(verifyStripeSignature(raw, h, SECRET, NOW)).toEqual({ ok: true, t: NOW });
    expect(verifyStripeSignature(raw, `${h},v1=deadbeef`, SECRET, NOW + SIGNATURE_TOLERANCE_SECONDS)).toEqual({ ok: true, t: NOW });
  });
  it('refuses a tampered body, a wrong secret, a stale t (301 s either way), a missing or malformed header', () => {
    const h = signStripePayload(raw, SECRET, NOW);
    expect(verifyStripeSignature(raw.replace('pi_x', 'pi_y'), h, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyStripeSignature(raw, h, 'other', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyStripeSignature(raw, h, SECRET, NOW + 301)).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifyStripeSignature(raw, h, SECRET, NOW - 301)).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifyStripeSignature(raw, null, SECRET, NOW)).toEqual({ ok: false, reason: 'missing_header' });
    expect(verifyStripeSignature(raw, 'v1=abc', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' });
    expect(verifyStripeSignature(raw, `t=${NOW}`, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' });
  });
  it('maps the two event types to commands with cmd_id = event.id, ignores the rest', () => {
    const at = timestamp('2026-12-01T10:30:00', 'at');
    expect(webhookCommand(JSON.parse(body('succeeded')), at)).toMatchObject({ cmd_id: 'evt_fixture_succeeded_00001', kind: 'PAY_SUCCEEDED', payment_id: 'pi_fixture_00001' });
    expect(webhookCommand(JSON.parse(body('failed')), at)).toMatchObject({ kind: 'PAY_FAILED' });
    expect(webhookCommand({ id: 'evt_z', type: 'charge.refunded', data: { object: { id: 'ch_1' } } }, at)).toBeNull();
  });
});

describe('checkout over the cast path with StripeRecorded', () => {
  const stripe = new StripeRecorded({ paymentIntents: { 'H-00002': 'pi_fixture_00001' } });

  it('PAY_START: PaymentIntent created with idempotency key = hold id, amount from the engine, PAYING only after it returns', async () => {
    expect((await castCommand(orgId, eventId, cmd({ cmd_id: 'K-1', at: '2026-12-01T10:00:00', kind: 'HOLD', customer: 'C-0002', ref: 'H-00002', tier_id: 'EARLY', qty: 2 }))).code).toBe('HELD');
    const r = await payStart(orgId, eventId, cmd({ cmd_id: 'K-2', at: '2026-12-01T10:01:00', kind: 'PAY_START', customer: 'C-0002', ref: 'H-00002' }), stripe);
    expect(r).toMatchObject({ code: 'PAYING', detail: 'pi_fixture_00001 5700' });
    expect(stripe.calls).toEqual([{ kind: 'paymentIntent', holdId: 'H-00002', amountCents: 5700, currency: 'USD', customer: 'C-0002', orgId, eventId }]);
    expect(await db.payment.findUniqueOrThrow({ where: { eventId_paymentId: { eventId, paymentId: 'pi_fixture_00001' } } })).toMatchObject({ holdId: 'H-00002', amountCents: 5700, state: 'PENDING' });
  });
  it('PAY_START on a hold that is not yours is cast and rejected without a Stripe call', async () => {
    const n = stripe.calls.length;
    expect((await payStart(orgId, eventId, cmd({ cmd_id: 'K-3', at: '2026-12-01T10:01:30', kind: 'PAY_START', customer: 'C-0009', ref: 'H-00002' }), stripe)).code).toBe('HOLD_NOT_YOURS');
    expect(stripe.calls.length).toBe(n);
  });
  it('webhook: a tampered body is 400 and casts nothing; a stale timestamp is 400', async () => {
    const raw = body('succeeded');
    const h = signStripePayload(raw, SECRET, NOW);
    expect(await hook(raw.replace('"amount":5700', '"amount":1'), '2026-12-01T10:02:00', stripe, h)).toEqual({ status: 400, reason: 'bad_signature' });
    expect(await hook(raw, '2026-12-01T10:02:00', stripe, h, NOW + 1000)).toEqual({ status: 400, reason: 'stale_timestamp' });
    expect(await db.commandLog.count({ where: { eventId, kind: 'PAY_SUCCEEDED' } })).toBe(0);
  });
  it('webhook after the payment timeout: PAID_AFTER_TIMEOUT, no tickets, and the refund call is issued automatically', async () => {
    // pay started 10:01, timeout 30 min → 10:31:00 is PAY_TIMEOUT; the success lands at 10:32
    const out = await hook(body('succeeded'), '2026-12-01T10:32:00', stripe);
    expect(out.status).toBe(200);
    expect(out.result).toMatchObject({ cmd_id: 'evt_fixture_succeeded_00001', code: 'PAID_AFTER_TIMEOUT', detail: 'R-00001 5700' });
    expect(await db.ticket.count({ where: { eventId } })).toBe(0);
    expect(stripe.calls.at(-1)).toEqual({ kind: 'refund', refundId: 'R-00001', paymentIntentId: 'pi_fixture_00001', amountCents: 5700, eventId });
    expect((await db.refund.findUniqueOrThrow({ where: { eventId_refundId: { eventId, refundId: 'R-00001' } } })).stripeRefundId).toBe('re_rec_R-00001');
    expect((await db.commandLog.findUniqueOrThrow({ where: { eventId_cmdId: { eventId, cmdId: 'evt_fixture_succeeded_00001' } } })).stripeEventId).toBe('evt_fixture_succeeded_00001');
  });
  it('a replayed event.id returns the stored result and casts nothing again; a new event for the settled payment is PAYMENT_DUPLICATE', async () => {
    const n = stripe.calls.length;
    const logs = await db.commandLog.count({ where: { eventId } });
    const again = await hook(body('succeeded'), '2026-12-01T10:33:00', stripe);
    expect(again.result?.code).toBe('PAID_AFTER_TIMEOUT');
    expect(await db.commandLog.count({ where: { eventId } })).toBe(logs);
    const fresh = await hook(body('failed', { id: 'evt_fixture_failed_00002' }), '2026-12-01T10:34:00', stripe);
    expect(fresh.result?.code).toBe('PAYMENT_DUPLICATE');
    expect(stripe.calls.length).toBe(n);
  });
  it('REFUND_REQUEST: the engine decides, then refunds.create with the refund id; a provider failure leaves PENDING_PROVIDER and the retry settles it', async () => {
    expect((await castCommand(orgId, eventId, cmd({ cmd_id: 'K-10', at: '2026-12-01T11:00:00', kind: 'HOLD', customer: 'C-0003', ref: 'H-00003', tier_id: 'ADV', qty: 2 }))).code).toBe('HELD');
    expect((await payStart(orgId, eventId, cmd({ cmd_id: 'K-11', at: '2026-12-01T11:01:00', kind: 'PAY_START', customer: 'C-0003', ref: 'H-00003' }), stripe)).detail).toBe('pi_rec_H-00003 7698');
    const ok = await hook(body('succeeded', { id: 'evt_ok_3', pi: 'pi_rec_H-00003' }), '2026-12-01T11:02:00', stripe);
    expect(ok.result).toMatchObject({ code: 'CONFIRMED', detail: 'ORD-00001 T-00001 T-00002' });
    stripe.failRefundOnce.add('R-00002');
    const r = await requestRefund(orgId, eventId, cmd({ cmd_id: 'K-12', at: '2026-12-01T11:03:00', kind: 'REFUND_REQUEST', customer: 'C-0003', ref: 'ORD-00001', tickets: ['T-00001', 'T-00002'] }), stripe);
    expect(r).toMatchObject({ code: 'REFUNDED', detail: 'R-00002 R-00003 7698 bps=10000 days=109' });
    const rows = () => db.refund.findMany({ where: { eventId, refundId: { in: ['R-00002', 'R-00003'] } }, orderBy: { refundId: 'asc' }, select: { refundId: true, stripeRefundId: true } });
    expect(await rows()).toEqual([{ refundId: 'R-00002', stripeRefundId: null }, { refundId: 'R-00003', stripeRefundId: 're_rec_R-00003' }]);
    expect(await settleRefunds(orgId, eventId, stripe)).toEqual({ settled: 1, pending: 0 });
    expect(await rows()).toEqual([{ refundId: 'R-00002', stripeRefundId: 're_rec_R-00002' }, { refundId: 'R-00003', stripeRefundId: 're_rec_R-00003' }]);
    expect(stripe.calls.filter((c) => c.kind === 'refund' && c.refundId === 'R-00002')).toHaveLength(2);
  });
  it('a declined card releases the hold and cancels its PaymentIntent; a later success for it seats no one (D-56, review CODE-2)', async () => {
    expect((await castCommand(orgId, eventId, cmd({ cmd_id: 'K-20', at: '2026-12-01T12:00:00', kind: 'HOLD', customer: 'C-0004', ref: 'H-00004', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    expect((await payStart(orgId, eventId, cmd({ cmd_id: 'K-21', at: '2026-12-01T12:01:00', kind: 'PAY_START', customer: 'C-0004', ref: 'H-00004' }), stripe)).code).toBe('PAYING');
    const orders = await db.order.count({ where: { eventId } });
    const failed = await hook(body('failed', { id: 'evt_fail_4', pi: 'pi_rec_H-00004' }), '2026-12-01T12:02:00', stripe);
    expect(failed.result?.code).toBe('PAYMENT_FAILED_RELEASED');
    expect(stripe.calls.at(-1)).toEqual({ kind: 'cancel', eventId, paymentIntentId: 'pi_rec_H-00004' });
    const late = await hook(body('succeeded', { id: 'evt_ok_4', pi: 'pi_rec_H-00004' }), '2026-12-01T12:03:00', stripe);
    expect(late.result?.code).toBe('PAYMENT_DUPLICATE');
    expect(await db.order.count({ where: { eventId } })).toBe(orders);
    // non-negotiable 4 at the boundary (D-58): the money that landed on the released hold goes back in full
    expect(late.status).toBe(200);
    expect(stripe.calls.at(-1)).toEqual({ kind: 'refund', refundId: 'paid-after-failed:pi_rec_H-00004', paymentIntentId: 'pi_rec_H-00004', amountCents: 3849, eventId });
    expect(await db.ticket.count({ where: { eventId, orderId: { notIn: ['ORD-00001'] } } })).toBe(0);
  });
  it('paid after failed: a redelivered success sends the same refund again (same key); a second success for a payment that was seated or already refunded by the engine sends none (D-58)', async () => {
    const refunds = () => stripe.calls.filter((c) => c.kind === 'refund').length;
    const n = refunds();
    expect((await hook(body('succeeded', { id: 'evt_ok_4', pi: 'pi_rec_H-00004' }), '2026-12-01T12:04:00', stripe)).result?.code).toBe('PAYMENT_DUPLICATE');
    expect(refunds()).toBe(n + 1);
    expect(stripe.calls.at(-1)).toMatchObject({ kind: 'refund', refundId: 'paid-after-failed:pi_rec_H-00004' });
    // pi_rec_H-00003 was CONFIRMED (SUCCEEDED) and pi_fixture_00001 was PAID_AFTER_TIMEOUT (SUCCEEDED_LATE, refunded as R-00001): neither is refunded here
    expect((await hook(body('succeeded', { id: 'evt_ok_3b', pi: 'pi_rec_H-00003' }), '2026-12-01T12:05:00', stripe)).result?.code).toBe('PAYMENT_DUPLICATE');
    expect((await hook(body('succeeded', { id: 'evt_ok_1b' }), '2026-12-01T12:06:00', stripe)).result?.code).toBe('PAYMENT_DUPLICATE');
    expect(refunds()).toBe(n + 1);
  });
  it('a Stripe failure while cancelling is logged, not thrown: the release has committed', async () => {
    expect((await castCommand(orgId, eventId, cmd({ cmd_id: 'K-30', at: '2026-12-01T12:10:00', kind: 'HOLD', customer: 'C-0005', ref: 'H-00005', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    expect((await payStart(orgId, eventId, cmd({ cmd_id: 'K-31', at: '2026-12-01T12:11:00', kind: 'PAY_START', customer: 'C-0005', ref: 'H-00005' }), stripe)).code).toBe('PAYING');
    const broken = new StripeRecorded();
    broken.cancelPaymentIntent = async () => { throw new StripeProviderError('stripe down'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await hook(body('failed', { id: 'evt_fail_5', pi: 'pi_rec_H-00005' }), '2026-12-01T12:12:00', broken);
    expect(out.result?.code).toBe('PAYMENT_FAILED_RELEASED');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('could not cancel pi_rec_H-00005'));
    err.mockRestore();
  });
  it('paid after failed: when Stripe does not take the refund the webhook answers 503, so Stripe delivers it again, and the next delivery refunds (D-58)', async () => {
    expect((await castCommand(orgId, eventId, cmd({ cmd_id: 'K-40', at: '2026-12-01T12:20:00', kind: 'HOLD', customer: 'C-0006', ref: 'H-00006', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    expect((await payStart(orgId, eventId, cmd({ cmd_id: 'K-41', at: '2026-12-01T12:21:00', kind: 'PAY_START', customer: 'C-0006', ref: 'H-00006' }), stripe)).code).toBe('PAYING');
    expect((await hook(body('failed', { id: 'evt_fail_6', pi: 'pi_rec_H-00006' }), '2026-12-01T12:22:00', stripe)).result?.code).toBe('PAYMENT_FAILED_RELEASED');
    stripe.failRefundOnce.add('paid-after-failed:pi_rec_H-00006');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await hook(body('succeeded', { id: 'evt_ok_6', pi: 'pi_rec_H-00006' }), '2026-12-01T12:23:00', stripe);
    expect(first).toMatchObject({ status: 503, result: { code: 'PAYMENT_DUPLICATE' } });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('pi_rec_H-00006 was paid after its payment failed and is NOT refunded yet'));
    err.mockRestore();
    const again = await hook(body('succeeded', { id: 'evt_ok_6', pi: 'pi_rec_H-00006' }), '2026-12-01T12:24:00', stripe);
    expect(again).toMatchObject({ status: 200, result: { code: 'PAYMENT_DUPLICATE' } });
    expect(stripe.calls.filter((c) => c.kind === 'refund' && c.refundId === 'paid-after-failed:pi_rec_H-00006')).toHaveLength(2);
    expect(await db.order.count({ where: { eventId, holdId: 'H-00006' } })).toBe(0);
  });
});

describe('the route', () => {
  it('503 without a webhook secret; the signature first: 400 for a bad one whether or not the event exists; a signed event not for this database is 200 ignored', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const { POST } = await import('@/app/api/checkout/webhook/route');
    const { env } = await import('@/core/env');
    const post = (raw: string, sig: string) => POST(new Request('http://localhost/api/checkout/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': sig } }));
    const saved = env.STRIPE_WEBHOOK_SECRET;
    (env as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = undefined;
    expect((await post(body('succeeded'), 'x')).status).toBe(503);
    (env as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = SECRET;
    const unknown = body('succeeded').replace(eventId, '00000000-0000-0000-0000-000000000000');
    const now = Math.floor(Date.now() / 1000);
    // unsigned or wrongly signed: the same 400 whether the event exists or not, so the answer says nothing about the database
    expect((await post(unknown, 'x')).status).toBe(400);
    expect((await post(body('succeeded'), 'x')).status).toBe(400);
    expect((await post(body('succeeded'), signStripePayload(body('succeeded'), 'wrong', now))).status).toBe(400);
    // signed, but not for an event here (unknown id, no id, not a UUID): 200 ignored, so Stripe neither retries nor disables the endpoint
    const signed = async (raw: string) => post(raw, signStripePayload(raw, SECRET, now));
    const noId = JSON.stringify({ id: 'evt_noid', type: 'payment_intent.succeeded', data: { object: { id: 'pi_other', metadata: {} } } });
    const badId = body('succeeded').replace(eventId, 'not-a-uuid');
    for (const raw of [unknown, noId, badId]) {
      const res = await signed(raw);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/^ignored: /);
    }
    (env as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = saved;
    vi.unstubAllEnvs();
  });
  it('axisNow labels an instant in the event\'s zone, on the axis', () => {
    expect(axisNow(new Date('2027-03-21T01:00:00Z'), 'America/Chicago')).toBe('2027-03-20T20:00:00');
    expect(axisNow(new Date('2026-12-01T16:00:00Z'), 'America/Chicago')).toBe('2026-12-01T10:00:00');
  });
});
