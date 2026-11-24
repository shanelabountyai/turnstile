// PRD-3: every sentence this PRD puts on a screen, in one place, so the owner can read and change the wording without
// hunting through pages. **Proposed wording: Shane approves or replaces each one** (the PR lists them under "Wording
// for Shane to approve"). Words only: nothing here decides anything, and no sentence carries Stripe's own error text.

// ---- item 11: Pay fails soft
/** Returned by the Pay action when Stripe did not create the PaymentIntent (or no gateway could be built). The hold is still HELD. */
export const PAY_NOT_STARTED = 'Payment could not be started, and nothing was charged. Your hold is still yours: try Pay again before the timer runs out.';
/** Returned by the Pay action if the amount Stripe would be asked for and the engine's amount ever disagree. Nothing is sent to Stripe. */
export const PAY_AMOUNT_MISMATCH = 'Payment was not started: the amount for this hold could not be confirmed, and nothing was charged. Release the hold and hold the tickets again.';
/** On one PAYING hold when its card form could not be fetched from Stripe. Other holds on the page are unaffected. */
export const PAY_FORM_UNAVAILABLE = 'The card form for this payment could not be loaded just now. Nothing was charged. Refresh the page to try again.';

// ---- item 10: Payment received
/** On a PAYING hold once Stripe has the payment (PaymentIntent `processing` or `succeeded`, or Stripe's redirect back). The first sentence is PRD-3's. */
export const PAY_RECEIVED = 'Payment received by Stripe; tickets appear when Stripe confirms it.';
/** Follows PAY_RECEIVED: the page does not refresh itself. */
export const PAY_RECEIVED_NEXT = 'That usually takes a few seconds. Refresh the page to see your tickets.';
/** The pay button until Stripe.js has loaded and the card form is on the page. */
export const PAY_LOADING = 'Loading the card form…';

// ---- item 12: unsettled refunds on the Ledger
/**
 * The Ledger's line about refunds Stripe has not confirmed (Refund rows with no Stripe refund id). `retryable` are the
 * ones the nightly job will send again; `needsOwner` are the ones it will not, because a retry could refund twice.
 */
export function unsettledRefundsWords(unsettled: number, retryable: number, needsOwner: number): string {
  const head = `Refunds not yet confirmed by Stripe: ${unsettled}.`;
  if (unsettled === 0) return head;
  const parts = [head, 'They are already counted in Refunded above.'];
  if (retryable > 0) parts.push(`${retryable} will be sent to Stripe again by the nightly job.`);
  if (needsOwner > 0) parts.push(`${needsOwner} ${needsOwner === 1 ? 'needs' : 'need'} the owner: too old to be retried safely (a retry could refund twice), so ${needsOwner === 1 ? 'it is' : 'they are'} not retried automatically.`);
  return parts.join(' ');
}
