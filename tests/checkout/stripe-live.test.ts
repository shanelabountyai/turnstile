// D-56 (review CODE-1, CODE-2, CODE-3): StripeLive against a stand-in client, no network, no key.
// Idempotency keys are unique per event, so the two demo orgs (one Stripe test account, the same R-00001 / O-0001 in
// each event) never collide; a retry in the same event sends the same key; every Stripe error becomes a
// StripeProviderError, with idempotency errors marked as bugs; a cancelled PaymentIntent is keyed the same way.
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { idempotencyKey, StripeLive, StripeProviderError, type StripeClient } from '@/checkout/stripe';

const A = '11111111-1111-4111-8111-111111111111'; // event in acme
const B = '22222222-2222-4222-8222-222222222222'; // the same fixture event in globex

function fake(fail?: () => Error) {
  const keys: { call: string; key: string | undefined }[] = [];
  const opts = (o?: { idempotencyKey?: string }) => o?.idempotencyKey;
  const client = {
    paymentIntents: {
      create: async (_p: unknown, o?: { idempotencyKey?: string }) => { keys.push({ call: 'pi', key: opts(o) }); if (fail) throw fail(); return { id: 'pi_x' }; },
      cancel: async (_id: string, _p: unknown, o?: { idempotencyKey?: string }) => { keys.push({ call: 'cancel', key: opts(o) }); if (fail) throw fail(); return { id: 'pi_x' }; },
    },
    refunds: {
      create: async (_p: unknown, o?: { idempotencyKey?: string }) => { keys.push({ call: 'refund', key: opts(o) }); if (fail) throw fail(); return { id: 're_x' }; },
    },
  } as unknown as StripeClient;
  return { keys, live: new StripeLive(undefined, client) };
}

describe('StripeLive idempotency keys (D-56)', () => {
  it('the first refund in two events gets two different keys; a retry in the same event gets the same key', async () => {
    const { keys, live } = fake();
    await live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_a', amountCents: 3849, eventId: A });
    await live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_b', amountCents: 3849, eventId: B });
    await live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_a', amountCents: 3849, eventId: A });
    expect(keys.map((k) => k.key)).toEqual([`${A}:R-00001`, `${B}:R-00001`, `${A}:R-00001`]);
    expect(keys[0]!.key).not.toBe(keys[1]!.key);
  });
  it('the first waitlist offer (O-0001) in two events gets two different PaymentIntent keys', async () => {
    const { keys, live } = fake();
    for (const eventId of [A, B]) await live.createPaymentIntent({ holdId: 'O-0001', amountCents: 3849, currency: 'USD', customer: 'C-0001', orgId: 'o', eventId });
    expect(keys.map((k) => k.key)).toEqual([idempotencyKey(A, 'O-0001'), idempotencyKey(B, 'O-0001')]);
    // literal keys, not idempotencyKey() compared with itself: this must go red if the event id is dropped (review S6)
    expect(keys.map((k) => k.key)).toEqual([`${A}:O-0001`, `${B}:O-0001`]);
    expect(keys[0]!.key).not.toBe(keys[1]!.key);
  });
  it('cancelling a PaymentIntent is keyed by event and PaymentIntent', async () => {
    const { keys, live } = fake();
    await live.cancelPaymentIntent({ eventId: A, paymentIntentId: 'pi_a' });
    expect(keys).toEqual([{ call: 'cancel', key: `${A}:cancel:pi_a` }]);
  });
});

describe('StripeLive error mapping (D-56, review CODE-3)', () => {
  it('a connection or API error on refund becomes StripeProviderError (other), so the Refund stays PENDING_PROVIDER', async () => {
    for (const E of [Stripe.errors.StripeConnectionError, Stripe.errors.StripeAPIError, Stripe.errors.StripeRateLimitError]) {
      const { live } = fake(() => new E({ message: 'boom' }));
      const err = await live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_a', amountCents: 1, eventId: A }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StripeProviderError);
      expect((err as StripeProviderError).kind).toBe('other');
    }
  });
  it('an idempotency error is marked as a bug, still a StripeProviderError', async () => {
    const { live } = fake(() => new Stripe.errors.StripeIdempotencyError({ message: 'Keys for idempotent requests can only be used with the same parameters' }));
    const err = await live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_a', amountCents: 1, eventId: A }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeProviderError);
    expect((err as StripeProviderError).kind).toBe('idempotency');
  });
  it('the provider error names Stripe\'s type, code, status and request id, and never carries Stripe\'s message text (review N3: it can quote a key)', async () => {
    const { live } = fake(() => new Stripe.errors.StripeAuthenticationError({ message: 'Invalid API Key provided: sk_test_****abcd', code: 'api_key_invalid', statusCode: 401, requestId: 'req_123' } as ConstructorParameters<typeof Stripe.errors.StripeAuthenticationError>[0]));
    for (const call of [() => live.createRefund({ refundId: 'R-00001', paymentIntentId: 'pi_a', amountCents: 1, eventId: A }), () => live.cancelPaymentIntent({ eventId: A, paymentIntentId: 'pi_a' })]) {
      const err = (await call().catch((e: unknown) => e)) as StripeProviderError;
      expect(err).toBeInstanceOf(StripeProviderError);
      expect(err.message).toMatch(/StripeAuthenticationError/);
      expect(err.message).toMatch(/api_key_invalid/);
      expect(err.message).toMatch(/401/);
      expect(err.message).toMatch(/req_123/);
      expect(err.message).not.toMatch(/sk_test|Invalid API Key/);
    }
  });
  it('a non-Stripe error is not swallowed into a provider error', async () => {
    const { live } = fake(() => new TypeError('a bug of ours'));
    await expect(live.cancelPaymentIntent({ eventId: A, paymentIntentId: 'pi_a' })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('StripeLive.clientSecret: the pay form is offered only while the PaymentIntent can still take a first card (review M1)', () => {
  const liveWith = (pi: Record<string, unknown>) =>
    new StripeLive(undefined, { paymentIntents: { retrieve: async () => ({ client_secret: 'pi_x_secret_y', last_payment_error: null, ...pi }) }, refunds: {} } as unknown as StripeClient);
  it('a fresh PaymentIntent gives its client secret', async () => {
    for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) expect(await liveWith({ status }).clientSecret('pi_x')).toBe('pi_x_secret_y');
  });
  it('after a refused card (last_payment_error set) there is no secret, so a refresh before the failure webhook lands cannot offer a second card', async () => {
    expect(await liveWith({ status: 'requires_payment_method', last_payment_error: { type: 'card_error', code: 'card_declined' } }).clientSecret('pi_x')).toBeNull();
  });
  it('a PaymentIntent that is processing, paid or cancelled gives no secret', async () => {
    for (const status of ['processing', 'succeeded', 'canceled', 'requires_capture']) expect(await liveWith({ status }).clientSecret('pi_x')).toBeNull();
  });
});
