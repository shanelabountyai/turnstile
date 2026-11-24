// PRD-3 item 11 (review CODE-4 cases 1, 3, 5; CODE-7; CODE-11): Pay fails soft. A Stripe error on Pay leaves the hold
// HELD and comes back as words on the form; a clientSecret failure costs one hold its card form, not the page; payStart
// runs the command on the engine in memory before it calls Stripe, so a hold that has expired by the event clock (but
// is still stored HELD, because nothing has been cast since) creates no PaymentIntent; and a Production deployment with
// no STRIPE_SECRET_KEY refuses to build a gateway instead of quietly answering from the recorded double.
// Stripe here is StripeRecorded or a stand-in object (D-30): nothing in this file reaches Stripe.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { castCommand } from '@/checkout/cast';
import { PayStartError, payStart } from '@/checkout/checkout';
import { loadFixtureEvent } from '@/checkout/load';
import { payForms } from '@/checkout/pay-form';
import { PAY_NOT_STARTED } from '@/checkout/prd3-wording';
import { StripeLive, StripeNotConfigured, StripeProviderError, StripeRecorded, stripeGateway, type StripeGateway } from '@/checkout/stripe';
import { db } from '@/core/db';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// The Buy action builds its gateway with stripeGateway(); a test swaps in its own factory for one call.
const gateway = vi.hoisted(() => ({ current: null as null | (() => unknown) }));
vi.mock('@/checkout/stripe', async (orig) => {
  const real = await orig<typeof import('@/checkout/stripe')>();
  return { ...real, stripeGateway: (...a: Parameters<typeof real.stripeGateway>) => (gateway.current ? gateway.current() : real.stripeGateway(...a)) };
});

let org = { id: '', slug: '' };
let eventId = '';
let member = '';
const EVENT = 'EV-SYNTH-001';
const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });
const hold = (holdId: string) => db.hold.findUniqueOrThrow({ where: { eventId_holdId: { eventId, holdId } }, select: { state: true, paymentId: true } });
const logged = (cmdId: string) => db.commandLog.findUnique({ where: { eventId_cmdId: { eventId, cmdId } }, select: { code: true, status: true } });

/** A gateway whose PaymentIntent call fails the way StripeLive reports any Stripe failure. */
class Failing extends StripeRecorded {
  override async createPaymentIntent(a: Parameters<StripeRecorded['createPaymentIntent']>[0]): Promise<{ id: string }> {
    this.calls.push({ kind: 'paymentIntent', ...a });
    throw new StripeProviderError('Stripe StripeAPIError status=500 on PaymentIntent for a hold');
  }
}

beforeAll(async () => {
  await resetAuthTables();
  org = await makeOrg('paysoft');
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-paysoft-'));
  writeFileSync(join(dir, 'event.json'), readFileSync('fixtures/event.json', 'utf8'));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\nC-0001,One,one@example.test\n');
  eventId = (await loadFixtureEvent(org.id, dir)).eventId;
  member = (await addMember(org.id, 'member', 'member@example.test')).id;
});
afterEach(() => { gateway.current = null; });

