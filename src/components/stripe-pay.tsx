'use client';
import Script from 'next/script';
import { useRef, useState } from 'react';

// Stripe Elements, test mode, only where NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set (D-26). Stripe.js loads from
// js.stripe.com as Stripe requires, so no npm wrapper is added. Confirming here moves the PaymentIntent; the tickets
// are issued only by the signed webhook (D-23), so the page then waits for it.
type Elements = { create(kind: 'payment'): { mount(el: HTMLElement): void } };
type StripeJs = { elements(o: { clientSecret: string }): Elements; confirmPayment(o: { elements: Elements; confirmParams: { return_url: string } }): Promise<{ error?: { message?: string } }> };
declare global { interface Window { Stripe?: (key: string) => StripeJs } }

export function StripePay({ publishableKey, clientSecret, returnUrl }: { publishableKey: string; clientSecret: string; returnUrl: string }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ stripe: StripeJs; elements: Elements } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

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
    if (!live.current) return;
    setBusy(true);
    const r = await live.current.stripe.confirmPayment({ elements: live.current.elements, confirmParams: { return_url: returnUrl } });
    if (r.error) setError(r.error.message ?? 'Stripe refused the payment.');
    setBusy(false);
  }

  return (
    <form onSubmit={pay} className="stack">
      <Script src="https://js.stripe.com/v3" onReady={mount} />
      <div ref={box} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Pay with Stripe (test mode)</button>
    </form>
  );
}
