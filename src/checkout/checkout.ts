// The checkout flows over the cast path with the Stripe boundary in the right place (D-23):
//   payStart       — the command previewed in memory, then the PaymentIntent (idempotency key = event id + hold id,
//                    D-56), PAYING recorded only after Stripe returns; a Stripe failure leaves the hold HELD (PRD-3 item 11).
//   applyWebhook   — verify, map, cast (dedupe on event.id through the CommandLog), then settle any refund the engine issued.
//   settleRefunds  — a Refund row still without a Stripe id gets the refunds.create call (idempotency key = event
//                    id + refund id, D-56); any Stripe failure leaves it NULL (PENDING_PROVIDER), the loop goes on to the
//                    next row, and a later call retries it, but only while the row is inside the 23-hour window in
//                    which the same key is known to be replayed (D-70). StripeLive maps every Stripe error to StripeProviderError.
//   A failed payment that releases its hold also cancels the PaymentIntent (D-56). The cancel is best effort: a success
//   that still arrives for a FAILED payment is refunded in full at Stripe, with no order and no ledger row (D-58).
import { withOrg } from '@/core/db/rls';
import { log } from '@/core/log';
import { castCommand, type CastOptions } from './cast';
import { previewCommand } from './read';
import { pendingRefunds } from './refund-window';
import { StripeProviderError, type StripeGateway } from './stripe';
import { verifyStripeSignature, webhookCommand, type StripeEvent } from './webhook';
import type { Command, Result } from '@/inventory/types';
import type { Timestamp } from '@/inventory/time';

/**
 * Pay could not be started, and nothing was recorded as PAYING (PRD-3 item 11). `stripe`: Stripe did not create the
 * PaymentIntent, or no gateway could be built; the hold is untouched, so the customer can press Pay again. `amount`:
 * the engine's amount and the stored hold's disagree; nothing was sent to Stripe. The Buy action returns these as
 * words on the form; the message is for the log and carries ids and Stripe's error type, never its text (D-59).
 */
export class PayStartError extends Error {
  constructor(readonly kind: 'stripe' | 'amount', message: string) {
    super(message);
  }
}
/** Kept as its own class: the amount check is the one place a PaymentIntent and the engine could disagree on money. */
export class PaymentAmountMismatch extends PayStartError {
  constructor(message: string) {
    super('amount', message);
  }
}

/**
 * PAY_START. The command is first run on the engine in memory (previewCommand). Unless the engine would answer PAYING,
 * the command is cast as it is and Stripe is never called: a hold that is not HELD, not the caller's, or already
 * expired by the event clock (even though no cast has stored that yet) creates no PaymentIntent. Otherwise the amount
 * the engine previewed is compared with the stored hold's (P-3) before anything is sent, the PaymentIntent is created
 * for that amount, and only then is PAYING cast. A Stripe failure here throws PayStartError('stripe') with the hold
 * still HELD and no command recorded.
 */
