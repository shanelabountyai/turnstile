// PRD-3 item 12 (review CODE-3 retry part, CODE-12): the nightly retry for refunds Stripe has not confirmed, and the
// numbers the Ledger shows about them. Called from the clone's cron (src/app/cron-jobs.ts) across every org.
//
// THE RULE: this job must never be able to send a second refund for one Refund row.
//
// A Refund row with stripeRefundId NULL means "Stripe has not been seen to confirm it". That is two different cases the
// row cannot tell apart: Stripe never took the refund, or Stripe took it and the answer (or the row update) was lost.
// Sending it again is only safe while Stripe still replays the first answer for the idempotency key, which it does
// for 24 hours from the key's first use; after that the same key is a brand-new refund (#10 S3, D-59).
//
// What the code can show, and so what is retried:
//   - the key is `<event UUID>:<refund id>` (idempotencyKey), built from two columns of the row;
//   - the parameters (PaymentIntent, amount) are columns of the row, and a trigger refuses any change to them (D-21);
//   - the key's first use cannot be earlier than the row's creation, because the Stripe call follows the cast's commit;
//   - the row was written in the same transaction as the CommandLog row of the command that issued it, and the engine
//     stamps a refund with that command's `at`. So the earliest CommandLog.createdAt among the event's commands at that
//     `at` is no later than the row's creation.
// Hence: now - (that earliest createdAt) is an upper bound on the key's age. While the bound is under
// RETRY_WINDOW_SECONDS (23 h, an hour inside Stripe's window for clock differences and the run's own length) the retry
// reuses the same key inside the window. Everything else — older, no command found at its time, or a clock that reads
// before the row — is NOT retried: it is counted as "needs the owner", logged with its ids, and shown on the Ledger.
// Whether to look the refund up at Stripe first and then retry is the owner's product call (D-70).
//
// The same rule now guards the other two callers of settleRefunds (a box-office refund and a late-payment webhook):
// they pass the event's retryable ids, which include the refunds they have just issued (checkout.ts, D-70). The refund
// D-58 sends for a payment that succeeded after it failed has no Refund row, so it is not seen here.
//
// A limit to know: Stripe also stores and replays most FAILED answers for a key for 24 hours. So a retry helps where
// the first attempt never reached Stripe or its answer was lost; a refund Stripe refused is refused again on the
// replay and ends up as "needs the owner". None of Stripe's replay behaviour has been exercised here.
import { db } from '@/core/db';
import { settleRefunds } from './checkout';
import { pendingRefunds, RETRY_WINDOW_SECONDS } from './refund-window';

export { pendingRefunds, RETRY_WINDOW_SECONDS, type Pending, type PendingRefund } from './refund-window';
import type { StripeGateway } from './stripe';

/** Counts only: this object is the cron's HTTP answer and its log line. Ids go to the error log, never here. */
export type RetryResult = { unsettled: number; retryable: number; settled: number; stillPending: number; needsOwner: number; failedEvents: number };

/**
 * One pass over every org. Retryable rows are sent through settleRefunds, restricted to exactly those refund ids, so
 * the Stripe call, the key and the row update are the ones a box-office refund uses. Never throws for one event's
 * fault: a Stripe failure leaves the row pending (settleRefunds), anything else is counted in `failedEvents` and the
 * other events still run.
 */
export async function retryPendingRefunds(gateway: StripeGateway | (() => StripeGateway), o: { now?: Date } = {}): Promise<RetryResult> {
  const out: RetryResult = { unsettled: 0, retryable: 0, settled: 0, stillPending: 0, needsOwner: 0, failedEvents: 0 };
  for (const org of await db.org.findMany({ select: { id: true }, orderBy: { id: 'asc' } })) {
    const p = await pendingRefunds(org.id, undefined, o.now);
    out.unsettled += p.unsettled;
    out.needsOwner += p.needsOwner.length;
    out.retryable += p.retryable.length;
    for (const r of p.needsOwner) {
      console.error(`[turnstile] refund ${r.refundId} (event ${r.eventId}, ${r.paymentId}, ${r.amountCents} cents) is not confirmed by Stripe and was NOT retried: it cannot be shown to be inside the ${RETRY_WINDOW_SECONDS / 3600}-hour retry window, so a retry could refund twice. It needs the owner: check the PaymentIntent's refunds at Stripe.`);
    }
    const byEvent = new Map<string, string[]>();
    for (const r of p.retryable) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r.refundId]);
    for (const [eventId, refundIds] of byEvent) {
      try {
        const s = await settleRefunds(org.id, eventId, gateway, refundIds);
        out.settled += s.settled;
        out.stillPending += s.pending;
      } catch (e) {
        out.failedEvents++;
        out.stillPending += refundIds.length; // an upper bound: some may have settled before the fault; the next run recounts from the rows
        console.error(`[turnstile] refund retry stopped for event ${eventId} (${refundIds.length} refund(s) left pending): ${e instanceof Error ? e.constructor.name : 'error'}`);
      }
    }
  }
  return out;
}
