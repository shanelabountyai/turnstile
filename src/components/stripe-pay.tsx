'use client';
import Script from 'next/script';
import { useRef, useState } from 'react';

// Stripe Elements, test mode, only where NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set (D-26). Stripe.js loads from
// js.stripe.com as Stripe requires, so no npm wrapper is added. Confirming here moves the PaymentIntent; the tickets
// are issued only by the signed webhook (D-23), so the page then waits for it. After a refused card the form stays
// shut: Stripe's failure webhook releases the hold and the server cancels the PaymentIntent, so a second card on the
// same PaymentIntent would take money for a hold that no longer exists (D-56, review CODE-2). A form-filling mistake
// (Stripe's validation_error) creates no payment attempt and can be corrected in place.
// The page also stops offering this form once Stripe has a refused card on the PaymentIntent (clientSecret is null,
// D-58), so a refresh does not bring it back; a late success that still gets through is refunded by the webhook.
type Elements = { create(kind: 'payment'): { mount(el: HTMLElement): void } };
type StripeJs = { elements(o: { clientSecret: string }): Elements; confirmPayment(o: { elements: Elements; confirmParams: { return_url: string } }): Promise<{ error?: { message?: string; type?: string } }> };
declare global { interface Window { Stripe?: (key: string) => StripeJs } }

export function StripePay({ publishableKey, clientSecret, returnUrl }: { publishableKey: string; clientSecret: string; returnUrl: string }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ stripe: StripeJs; elements: Elements } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [spent, setSpent] = useState(false);

  function mount() {
    if (live.current || !window.Stripe || !box.current) return;
    const stripe = window.Stripe(publishableKey);
    const elements = stripe.elements({ clientSecret });
    elements.create('payment').mount(box.current);
    live.current = { stripe, elements };
    setBusy(false);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!live.current || spent) return;
    setBusy(true);
    const r = await live.current.stripe.confirmPayment({ elements: live.current.elements, confirmParams: { return_url: returnUrl } });
    if (r.error && r.error.type !== 'validation_error') {
      setSpent(true);
      setError(`${r.error.message ?? 'Stripe refused the payment.'} This hold cannot be paid again: refresh the page and hold the tickets again.`);
      return;
    }
    if (r.error) setError(r.error.message ?? 'Check the card details.');
    setBusy(false);
  }

  return (
    <form onSubmit={pay} className="stack">
      <Script src="https://js.stripe.com/v3" onReady={mount} />
      <div ref={box} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || spent}>Pay with Stripe (test mode)</button>
    </form>
  );
}
