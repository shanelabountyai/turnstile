// public: Stripe calls this; the signature (verifyStripeSignature) is the guard, not a session.
// POST /api/checkout/webhook — Stripe's payment_intent.* events (D-23). The org and event come from the PaymentIntent's
// metadata (set by payStart), so this runs before an org is known: cross-org (cross-org.ts, INV-32). The signature is
// checked first, by the pure verifier with the real clock, before anything is parsed or read from the database (D-56,
// review CODE-6/SEC-3); the fixture secret never reaches here (D-5). A signed event that is not for an event in this
// database (another app on the same Stripe test account, a deleted demo) is acknowledged with 200 "ignored", so Stripe
// does not retry it and never disables the endpoint over it. Each ignored event leaves a log line with its ids. A success for a
// payment that already failed is refunded at Stripe by applyWebhook; 503 means that refund did not go through yet and
// Stripe should deliver the event again (D-58).
import { asSystem } from '@/core/db/rls';
import { env } from '@/core/env';
import { log } from '@/core/log';
import { applyWebhook } from '@/checkout/checkout';
import { axisNow } from '@/checkout/clock';
import { StripeLive } from '@/checkout/stripe';
import { verifyStripeSignature, type StripeEvent } from '@/checkout/webhook';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Acknowledged, not acted on. One log line with ids only (never the body): if the event carries Turnstile's own metadata
 * and its event row is gone (a demo reset), this line is the only trace of a PaymentIntent that may have been paid. */
function ignored(ev: StripeEvent, why: string): Response {
  const o = ev.data?.object;
  log('checkout.webhook_ignored', { stripe_event: String(ev.id ?? ''), type: String(ev.type ?? ''), payment_intent: String(o?.id ?? ''), turnstile_metadata: typeof o?.metadata?.hold_id === 'string', why });
  return Response.json({ reason: `ignored: ${why}` }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook secret not configured', { status: 503 });
  const rawBody = await req.text();
  const header = req.headers.get('stripe-signature');
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const v = verifyStripeSignature(rawBody, header, env.STRIPE_WEBHOOK_SECRET, nowSeconds);
  if (!v.ok) return Response.json({ reason: v.reason }, { status: 400 });
  let ev: StripeEvent;
  try {
    ev = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return new Response('not json', { status: 400 });
  }
  const eventId = ev.data?.object?.metadata?.event_id;
  if (typeof eventId !== 'string' || !UUID.test(eventId)) return ignored(ev, 'no Turnstile event id in the metadata');
  const event = await asSystem((sys) => sys.event.findUnique({ where: { id: eventId }, select: { id: true, orgId: true, timezoneLabel: true } }));
  if (!event) return ignored(ev, 'not an event in this database');
  const out = await applyWebhook({
    orgId: event.orgId, eventId: event.id, rawBody, header, secret: env.STRIPE_WEBHOOK_SECRET,
    nowSeconds, at: axisNow(now, event.timezoneLabel), clock: now, stripe: () => new StripeLive(), // stamped on the event clock in the lock (D-35)
  });
  return Response.json(out.result ?? { reason: out.reason }, { status: out.status });
}
