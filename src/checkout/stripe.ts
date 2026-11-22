// The Stripe boundary (D-5, D-23, D-30): one interface, two implementations. StripeLive wraps the official package
// and reads its key from the core env; it runs only where a key exists (Shane's machine, Vercel). StripeRecorded is
// what every test, inventory:eval:db and CI use: it answers from a map of recorded ids and records every call.
import Stripe from 'stripe';
import { env } from '@/core/env';

export type PaymentIntentArgs = { holdId: string; amountCents: number; currency: string; customer: string; orgId: string; eventId: string };
export type RefundArgs = { refundId: string; paymentIntentId: string; amountCents: number; eventId: string };
export type CancelArgs = { paymentIntentId: string; eventId: string };

/**
 * Stripe idempotency keys are account-wide and last 24 hours, but the engine numbers holds, offers and refunds per
 * event (O-0001, R-00001 in every event), and both demo orgs share one Stripe test account. So every key is prefixed
 * with the event's UUID (D-56, review CODE-1). The engine, the fixtures and the commitment do not change.
 */
export const idempotencyKey = (eventId: string, id: string): string => `${eventId}:${id}`;

export interface StripeGateway {
  /** Idempotency key = event id + hold id (D-5, D-56). Returns the PaymentIntent id, which is the engine's payment_id. */
  createPaymentIntent(a: PaymentIntentArgs): Promise<{ id: string }>;
  /** Idempotency key = event id + refund id (D-5, D-56). Returns Stripe's refund id. Throws StripeProviderError on any Stripe failure. */
  createRefund(a: RefundArgs): Promise<{ id: string }>;
  /** After a failed payment releases the hold, the PaymentIntent is cancelled so it can never be confirmed again (D-56, review CODE-2). */
  cancelPaymentIntent(a: CancelArgs): Promise<void>;
  /** What Stripe Elements needs to confirm a PaymentIntent in the browser; null where there is no live Stripe. */
  clientSecret(paymentIntentId: string): Promise<string | null>;
}

/** Live Stripe where a secret key is set, recorded otherwise. Recorded is safe to fall back to: it moves no money, and
 * nothing is sold without a webhook signed with STRIPE_WEBHOOK_SECRET (the e2e sets the fixture's; production never does). */
export const stripeGateway = (): StripeGateway => (env.STRIPE_SECRET_KEY ? new StripeLive() : new StripeRecorded());

/** The part of the official client StripeLive uses; a test passes a stand-in with these three calls. */
export type StripeClient = Pick<Stripe, 'paymentIntents' | 'refunds'>;

export class StripeLive implements StripeGateway {
  private readonly s: StripeClient;
  constructor(secretKey = env.STRIPE_SECRET_KEY, client?: StripeClient) {
    if (client) {
      this.s = client;
      return;
    }
    if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set (D-5: test-mode keys live only in the owner\'s .env.local and Vercel)');
    this.s = new Stripe(secretKey);
  }
  async createPaymentIntent(a: PaymentIntentArgs) {
    const pi = await this.s.paymentIntents.create(
      { amount: a.amountCents, currency: a.currency.toLowerCase(), automatic_payment_methods: { enabled: true }, metadata: { hold_id: a.holdId, customer: a.customer, org_id: a.orgId, event_id: a.eventId } },
      { idempotencyKey: idempotencyKey(a.eventId, a.holdId) },
    );
    return { id: pi.id };
  }
  async createRefund(a: RefundArgs) {
    try {
      const r = await this.s.refunds.create({ payment_intent: a.paymentIntentId, amount: a.amountCents }, { idempotencyKey: idempotencyKey(a.eventId, a.refundId) });
      return { id: r.id };
    } catch (e) {
      throw providerError(e, `refund ${a.refundId}`);
    }
  }
  async cancelPaymentIntent(a: CancelArgs) {
    try {
      await this.s.paymentIntents.cancel(a.paymentIntentId, {}, { idempotencyKey: idempotencyKey(a.eventId, `cancel:${a.paymentIntentId}`) });
    } catch (e) {
      throw providerError(e, `cancel ${a.paymentIntentId}`);
    }
  }
  async clientSecret(paymentIntentId: string) {
    return (await this.s.paymentIntents.retrieve(paymentIntentId)).client_secret;
  }
}

/** Any failure from Stripe, so callers can leave a Refund PENDING_PROVIDER (D-23) instead of throwing after a commit. */
export class StripeProviderError extends Error {
  constructor(message: string, readonly kind: 'idempotency' | 'other' = 'other') {
    super(message);
  }
}

/** Wrap the official client's errors; an idempotency error means a key was reused with different parameters: a bug, not an outage. */
function providerError(e: unknown, what: string): Error {
  if (!(e instanceof Stripe.errors.StripeError)) return e instanceof Error ? e : new Error(String(e));
  return new StripeProviderError(`Stripe ${e.type} on ${what}: ${e.message}`, e instanceof Stripe.errors.StripeIdempotencyError ? 'idempotency' : 'other');
}

/** Recorded answers: PaymentIntent ids by hold id, refund ids by refund id; unmapped ids are minted as `pi_rec_<hold>` / `re_rec_<refund>`. */
export class StripeRecorded implements StripeGateway {
  readonly calls: ({ kind: 'paymentIntent' } & PaymentIntentArgs | { kind: 'refund' } & RefundArgs | { kind: 'cancel' } & CancelArgs)[] = [];
  /** Refund ids listed here fail with StripeProviderError once (PENDING_PROVIDER, then the retry succeeds). */
  readonly failRefundOnce = new Set<string>();
  constructor(private readonly recorded: { paymentIntents?: Record<string, string>; refunds?: Record<string, string> } = {}) {}
  async createPaymentIntent(a: PaymentIntentArgs) {
    this.calls.push({ kind: 'paymentIntent', ...a });
    return { id: this.recorded.paymentIntents?.[a.holdId] ?? `pi_rec_${a.holdId}` };
  }
  async createRefund(a: RefundArgs) {
    this.calls.push({ kind: 'refund', ...a });
    if (this.failRefundOnce.delete(a.refundId)) throw new StripeProviderError(`recorded provider failure for ${a.refundId}`);
    return { id: this.recorded.refunds?.[a.refundId] ?? `re_rec_${a.refundId}` };
  }
  async cancelPaymentIntent(a: CancelArgs) {
    this.calls.push({ kind: 'cancel', ...a });
  }
  async clientSecret() {
    return null;
  }
}
