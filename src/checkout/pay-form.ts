// PRD-3 item 11: what the Buy screen offers each PAYING hold, worked out one hold at a time so that a Stripe failure
// for one PaymentIntent (or a gateway that cannot be built) costs that hold its card form and nothing else. Before,
// one failed `clientSecret` call rejected the page's Promise.all and the whole Buy page became the error page.
// Nothing here moves money or decides anything: it only chooses which block of the page a hold shows.
import type { StripeGateway } from './stripe';

export type PayForm =
  | { kind: 'card'; clientSecret: string } // Stripe Elements can confirm a card for this PaymentIntent
  | { kind: 'closed' } // Stripe is not taking a card for it now (refused, cancelled or moved on; D-58)
  | { kind: 'unavailable' } // Stripe could not be asked; the page says so on this hold only
  | { kind: 'recorded' }; // no publishable key here: recorded Stripe, the signed webhook issues the tickets

type HoldLike = { hold: string; state: string; paymentId: string | null };

/** One entry per PAYING hold that has a PaymentIntent. `gateway` is called at most once, and only if Stripe has to be asked. */
export async function payForms(holds: HoldLike[], hasPublishableKey: boolean, gateway: () => StripeGateway): Promise<Map<string, PayForm>> {
  const paying = holds.filter((h) => h.state === 'PAYING' && h.paymentId);
  if (!hasPublishableKey) return new Map(paying.map((h) => [h.hold, { kind: 'recorded' }]));
  let stripe: StripeGateway | null = null;
  const ask = async (h: HoldLike): Promise<PayForm> => {
    try {
      stripe ??= gateway();
      const clientSecret = await stripe.clientSecret(h.paymentId!);
      return clientSecret ? { kind: 'card', clientSecret } : { kind: 'closed' };
    } catch (e) {
      // ids and the error's class only: a provider's message text can quote request values (D-59)
      console.error(`[turnstile] no card form for hold ${h.hold} (${h.paymentId}): ${e instanceof Error ? e.constructor.name : 'error'}`);
      return { kind: 'unavailable' };
    }
  };
  return new Map(await Promise.all(paying.map(async (h) => [h.hold, await ask(h)] as const)));
}
