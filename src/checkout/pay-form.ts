// PRD-3 item 11: what the Buy screen offers each PAYING hold, worked out one hold at a time so that a Stripe failure
// for one PaymentIntent (or a gateway that cannot be built) costs that hold its card form and nothing else. Before,
// one failed `clientSecret` call rejected the page's Promise.all and the whole Buy page became the error page.
// Nothing here moves money or decides anything: it only chooses which block of the page a hold shows.
//
// PRD-3 item 10: a PAYING hold Stripe already has the payment for shows "Payment received by Stripe…" and no card form.
// Two ways to know: the PaymentIntent's status (`processing` or `succeeded`, from the gateway), or Stripe's own redirect
// back to the page (`redirect_status=succeeded` with this hold's `payment_intent`), which needs no call at all.
import type { StripeGateway } from './stripe';

export type PayForm =
  | { kind: 'card'; clientSecret: string } // Stripe Elements can confirm a card for this PaymentIntent
  | { kind: 'received' } // Stripe has the payment; the tickets follow when the signed webhook lands (item 10)
  | { kind: 'closed' } // Stripe is not taking a card for it now (refused, cancelled or moved on; D-58)
  | { kind: 'unavailable' } // Stripe could not be asked; the page says so on this hold only
  | { kind: 'recorded' }; // no publishable key here: recorded Stripe, the signed webhook issues the tickets

type HoldLike = { hold: string; state: string; paymentId: string | null };

/** Stripe's query parameters on its redirect back to `return_url` after confirmPayment. Only these two are read; the client secret it also appends is ignored. */
export type Returned = { paymentIntent?: string; redirectStatus?: string };

/** One entry per PAYING hold that has a PaymentIntent. `gateway` is called at most once, and only if Stripe has to be asked. */
export async function payForms(holds: HoldLike[], hasPublishableKey: boolean, gateway: () => StripeGateway, returned: Returned = {}): Promise<Map<string, PayForm>> {
  const paying = holds.filter((h) => h.state === 'PAYING' && h.paymentId);
  // the redirect names one PaymentIntent; a hold is "received" by it only if that PaymentIntent is its own
  const back = (h: HoldLike) => returned.redirectStatus === 'succeeded' && returned.paymentIntent === h.paymentId;
  let stripe: StripeGateway | null = null;
  const ask = async (h: HoldLike): Promise<PayForm> => {
    if (back(h)) return { kind: 'received' };
    if (!hasPublishableKey) return { kind: 'recorded' };
    try {
      stripe ??= gateway();
      return await stripe.payView(h.paymentId!);
    } catch (e) {
      // ids and the error's class only: a provider's message text can quote request values (D-59)
      console.error(`[turnstile] no card form for hold ${h.hold} (${h.paymentId}): ${e instanceof Error ? e.constructor.name : 'error'}`);
      return { kind: 'unavailable' };
    }
  };
  return new Map(await Promise.all(paying.map(async (h) => [h.hold, await ask(h)] as const)));
}