export async function payStart(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway | (() => StripeGateway), opts: CastOptions = {}): Promise<Result> {
  const PREVIEW = `preview_${cmd.cmd_id}`;
  const preview = await previewCommand(orgId, eventId, { ...cmd, payment_id: PREVIEW }, opts.clock);
  const hold = preview.code === 'PAYING' ? await withOrg({ orgId }, (tx) => tx.hold.findUnique({ where: { eventId_holdId: { eventId, holdId: cmd.ref } } }), { atomic: false }) : null;
  if (preview.code !== 'PAYING') return castCommand(orgId, eventId, { ...cmd, payment_id: cmd.payment_id || `none_${cmd.cmd_id}` }, opts);
  // the engine would start the payment, so the hold exists; if its row cannot be read, nothing is cast and nothing is sent
  if (!hold) throw new PaymentAmountMismatch(`hold ${cmd.ref} (event ${eventId}) previewed as PAYING but its row was not found; nothing was sent to Stripe`);
  const amountCents = hold.qty * (hold.priceCents + hold.feeCents); // P-3, from the stored row
  if (preview.detail !== `${PREVIEW} ${amountCents}`) throw new PaymentAmountMismatch(`hold ${hold.holdId} (event ${eventId}): the engine previewed "${preview.detail}", the stored hold comes to ${amountCents}; nothing was sent to Stripe`);
  const ev = await withOrg({ orgId }, (tx) => tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { currency: true } }), { atomic: false });
  // ponytail: a hold that expires between the preview and the cast still leaves an uncaptured PaymentIntent behind
  // (requires_payment_method, no money moves). It is not cancelled from the reject path on purpose: two Pay presses on
  // one hold share a PaymentIntent (same idempotency key), so the loser's cancel would kill the winner's payment.
  let pi: { id: string };
  try {
    pi = await (typeof stripe === 'function' ? stripe() : stripe).createPaymentIntent({ holdId: hold.holdId, amountCents, currency: ev.currency, customer: hold.customer, orgId, eventId });
  } catch (e) {
    if (!(e instanceof StripeProviderError)) throw e;
    console.error(`[turnstile] Pay not started for hold ${hold.holdId} (event ${eventId}, ${amountCents} cents); the hold is still HELD: ${e.message}`);
    throw new PayStartError('stripe', e.message);
  }
  const res = await castCommand(orgId, eventId, { ...cmd, payment_id: pi.id }, opts);
  // Cannot differ unless the stored hold changed between the two reads, and no transition changes qty or price. If it
  // ever does, PAYING is already recorded, so this is not "payment not started": it is logged loudly and the recorded
  // result is returned, and the screen shows the hold as the engine has it.
  if (res.code === 'PAYING' && res.detail !== `${pi.id} ${amountCents}`) console.error(`[turnstile] BUG: amount mismatch after the cast for hold ${hold.holdId} (event ${eventId}): engine said "${res.detail}", PaymentIntent ${pi.id} was created for ${amountCents}`);
  return res;
}

/** 503 = the command is recorded but Stripe did not take a refund that has no Refund row to wait in (D-58); Stripe delivers the event again. */
export type WebhookOutcome = { status: 400 | 200 | 503; reason?: string; result?: Result };

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
  if (result.code === 'PAID_AFTER_TIMEOUT' || result.code === 'PAID_AFTER_CANCEL') await settleRefunds(a.orgId, a.eventId, gateway, await retryableIds(a.orgId, a.eventId));
  if (result.code === 'PAYMENT_FAILED_RELEASED') await cancelReleased(a.eventId, cmd.payment_id, gateway());
  if (cmd.kind === 'PAY_SUCCEEDED' && result.code === 'PAYMENT_DUPLICATE' && !(await refundPaidAfterFailed(a.orgId, a.eventId, cmd.payment_id, gateway))) return { status: 503, result };
  return { status: 200, result };
}

/**
 * Late money is refunded, never seated (non-negotiable 4), held at the boundary (D-58). The engine answers a success
 * for a payment that already FAILED with PAYMENT_DUPLICATE: no order, and no Refund row either. That success is real
 * money on a released hold: the cancel above can lose the race to a second card, or fail. So it is refunded in full
 * here, keyed by the PaymentIntent, with no ledger row (an engine rule for it is the owner's call). Only a FAILED
 * payment qualifies: a duplicate success for a seated (SUCCEEDED) or engine-refunded (SUCCEEDED_LATE) payment moves
 * nothing. Returns false when Stripe did not take the refund; the caller answers 503 so Stripe redelivers, the cast
 * dedupes on event.id, and this runs again with the same idempotency key.
 */