describe('payStart (PRD-3 item 11)', () => {
  it('a createPaymentIntent failure leaves the hold HELD, casts nothing, and is a PayStartError, not a raw Stripe error', async () => {
    expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'S-1', at: '2026-12-01T10:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-SOFT1', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    const stripe = new Failing();
    const err = await payStart(org.id, eventId, cmd({ cmd_id: 'S-2', at: '2026-12-01T10:01:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-SOFT1' }), stripe).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayStartError);
    expect((err as PayStartError).kind).toBe('stripe');
    expect(stripe.calls).toHaveLength(1);
    expect(await hold('H-SOFT1')).toEqual({ state: 'HELD', paymentId: null });
    expect(await logged('S-2')).toBeNull(); // no PAY_START was recorded: the customer can press Pay again
    expect(await db.payment.count({ where: { eventId } })).toBe(0);
  });

  it('the same hold can then be paid: the retry is a fresh command and reaches PAYING', async () => {
    const stripe = new StripeRecorded();
    expect(await payStart(org.id, eventId, cmd({ cmd_id: 'S-3', at: '2026-12-01T10:02:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-SOFT1' }), stripe)).toMatchObject({ code: 'PAYING', detail: 'pi_rec_H-SOFT1 3849' });
    expect(stripe.calls).toEqual([{ kind: 'paymentIntent', holdId: 'H-SOFT1', amountCents: 3849, currency: 'USD', customer: 'C-0001', orgId: org.id, eventId }]);
  });

  it('a stored-HELD hold that has expired by the event clock calls no Stripe method and is recorded as HOLD_EXPIRED', async () => {
    expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'S-4', at: '2026-12-01T11:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-SOFT2', tier_id: 'ADV', qty: 2 }))).code).toBe('HELD');
    expect((await hold('H-SOFT2')).state).toBe('HELD'); // 10-minute hold; nothing is cast before 11:30, so the row still says HELD
    const stripe = new StripeRecorded();
    const r = await payStart(org.id, eventId, cmd({ cmd_id: 'S-5', at: '2026-12-01T11:30:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-SOFT2' }), stripe);
    expect(r).toMatchObject({ status: 'REJECT', code: 'HOLD_EXPIRED' });
    expect(stripe.calls).toEqual([]);
    expect(await logged('S-5')).toEqual({ status: 'REJECT', code: 'HOLD_EXPIRED' }); // a rejected command is still recorded (non-negotiable 5)
    expect((await hold('H-SOFT2')).state).toBe('EXPIRED');
  });

  it('the inclusive expiry second is already too late: no Stripe call at expires_at itself', async () => {
    expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'S-6', at: '2026-12-01T12:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-SOFT3', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    const stripe = new StripeRecorded();
    expect((await payStart(org.id, eventId, cmd({ cmd_id: 'S-7', at: '2026-12-01T12:10:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-SOFT3' }), stripe)).code).toBe('HOLD_EXPIRED');
    expect(stripe.calls).toEqual([]);
  });

  it('the amount sent to Stripe is the engine\'s own, taken from the in-memory preview before the cast', async () => {
    expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'S-8', at: '2026-12-01T13:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-SOFT4', tier_id: 'ADV', qty: 3 }))).code).toBe('HELD');
    const stripe = new StripeRecorded();
    const r = await payStart(org.id, eventId, cmd({ cmd_id: 'S-9', at: '2026-12-01T13:01:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-SOFT4' }), stripe);
    expect(r.detail).toBe('pi_rec_H-SOFT4 11547'); // 3 × (3,499 + 350) ¢
    expect(stripe.calls.map((c) => c.kind === 'paymentIntent' && c.amountCents)).toEqual([11547]);
  });
});

describe('the Pay action on the Buy screen (PRD-3 item 11)', () => {
  it('returns the inline sentence when Stripe fails, with no redirect, and the hold stays HELD', async () => {
    const { payHold } = await import('@/app/o/[org]/events/[event]/buy/actions');
    expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'S-10', at: '2026-12-01T14:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-SOFT5', tier_id: 'ADV', qty: 1 }))).code).toBe('HELD');
    // the action stamps on the event clock, which reads no earlier than the log's last command (14:00:00): inside the hold
    gateway.current = () => new Failing();
    await signInAs(member, { mfa: true });
    expect(await payHold(org.slug, { event: EVENT, customer: 'C-0001', hold: 'H-SOFT5' })).toEqual({ error: PAY_NOT_STARTED });
    expect(await hold('H-SOFT5')).toEqual({ state: 'HELD', paymentId: null });
    expect(PAY_NOT_STARTED).not.toMatch(/stripe\s+(api|error)|status=|request=/i); // words for a customer, no provider detail
  });

  it('returns the same sentence when the gateway cannot be built at all (Production with no key)', async () => {
    const { payHold } = await import('@/app/o/[org]/events/[event]/buy/actions');
    gateway.current = () => { throw new StripeNotConfigured(); };
    await signInAs(member, { mfa: true });
    expect(await payHold(org.slug, { event: EVENT, customer: 'C-0001', hold: 'H-SOFT5' })).toEqual({ error: PAY_NOT_STARTED });
    expect(await hold('H-SOFT5')).toEqual({ state: 'HELD', paymentId: null });
  });
});

