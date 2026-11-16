// The 2,662 fixture commands through the cast path with Stripe recorded (task 2.6). Shared by inventory:eval:db and
// the Phase 3 e2e specs, which need an event in its end-of-stream state. The event must already be loaded.
import { readFileSync } from 'node:fs';
import { castCommand } from '@/checkout/cast';
import { applyWebhook, payStart, requestRefund } from '@/checkout/checkout';
import { StripeRecorded } from '@/checkout/stripe';
import { signStripePayload } from '@/checkout/webhook';
import { compareStrings } from '@/inventory/canonical';
import { loadCommands } from '@/inventory/load';
import type { Command, Result } from '@/inventory/types';

export async function castFixture(orgId: string, eventId: string, fx = 'fixtures', onProgress?: (n: number, total: number) => void) {
  const STRIPE = JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string; events: Record<string, { type: string; created: number; data: { object: Record<string, unknown> } }> };
  const cmds = loadCommands(fx).sort((a, b) => compareStrings(a.at, b.at) || compareStrings(a.cmd_id, b.cmd_id));

  // Recorded Stripe: before each PAY_START the recorded answer for its hold is that command's own payment_id. payStart
  // calls Stripe only when the hold is HELD and the caller's (the one path the engine accepts), and a hold is HELD at
  // most once, so each PaymentIntent is created once per hold (idempotency key = hold id, D-5). Offers (O-nnnn) are
  // minted by the engine, which is why the answer is recorded per command rather than read ahead from HOLD rows.
  const paymentIntents: Record<string, string> = {};
  const stripe = new StripeRecorded({ paymentIntents });

  /** A Stripe event for a fixture webhook command, in the recorded shape, signed with the fixture secret. event.id = cmd_id (the dedupe key). */
  const webhookBody = (c: Command): string => {
    const shape = STRIPE.events[c.kind === 'PAY_SUCCEEDED' ? 'succeeded' : 'failed']!;
    const object = { ...shape.data.object, id: c.payment_id, metadata: { hold_id: c.ref, org_id: orgId, event_id: eventId } };
    return JSON.stringify({ ...shape, id: c.cmd_id, data: { object } });
  };

  const results: Result[] = [];
  let n = 0;
  for (const c of cmds) {
    let r: Result;
    if (c.kind === 'PAY_START') {
      paymentIntents[c.ref] = c.payment_id;
      r = await payStart(orgId, eventId, c, stripe);
    } else if (c.kind === 'PAY_SUCCEEDED' || c.kind === 'PAY_FAILED') {
      const rawBody = webhookBody(c);
      const nowSeconds = 1764604800 + n; // any clock: the verifier compares t to nowSeconds, never to the axis
      const out = await applyWebhook({ orgId, eventId, rawBody, header: signStripePayload(rawBody, STRIPE.secret, nowSeconds), secret: STRIPE.secret, nowSeconds, at: c.at, stripe });
      if (out.status !== 200 || !out.result) throw new Error(`${c.cmd_id}: webhook ${out.status} ${out.reason}`);
      r = out.result;
    } else if (c.kind === 'REFUND_REQUEST') r = await requestRefund(orgId, eventId, c, stripe);
    else r = await castCommand(orgId, eventId, c);
    results.push(r);
    if (++n % 500 === 0) onProgress?.(n, cmds.length);
  }
  return { cmds, results, stripe };
}
