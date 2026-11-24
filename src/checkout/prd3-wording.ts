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

// ---- item 9: the spent demo org and the one-way clock
/** One line, in demo mode, on the Events card and above the customer picker on Buy, once sales have closed on the event clock. `other` is the other demo org's slug. */
export const usedUpWords = (other: string): string =>
  `This organisation’s demo is used up: sales have closed on its event clock, and the clock cannot go back. Use the other demo organisation, ${other}, or ask for a reset.`;

/** The confirmation shown before a clock move that closes sales. Times are axis strings as the page shows them ("2027-03-20 20:00:00"). */
export const CLOCK_PAST_CLOSE = {
  title: 'This closes sales, and it is one-way',
  body: (closesAt: string, to: string): string =>
    `Sales close at ${closesAt}. Setting the event clock to ${to} ends sales for this event: nothing more can be held or bought in this organisation. The clock cannot be set back before the last recorded command, so after the next scan, hold or payment at the new time this cannot be undone here.`,
  /** Added in demo mode, where the organisation is shared. */
  demo: 'This demo organisation is shared: every later visitor finds it used up until it is reset.',
  confirm: (to: string): string => `Yes, set the clock to ${to} and close sales`,
  cancel: 'Cancel',
};

/** Why "Back to the wall clock" is not offered in demo mode (keys are WallClockBlock in src/checkout/demo.ts). */
export const WALL_CLOCK_BLOCKED: Record<'fails' | 'before-open' | 'closes-sales', string> = {
  fails: '“Back to the wall clock” is off: the wall clock is earlier than the last recorded command, and the event clock cannot go before it.',
  'before-open': '“Back to the wall clock” is off in the demo: the wall clock is before sales open, so nothing could be bought.',
  'closes-sales': '“Back to the wall clock” is off in the demo: the wall clock is past the close of sales, so it would use this organisation up. Use Set clock if that is what you mean.',
};
