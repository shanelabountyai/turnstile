// PRD-3 item 10 (review UX-6, suspected): after a successful payment the hold is still PAYING until Stripe's signed
// webhook lands, and in that window the Buy page showed the card form again. Now a PAYING hold whose PaymentIntent is
// `processing` or `succeeded`, or that Stripe has just redirected back with `redirect_status=succeeded`, shows
// "Payment received by Stripe…" and no card form, and the pay button says it is loading until Stripe.js has mounted.
//
// What this proves and what it does not: the recorded gateway reports the status here (D-30), and StripeLive is driven
// through a stand-in client. Nothing reaches Stripe. The live behaviour (what Stripe really returns after its redirect,
// and that Elements mounts) is inferred from code and Stripe's documented statuses; it is the owner's O-8 to observe.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { payForms } from '@/checkout/pay-form';
import { PAY_RECEIVED } from '@/checkout/prd3-wording';
import { StripeLive, StripeRecorded, type StripeClient } from '@/checkout/stripe';

vi.mock('next/script', () => ({ default: () => null })); // Stripe.js is never loaded in a test

const holds = [
  { hold: 'H-A', state: 'PAYING', paymentId: 'pi_a' },
  { hold: 'H-B', state: 'PAYING', paymentId: 'pi_b' },
  { hold: 'H-C', state: 'HELD', paymentId: null },
];

describe('payForms with the recorded gateway reporting the PaymentIntent status (PRD-3 item 10)', () => {
  it.each(['processing', 'succeeded'])('a PAYING hold whose PaymentIntent is %s is "received": no card form', async (status) => {
    const stripe = new StripeRecorded();
    stripe.intentStatus.set('pi_a', status);
    const forms = await payForms(holds, true, () => stripe);
    expect(forms.get('H-A')).toEqual({ kind: 'received' });
    expect(forms.get('H-B')).toEqual({ kind: 'closed' }); // the recorded double has no card form to offer for any other status
  });
  it('the sentence is the PRD\'s', () => {
    expect(PAY_RECEIVED).toBe('Payment received by Stripe; tickets appear when Stripe confirms it.');
  });
  it('a return with redirect_status=succeeded for this PaymentIntent is "received" without asking Stripe; another hold is still asked', async () => {
    const asked: string[] = [];
    const stripe = Object.assign(new StripeRecorded(), { payView: async (pi: string) => { asked.push(pi); return { kind: 'card' as const, clientSecret: `${pi}_secret` }; } });
    const forms = await payForms(holds, true, () => stripe, { paymentIntent: 'pi_a', redirectStatus: 'succeeded' });
    expect(forms.get('H-A')).toEqual({ kind: 'received' });
    expect(forms.get('H-B')).toEqual({ kind: 'card', clientSecret: 'pi_b_secret' });
    expect(asked).toEqual(['pi_b']);
  });
  it('the return applies with recorded Stripe too (no publishable key), which is what the e2e can show', async () => {
    const forms = await payForms(holds, false, () => new StripeRecorded(), { paymentIntent: 'pi_b', redirectStatus: 'succeeded' });
    expect([...forms]).toEqual([['H-A', { kind: 'recorded' }], ['H-B', { kind: 'received' }]]);
  });
  it('any other redirect_status, or a PaymentIntent that is not this hold\'s, changes nothing', async () => {
    const stripe = Object.assign(new StripeRecorded(), { payView: async (pi: string) => ({ kind: 'card' as const, clientSecret: `${pi}_secret` }) });
    for (const returned of [{ paymentIntent: 'pi_a', redirectStatus: 'failed' }, { paymentIntent: 'pi_other', redirectStatus: 'succeeded' }, { redirectStatus: 'succeeded' }, {}]) {
      expect((await payForms(holds, true, () => stripe, returned)).get('H-A')).toEqual({ kind: 'card', clientSecret: 'pi_a_secret' });
    }
  });
});

describe('StripeLive.payView against a stand-in client (no network, no key)', () => {
  const liveWith = (pi: Record<string, unknown>) =>
    new StripeLive(undefined, { paymentIntents: { retrieve: async () => ({ client_secret: 'pi_x_secret_y', last_payment_error: null, ...pi }) }, refunds: {} } as unknown as StripeClient);
  it('processing and succeeded are "received"', async () => {
    for (const status of ['processing', 'succeeded']) expect(await liveWith({ status }).payView('pi_x')).toEqual({ kind: 'received' });
  });
  it('a PaymentIntent that can still take a first card gives the card form', async () => {
    for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) expect(await liveWith({ status }).payView('pi_x')).toEqual({ kind: 'card', clientSecret: 'pi_x_secret_y' });
  });
  it('a refused card or a cancelled PaymentIntent is "closed", never "received" (D-58 unchanged)', async () => {
    expect(await liveWith({ status: 'requires_payment_method', last_payment_error: { type: 'card_error' } }).payView('pi_x')).toEqual({ kind: 'closed' });
    for (const status of ['canceled', 'requires_capture']) expect(await liveWith({ status }).payView('pi_x')).toEqual({ kind: 'closed' });
  });
  it('clientSecret still answers as before for every status (D-58)', async () => {
    for (const status of ['processing', 'succeeded', 'canceled']) expect(await liveWith({ status }).clientSecret('pi_x')).toBeNull();
    expect(await liveWith({ status: 'requires_payment_method' }).clientSecret('pi_x')).toBe('pi_x_secret_y');
  });
});

describe('the pay button while Stripe.js loads', () => {
  it('says it is loading, and is disabled, before the card form has mounted', async () => {
    const { StripePay } = await import('@/components/stripe-pay');
    const html = renderToStaticMarkup(createElement(StripePay, { publishableKey: 'pk_not_a_key', clientSecret: 'cs_not_a_secret', returnUrl: 'http://localhost/x' }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Loading the card form…<\/button>/);
    expect(html).not.toContain('Pay with Stripe');
  });
});
