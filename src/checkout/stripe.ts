// The Stripe boundary (D-5, D-23, D-30): one interface, two implementations. StripeLive wraps the official package
// and reads its key from the core env; it runs only where a key exists (Shane's machine, Vercel). StripeRecorded is
// what every test, inventory:eval:db and CI use: it answers from a map of recorded ids and records every call.
import Stripe from 'stripe';
import { env } from '@/core/env';

export type PaymentIntentArgs = { holdId: string; amountCents: number; currency: string; customer: string; orgId: string; eventId: string };
export type RefundArgs = { refundId: string; paymentIntentId: string; amountCents: number };

export interface StripeGateway {
  /** Idempotency key = hold id (D-5). Returns the PaymentIntent id, which is the engine's payment_id. */
  createPaymentIntent(a: PaymentIntentArgs): Promise<{ id: string }>;
  /** Idempotency key = refund id (D-5). Returns Stripe's refund id. */
  createRefund(a: RefundArgs): Promise<{ id: string }>;
}

export class StripeLive implements StripeGateway {
  private readonly s: Stripe;
  constructor(secretKey = env.STRIPE_SECRET_KEY) {
    if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set (D-5: test-mode keys live only in the owner\'s .env.local and Vercel)');
    this.s = new Stripe(secretKey);
  }
  async createPaymentIntent(a: PaymentIntentArgs) {
    const pi = await this.s.paymentIntents.create(
      { amount: a.amountCents, currency: a.currency.toLowerCase(), automatic_payment_methods: { enabled: true }, metadata: { hold_id: a.holdId, customer: a.customer, org_id: a.orgId, event_id: a.eventId } },
      { idempotencyKey: a.holdId },
    );
    return { id: pi.id };
  }
  async createRefund(a: RefundArgs) {
    const r = await this.s.refunds.create({ payment_intent: a.paymentIntentId, amount: a.amountCents }, { idempotencyKey: a.refundId });
    return { id: r.id };
  }
}

export class StripeProviderError extends Error {}

/** Recorded answers: PaymentIntent ids by hold id, refund ids by refund id; unmapped ids are minted as `pi_rec_<hold>` / `re_rec_<refund>`. */
export class StripeRecorded implements StripeGateway {
  readonly calls: ({ kind: 'paymentIntent' } & PaymentIntentArgs | { kind: 'refund' } & RefundArgs)[] = [];
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
}
