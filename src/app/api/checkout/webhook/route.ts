// public: Stripe calls this; the signature (verifyStripeSignature) is the guard, not a session.
// POST /api/checkout/webhook — Stripe's payment_intent.* events (D-23). The org and event come from the PaymentIntent's
// metadata (set by payStart), so this runs before an org is known: cross-org (cross-org.ts, INV-32). The signature is
// checked by the pure verifier with the real clock; the fixture secret never reaches here (D-5).
import { asSystem } from '@/core/db/rls';
import { env } from '@/core/env';
import { applyWebhook } from '@/checkout/checkout';
import { axisNow } from '@/checkout/clock';
import { StripeLive } from '@/checkout/stripe';
import type { StripeEvent } from '@/checkout/webhook';

export async function POST(req: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook secret not configured', { status: 503 });
  const rawBody = await req.text();
  let ev: StripeEvent;
  try {
    ev = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return new Response('not json', { status: 400 });
  }
  const eventId = ev.data?.object?.metadata?.event_id;
  const event = eventId ? await asSystem((sys) => sys.event.findUnique({ where: { id: eventId }, select: { id: true, orgId: true, timezoneLabel: true } })) : null;
  if (!event) return new Response('unknown event', { status: 404 });
  const now = new Date();
  const out = await applyWebhook({
    orgId: event.orgId, eventId: event.id, rawBody, header: req.headers.get('stripe-signature'), secret: env.STRIPE_WEBHOOK_SECRET,
    nowSeconds: Math.floor(now.getTime() / 1000), at: axisNow(now, event.timezoneLabel), clock: now, stripe: () => new StripeLive(), // stamped on the event clock in the lock (D-35)
  });
  return Response.json(out.result ?? { reason: out.reason }, { status: out.status });
}
