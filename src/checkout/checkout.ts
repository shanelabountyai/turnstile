// The checkout flows over the cast path with the Stripe boundary in the right place (D-23):
//   payStart       — PaymentIntent first (idempotency key = hold id), PAYING recorded only after Stripe returns.
//   applyWebhook   — verify, map, cast (dedupe on event.id through the CommandLog), then settle any refund the engine issued.
//   settleRefunds  — every Refund row still without a Stripe id gets the refunds.create call (idempotency key = event
//                    id + refund id, D-56); any Stripe failure leaves it NULL (PENDING_PROVIDER), the loop goes on to the
//                    next row, and the next call retries it. StripeLive maps every Stripe error to StripeProviderError.
//   A failed payment that releases its hold also cancels the PaymentIntent, so a later card cannot pay it (D-56).
import { withOrg } from '@/core/db/rls';
import { castCommand, type CastOptions } from './cast';
import { StripeProviderError, type StripeGateway } from './stripe';
import { verifyStripeSignature, webhookCommand, type StripeEvent } from './webhook';
import type { Command, Result } from '@/inventory/types';
import type { Timestamp } from '@/inventory/time';

export class PaymentAmountMismatch extends Error {}

/** PAY_START. The hold must be HELD and the caller's, or the command is cast (and rejected by the engine) without touching Stripe. */
export async function payStart(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway, opts: CastOptions = {}): Promise<Result> {
  const hold = await withOrg({ orgId }, (tx) => tx.hold.findUnique({ where: { eventId_holdId: { eventId, holdId: cmd.ref } } }), { atomic: false });
  if (!hold || hold.state !== 'HELD' || hold.customer !== cmd.customer) return castCommand(orgId, eventId, { ...cmd, payment_id: cmd.payment_id || `none_${cmd.cmd_id}` }, opts);
  const amountCents = hold.qty * (hold.priceCents + hold.feeCents); // P-3; the cast below recomputes it and the two must agree
  const ev = await withOrg({ orgId }, (tx) => tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { currency: true } }), { atomic: false });
  // ponytail: a hold that expires between here and the cast leaves an uncaptured PaymentIntent behind (requires_payment_method, no money moves);
  // cancel it from the reject path if that ever matters.
  const pi = await stripe.createPaymentIntent({ holdId: hold.holdId, amountCents, currency: ev.currency, customer: hold.customer, orgId, eventId });
  const res = await castCommand(orgId, eventId, { ...cmd, payment_id: pi.id }, opts);
  if (res.code === 'PAYING' && res.detail !== `${pi.id} ${amountCents}`) throw new PaymentAmountMismatch(`engine said ${res.detail}, PaymentIntent is ${pi.id} ${amountCents}`);
  return res;
}

export type WebhookOutcome = { status: 400 | 404 | 200; reason?: string; result?: Result };

/** The webhook, after the route has found the org and event from the PaymentIntent's metadata. `at` is the command's time on the axis; with `clock` the cast restamps it on the event clock (D-35). */
export async function applyWebhook(a: { orgId: string; eventId: string; rawBody: string; header: string | null; secret: string; nowSeconds: number; at: Timestamp; clock?: Date; stripe: StripeGateway | (() => StripeGateway) }): Promise<WebhookOutcome> {
  const v = verifyStripeSignature(a.rawBody, a.header, a.secret, a.nowSeconds);
  if (!v.ok) return { status: 400, reason: v.reason };
  const ev = JSON.parse(a.rawBody) as StripeEvent;
  const cmd = webhookCommand(ev, a.at);
  if (!cmd) return { status: 200, reason: `ignored ${ev.type}` };
  const result = await castCommand(a.orgId, a.eventId, cmd, { stripeEventId: ev.id, clock: a.clock });
  // the gateway is built only when money has to move, so a bad signature never needs a key
  const gateway = () => (typeof a.stripe === 'function' ? a.stripe() : a.stripe);
  if (result.code === 'PAID_AFTER_TIMEOUT' || result.code === 'PAID_AFTER_CANCEL') await settleRefunds(a.orgId, a.eventId, gateway());
  if (result.code === 'PAYMENT_FAILED_RELEASED') await cancelReleased(a.eventId, cmd.payment_id, gateway());
  return { status: 200, result };
}

/** The hold is gone, so the PaymentIntent must not take money later (review CODE-2). A Stripe failure is logged, not thrown: the cast has committed. */
async function cancelReleased(eventId: string, paymentIntentId: string, stripe: StripeGateway): Promise<void> {
  try {
    await stripe.cancelPaymentIntent({ eventId, paymentIntentId });
  } catch (e) {
    if (!(e instanceof StripeProviderError)) throw e;
    console.error(`[turnstile] could not cancel ${paymentIntentId} after a failed payment: ${e.message}`);
  }
}

/** REFUND_REQUEST: the engine decides, then Stripe is told (D-23). `pending` = refunds Stripe has not confirmed yet. */
export async function requestRefundSettled(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway, opts: CastOptions = {}): Promise<{ result: Result; pending: number }> {
  const result = await castCommand(orgId, eventId, cmd, opts);
  const pending = result.code === 'REFUNDED' ? (await settleRefunds(orgId, eventId, stripe)).pending : 0;
  return { result, pending };
}

export async function requestRefund(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway, opts: CastOptions = {}): Promise<Result> {
  return (await requestRefundSettled(orgId, eventId, cmd, stripe, opts)).result;
}

/** Calls refunds.create for every Refund row without a Stripe id; returns how many settled and how many are still pending. */
export async function settleRefunds(orgId: string, eventId: string, stripe: StripeGateway): Promise<{ settled: number; pending: number }> {
  const rows = await withOrg({ orgId }, (tx) => tx.refund.findMany({ where: { eventId, stripeRefundId: null }, orderBy: { refundId: 'asc' } }), { atomic: false });
  let settled = 0;
  for (const r of rows) {
    try {
      const { id } = await stripe.createRefund({ refundId: r.refundId, paymentIntentId: r.paymentId, amountCents: r.amountCents, eventId });
      await withOrg({ orgId }, (tx) => tx.refund.update({ where: { eventId_refundId: { eventId, refundId: r.refundId } }, data: { stripeRefundId: id } }));
      settled++;
    } catch (e) {
      if (!(e instanceof StripeProviderError)) throw e;
      if (e.kind === 'idempotency') console.error(`[turnstile] BUG: idempotency key reused for ${eventId}:${r.refundId}: ${e.message}`);
    }
  }
  return { settled, pending: rows.length - settled };
}
