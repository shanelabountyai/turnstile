// Stripe webhook verification (D-5, D-23) as pure functions: Stripe's documented scheme — header `t=<unix>,v1=<hex>`,
// HMAC-SHA256 over `${t}.${rawBody}`, 300-second tolerance — with `nowSeconds` a parameter, never the clock.
// `signStripePayload` is the same scheme in the other direction, for tests and inventory:eval:db.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Command } from '@/inventory/types';
import type { Timestamp } from '@/inventory/time';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type Verification = { ok: true; t: number } | { ok: false; reason: 'missing_header' | 'malformed_header' | 'stale_timestamp' | 'bad_signature' };

const hmac = (secret: string, t: string, body: string) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number): Verification {
  if (!header) return { ok: false, reason: 'missing_header' };
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return { ok: false, reason: 'malformed_header' };
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  const want = Buffer.from(hmac(secret, t, rawBody));
  const ok = sigs.some((s) => { const got = Buffer.from(s); return got.length === want.length && timingSafeEqual(got, want); });
  return ok ? { ok: true, t: Number(t) } : { ok: false, reason: 'bad_signature' };
}

export const signStripePayload = (rawBody: string, secret: string, tSeconds: number): string => `t=${tSeconds},v1=${hmac(secret, String(tSeconds), rawBody)}`;

export type StripeEvent = { id: string; type: string; created?: number; data: { object: { id: string; metadata?: Record<string, string> } } };

export const WEBHOOK_KINDS: Readonly<Record<string, 'PAY_SUCCEEDED' | 'PAY_FAILED'>> = {
  'payment_intent.succeeded': 'PAY_SUCCEEDED',
  'payment_intent.payment_failed': 'PAY_FAILED',
};

/** The engine command a Stripe event maps to (D-23), or null for an event type the venue ignores. cmd_id = event.id (the dedupe key). */
export function webhookCommand(ev: StripeEvent, at: Timestamp): Command | null {
  const kind = WEBHOOK_KINDS[ev.type];
  if (!kind) return null;
  return { cmd_id: ev.id, at, kind, customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: ev.data.object.id, target: '', tickets: [], note: ev.type };
}