describe('stripeGateway (PRD-3 item 11, review CODE-7)', () => {
  it('on VERCEL_ENV=production with no STRIPE_SECRET_KEY it throws instead of falling back to the recorded double', () => {
    expect(() => stripeGateway({ VERCEL_ENV: 'production' })).toThrow(StripeNotConfigured);
    expect(() => stripeGateway({ VERCEL_ENV: 'production', STRIPE_SECRET_KEY: '' })).toThrow(StripeNotConfigured);
    // it is a provider failure to every caller that already leaves a refund pending or logs a cancel (D-56)
    expect(new StripeNotConfigured()).toBeInstanceOf(StripeProviderError);
    expect(new StripeNotConfigured().message).toContain('STRIPE_SECRET_KEY');
  });
  it('off Production with no key it is still the recorded double (tests, CI, a laptop, a Preview build)', () => {
    expect(stripeGateway({})).toBeInstanceOf(StripeRecorded);
    expect(stripeGateway({ VERCEL_ENV: 'preview' })).toBeInstanceOf(StripeRecorded);
  });
  it('with a key it is StripeLive, on Production or off', () => {
    expect(stripeGateway({ VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'not-a-real-key' })).toBeInstanceOf(StripeLive);
    expect(stripeGateway({ STRIPE_SECRET_KEY: 'not-a-real-key' })).toBeInstanceOf(StripeLive);
  });
});

describe('payForms: what each PAYING hold is offered (PRD-3 item 11)', () => {
  const holds = [
    { hold: 'H-A', state: 'PAYING', paymentId: 'pi_a' },
    { hold: 'H-B', state: 'PAYING', paymentId: 'pi_b' },
    { hold: 'H-C', state: 'HELD', paymentId: null },
  ];
  const stub = (secret: (pi: string) => Promise<string | null>): StripeGateway => Object.assign(new StripeRecorded(), { clientSecret: secret });

  it('a clientSecret failure affects only that hold: the other hold still gets its card form', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forms = await payForms(holds, true, () => stub(async (pi) => { if (pi === 'pi_a') throw new Error('Stripe is down for this one'); return `${pi}_secret`; }));
    expect(forms.get('H-A')).toEqual({ kind: 'unavailable' });
    expect(forms.get('H-B')).toEqual({ kind: 'card', clientSecret: 'pi_b_secret' });
    expect(forms.has('H-C')).toBe(false); // a HELD hold has no PaymentIntent yet
    expect(errors.mock.calls.flat().join(' ')).toContain('pi_a');
    expect(errors.mock.calls.flat().join(' ')).not.toContain('Stripe is down for this one'); // the provider's text stays out of the log (D-59)
    errors.mockRestore();
  });
  it('a gateway that cannot be built costs every PAYING hold its form, and still renders', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forms = await payForms(holds, true, () => { throw new StripeNotConfigured(); });
    expect([...forms]).toEqual([['H-A', { kind: 'unavailable' }], ['H-B', { kind: 'unavailable' }]]);
    errors.mockRestore();
  });
  it('with no publishable key Stripe is never asked: every PAYING hold is the recorded case', async () => {
    let asked = 0;
    const forms = await payForms(holds, false, () => { asked++; return new StripeRecorded(); });
    expect([...forms]).toEqual([['H-A', { kind: 'recorded' }], ['H-B', { kind: 'recorded' }]]);
    expect(asked).toBe(0);
  });
  it('a PaymentIntent that can no longer take a card (null secret) is closed, as before (D-58)', async () => {
    const forms = await payForms(holds, true, () => stub(async () => null));
    expect(forms.get('H-A')).toEqual({ kind: 'closed' });
  });
});

it('StripeLive wraps a createPaymentIntent failure like every other Stripe call (no raw Stripe error, no message text)', async () => {
  const Stripe = (await import('stripe')).default;
  const live = new StripeLive(undefined, {
    paymentIntents: { create: async () => { throw new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'secret detail sk_live_like_text' } as never); } },
    refunds: {},
  } as never);
  const err = await live.createPaymentIntent({ holdId: 'H-1', amountCents: 100, currency: 'USD', customer: 'C-0001', orgId: 'o', eventId: 'e' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(StripeProviderError);
  expect((err as Error).message).not.toContain('secret detail');
});