async function refundPaidAfterFailed(orgId: string, eventId: string, paymentIntentId: string, gateway: () => StripeGateway): Promise<boolean> {
  const p = await withOrg({ orgId }, (tx) => tx.payment.findUnique({ where: { eventId_paymentId: { eventId, paymentId: paymentIntentId } }, select: { state: true, amountCents: true } }), { atomic: false });
  if (p?.state !== 'FAILED') return true;
  try {
    await gateway().createRefund({ refundId: `paid-after-failed:${paymentIntentId}`, paymentIntentId, amountCents: p.amountCents, eventId });
    log('checkout.paid_after_failed_refunded', { event_id: eventId, payment_intent: paymentIntentId, amount_cents: p.amountCents });
    return true;
  } catch (e) {
    if (!(e instanceof StripeProviderError)) throw e;
    console.error(`[turnstile] ${paymentIntentId} was paid after its payment failed and is NOT refunded yet (${p.amountCents} cents, event ${eventId}): ${e.message}`);
    return false;
  }
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

/** REFUND_REQUEST: the engine decides, then Stripe is told (D-23). `pending` = how many of THIS command's refunds Stripe
 * has not confirmed yet (the ids are the leading `R-…` words of the REFUNDED detail); an older refund still stuck at
 * Stripe is retried by the same settle but is not counted against this one. */
export async function requestRefundSettled(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway | (() => StripeGateway), opts: CastOptions = {}): Promise<{ result: Result; pending: number }> {
  const result = await castCommand(orgId, eventId, cmd, opts);
  if (result.code !== 'REFUNDED') return { result, pending: 0 };
  await settleRefunds(orgId, eventId, stripe, await retryableIds(orgId, eventId));
  const mine = result.detail.split(' ').filter((w) => /^R-\d+$/.test(w));
  const pending = await withOrg({ orgId }, (tx) => tx.refund.count({ where: { eventId, refundId: { in: mine }, stripeRefundId: null } }), { atomic: false });
  return { result, pending };
}

export async function requestRefund(orgId: string, eventId: string, cmd: Command, stripe: StripeGateway, opts: CastOptions = {}): Promise<Result> {
  return (await requestRefundSettled(orgId, eventId, cmd, stripe, opts)).result;
}

/**
 * The event's unconfirmed refunds that may be sent to Stripe now: the ones just issued, and any older one still inside
 * the 23-hour window in which a retry is known to reuse its idempotency key safely (refund-window.ts, D-70). A refund
 * past the window is NOT swept along by a later refund or webhook in the same event: that was the remaining way to a
 * second refund for one row. It waits, counted on the Ledger as needing the owner.
 */
const retryableIds = async (orgId: string, eventId: string): Promise<string[]> => (await pendingRefunds(orgId, eventId)).retryable.map((r) => r.refundId);

/** Calls refunds.create for every Refund row without a Stripe id (or only the ones named); returns how many settled and how many are still pending. */
export async function settleRefunds(orgId: string, eventId: string, given: StripeGateway | (() => StripeGateway), only?: string[]): Promise<{ settled: number; pending: number }> {
  // `only`: the nightly retry passes exactly the refund ids it has shown to be inside Stripe's idempotency window (refund-retry.ts)
  const rows = await withOrg({ orgId }, (tx) => tx.refund.findMany({ where: { eventId, stripeRefundId: null, ...(only && { refundId: { in: only } }) }, orderBy: { refundId: 'asc' } }), { atomic: false });
  if (rows.length === 0) return { settled: 0, pending: 0 };
  let stripe: StripeGateway;
  try {
    stripe = typeof given === 'function' ? given() : given;
  } catch (e) {
    // no gateway (Production with no key, PRD-3 item 11): the refunds are recorded and stay PENDING_PROVIDER, as for any Stripe failure
    if (!(e instanceof StripeProviderError)) throw e;
    console.error(`[turnstile] ${rows.length} refund(s) in event ${eventId} left PENDING_PROVIDER, no Stripe gateway: ${e.message}`);
    return { settled: 0, pending: rows.length };
  }
  let settled = 0;
  for (const r of rows) {
    try {
      const { id } = await stripe.createRefund({ refundId: r.refundId, paymentIntentId: r.paymentId, amountCents: r.amountCents, eventId });
      // updateMany with the NULL guard: if another settle (a box-office refund, the nightly retry) wrote the id first, this
      // writes nothing instead of tripping the append-only trigger after Stripe has already answered. Same key, same answer.
      await withOrg({ orgId }, (tx) => tx.refund.updateMany({ where: { eventId, refundId: r.refundId, stripeRefundId: null }, data: { stripeRefundId: id } }));
      settled++;
    } catch (e) {
      if (!(e instanceof StripeProviderError)) throw e;
      // every failure is logged: the Refund row stores no error, so this line is the only trace of why it is still pending
      console.error(`[turnstile] ${e.kind === 'idempotency' ? 'BUG: idempotency key reused; ' : ''}refund ${r.refundId} (event ${eventId}, ${r.paymentId}, ${r.amountCents} cents) not confirmed by Stripe, left PENDING_PROVIDER: ${e.message}`);
    }
  }
  return { settled, pending: rows.length - settled };
}
